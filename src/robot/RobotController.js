// RobotController.js — player robot. Driven by ActionExecutor (moveIntent/doDash/fireBullet).
// Pure logic + render hook. No DOM. Mirrors scripts/robot/RobotController.gd.

import { Projectile } from '../vfx/Projectile.js';
import { Mine } from '../vfx/Mine.js';
import { AudioManager } from '../systems/AudioManager.js';
import { spawnText, spawnEngineTrail, spawnReflectBeam, spawnBurst } from '../vfx/ParticleSystem.js';
import { t } from '../i18n/I18n.js';

export class RobotController {
  constructor() {
    this.maxHp = 100; this.hp = 100;
    this.maxEnergy = 100; this.energy = 100;
    this.moveSpeed = 4; this.bodyRadius = 0.4;
    this.x = 0; this.y = 0;
    // movement
    this.moveIntent = { x: 0, y: 0 };
    this.dashVel = { x: 0, y: 0 };
    this.dashTimer = 0;
    this.invulnTimer = 0;
    // statuses
    this.shieldTimer = 0; this.shieldReduce = 0;
    this.overdriveTimer = 0; this.overdriveAtkMul = 1; this.overdriveMoveMul = 1;
    this.dead = false;
    this.stats = null; this.ctx = null;
    this.recallTriggered = false;
    this.chassisAngle = 0;
    this.flashTimer = 0;
    // callbacks for HUD
    this.onHp = null; this.onEnergy = null; this.onShield = null; this.onOverdrive = null; this.onDied = null;
    this.onDamage = null;
  }

  initFromStats(stats, ctx) {
    this.stats = stats; this.ctx = ctx;
    this.maxHp = stats.stat('max_hp', 100);
    // Apply persistent HP carry-over if available, otherwise start at full HP
    this.hp = (stats.startingHp && stats.startingHp > 0)
      ? Math.min(stats.startingHp, this.maxHp)
      : this.maxHp;
    this.maxEnergy = stats.stat('max_energy', 100); this.energy = this.maxEnergy;
    this.moveSpeed = stats.stat('move_speed', 4);
    this.x = 0; this.y = 0;
    this.recallTriggered = false;
    this.chassisAngle = 0;
    this.flashTimer = 0;
    this._emitHp(); this._emitEnergy();
  }

  overdriveAtkSpeedMul() { return this.overdriveTimer > 0 ? this.overdriveAtkMul : 1; }
  get shieldActive() { return this.shieldTimer > 0; }

  getHazardRepulsion() {
    const force = { x: 0, y: 0 };
    if (!this.ctx || !this.ctx.hazards) return force;
    for (const h of this.ctx.hazards) {
      const dx = this.x - h.x;
      const dy = this.y - h.y;
      const dist = Math.hypot(dx, dy);
      const buffer = h.radius + 1.5;
      if (dist < buffer) {
        let dirX, dirY;
        if (dist > 0.01) {
          dirX = dx / dist;
          dirY = dy / dist;
        } else {
          const ang = Math.random() * Math.PI * 2;
          dirX = Math.cos(ang);
          dirY = Math.sin(ang);
        }
        const strength = (buffer - dist) / buffer;
        const multiplier = h.state === 'active' ? 5.5 : 2.5;
        force.x += dirX * strength * multiplier;
        force.y += dirY * strength * multiplier;
      }
    }
    return force;
  }

  // dt is already combat-speed-scaled.
  tick(dt) {
    if (this.dead) return;

    if (this.flashTimer > 0) this.flashTimer -= dt;

    // Smoothly interpolate chassisAngle towards movement intent angle
    if (Math.hypot(this.moveIntent.x, this.moveIntent.y) > 0.1) {
      const targetAngle = Math.atan2(this.moveIntent.y, this.moveIntent.x);
      let diff = targetAngle - this.chassisAngle;
      // Normalize to [-PI, PI]
      diff = Math.atan2(Math.sin(diff), Math.cos(diff));
      this.chassisAngle += diff * Math.min(1, 15 * dt);
    }
    
    // Energy regen (paused during overdrive, boosted by superconductors if hot)
    if (this.overdriveTimer <= 0) {
      let regen = this.stats.stat('energy_regen', 8);
      const isSuperconducting = this.stats.stat('superconductors', 0) > 0 && this.ctx && this.ctx.overlogic && this.ctx.overlogic.value > 50;
      if (isSuperconducting) {
        regen *= 2.0; // double energy regen!
      }
      this.energy = Math.min(this.maxEnergy, this.energy + regen * dt);
    }
    
    // Energy overflow tracking
    if (this.energy >= this.maxEnergy - 0.01) this.ctx.tracker.recordEnergyOverflow(dt);
    
    // Meltdown Heat Damage (5% max HP per second)
    if (this.ctx && this.ctx.overlogic && this.ctx.overlogic.active) {
      this._meltdownAccumulator = (this._meltdownAccumulator || 0) + dt;
      if (this._meltdownAccumulator >= 1.0) {
        this._meltdownAccumulator -= 1.0;
        const heatDmg = Math.round(this.maxHp * 0.05); // 5% max HP
        this.hp = Math.max(0, this.hp - heatDmg);
        spawnText(this.ctx, this.x, this.y - 0.4, `TEMP -${heatDmg}`, '#ff8000', 11);
        if (this.hp <= 0 && !this.dead) {
          this.hp = 0; this.dead = true;
          if (this.onDied) this.onDied();
        }
        this._emitHp();
      }
    } else {
      this._meltdownAccumulator = 0;
    }

    // Nanite Repair passive regeneration in combat
    const naniteRegen = this.stats.stat('nanite_repair', 0);
    const inCombat = this.ctx && this.ctx.liveEnemies() > 0;
    if (naniteRegen > 0 && this.hp < this.maxHp && !this.dead && inCombat) {
      this.hp = Math.min(this.maxHp, this.hp + naniteRegen * dt);
      this._emitHp();
    }

    // invuln / statuses / physics...
    if (this.invulnTimer > 0) this.invulnTimer -= dt;
    if (this.shieldTimer > 0) {
      this.shieldTimer -= dt;
      if (this.shieldTimer <= 0 && this.onShield) this.onShield(false);
    }
    if (this.overdriveTimer > 0) {
      this.overdriveTimer -= dt;
      if (this.overdriveTimer <= 0) {
        this.overdriveAtkMul = 1; this.overdriveMoveMul = 1;
        if (this.onOverdrive) this.onOverdrive(false);
      }
    }

    // Cooldowns and speed resolution
    let vx = 0, vy = 0;
    if (this.dashTimer > 0) {
      this.dashTimer -= dt;
      vx = this.dashVel.x; vy = this.dashVel.y;
    } else {
      let steerX = this.moveIntent.x;
      let steerY = this.moveIntent.y;
      const rep = this.getHazardRepulsion();
      steerX += rep.x;
      steerY += rep.y;

      const spd = this.moveSpeed * (this.overdriveTimer > 0 ? this.overdriveMoveMul : 1);
      const len = Math.hypot(steerX, steerY);
      if (len > spd) { vx = steerX / len * spd; vy = steerY / len * spd; }
      else { vx = steerX; vy = steerY; }
    }

    // Move with clamping
    const next = this.ctx.clampToArena({ x: this.x + vx * dt, y: this.y + vy * dt });
    this.x = next.x; this.y = next.y;

    // Spawn thruster trail particles when moving
    if (Math.hypot(vx, vy) > 0.1 && Math.random() < 0.45) {
      const trailColor = this.overdriveTimer > 0 ? 'rgba(255, 184, 77, 0.45)' : 'rgba(0, 210, 255, 0.35)';
      spawnEngineTrail(this.ctx, this.x, this.y, trailColor, this.overdriveTimer > 0 ? 0.16 : 0.12);
    }

    // NOTE: moveIntent is NOT cleared — persists between ticks for smooth motion.
    this._emitEnergy();
  }

  // ---- Action hooks (called by ActionExecutor) ----
  doDash(dir, dist, invuln) {
    const len = Math.hypot(dir.x, dir.y);
    const safe = len === 0 ? { x: 1, y: 0 } : { x: dir.x / len, y: dir.y / len };
    this.dashVel = { x: safe.x * (dist / 0.15), y: safe.y * (dist / 0.15) };
    this.dashTimer = 0.15;
    this.invulnTimer = invuln;
  }

  activateShield(dur, reduce) {
    this.shieldTimer = dur; this.shieldReduce = reduce;
    if (this.onShield) this.onShield(true);
    if (this.ctx && this.ctx.tracker) this.ctx.tracker.recordShieldActivated(this.hp / this.maxHp);
  }

  activateOverdrive(dur, atkMul, moveMul) {
    this.overdriveTimer = dur;
    this.overdriveAtkMul = atkMul; this.overdriveMoveMul = moveMul;
    if (this.onOverdrive) this.onOverdrive(true);
  }

  heal(amount) {
    const before = this.hp;
    this.hp = Math.min(this.maxHp, this.hp + amount);
    const restored = this.hp - before;
    this._emitHp();
    spawnText(this.ctx, this.x, this.y - 0.4, `+${Math.round(restored)}`, '#3eff9d', 12);
    return restored;
  }

  fireBullet(targetPos, dmg, speed, life, kind, specificTarget = null) {
    let finalDmg = dmg;
    if (this.ctx && this.ctx.overlogic && this.ctx.overlogic.active) {
      finalDmg *= 1.5;
    }
    let dx = targetPos.x - this.x, dy = targetPos.y - this.y;
    const len = Math.hypot(dx, dy);
    if (len === 0) { dx = 1; dy = 0; } else { dx /= len; dy /= len; }
    const p = new Projectile();
    p.setup({ x: this.x, y: this.y }, { x: dx, y: dy }, speed, life, finalDmg, kind, true, specificTarget);
    p.setCtx(this.ctx);
    this.ctx.projectiles.push(p);
  }

  spawnMine(triggerR, explosionR, dmg) {
    let finalDmg = dmg;
    if (this.ctx && this.ctx.overlogic && this.ctx.overlogic.active) {
      finalDmg *= 1.5;
    }
    const m = new Mine();
    m.setup({ x: this.x, y: this.y }, triggerR, explosionR, finalDmg, this.ctx);
    this.ctx.mines.push(m);
  }

  takeDamage(amount, sourceKind) {
    if (this.dead) return;
    if (this.invulnTimer > 0) {
      spawnText(this.ctx, this.x, this.y - 0.4, 'DODGE', '#00d2ff', 9);
      return;
    }
    let actual = amount;
    if (this.shieldTimer > 0) {
      actual = amount * (1 - this.shieldReduce);
      const reflectFraction = this.stats.stat('reflective_plating', 0);
      if (reflectFraction > 0 && actual > 0) {
        const reflected = amount * reflectFraction;
        const enemy = this.ctx.nearestEnemyTo({ x: this.x, y: this.y });
        if (enemy) {
          enemy.takeDamage(reflected, 'reflective_plating');
          spawnReflectBeam(this.ctx, this.x, this.y, enemy.x, enemy.y, '#00d2ff');
          spawnBurst(this.ctx, enemy.x, enemy.y, '#00d2ff', 8, 4, 0.25, 3.5);
          if (this.ctx && this.ctx.hud) {
            this.ctx.hud.logConsole(t('log.reflect', { value: reflected.toFixed(0) }), 'success');
          }
        }
      }
    }
    this.hp -= actual;
    this.flashTimer = 0.1; // 100ms visual flash on taking damage
    
    // Spawn floating damage text
    spawnText(this.ctx, this.x, this.y - 0.4, `-${Math.round(actual)}`, '#ff3e3e', 12);

    if (this.ctx && this.ctx.tracker) this.ctx.tracker.recordDamageTaken(actual, sourceKind);
    if (this.hp <= 0 && !this.dead) {
      if (this.stats.stat('emergency_recall', 0) > 0 && !this.recallTriggered) {
        this.recallTriggered = true;
        this.hp = 30;
        this.invulnTimer = 1.5;
        // Dash away from current movement
        const dx = this.moveIntent.x || -1;
        const dy = this.moveIntent.y || 0;
        const len = Math.hypot(dx, dy) || 1;
        this.doDash({ x: -dx / len, y: -dy / len }, 3, 1.5);
        if (this.ctx && this.ctx.hud) {
          this.ctx.hud.logConsole(t('log.recall'), 'danger');
        }
        AudioManager.play('shield_on');
        this._emitHp();
        return; // Bypass death!
      }
      this.hp = 0; this.dead = true;
      // death snapshot is taken by CombatArena._finish(false) to avoid duplication
      if (this.onDied) this.onDied();
    }
    this._emitHp();
    if (this.onDamage) this.onDamage(actual, sourceKind);
  }

  _emitHp()     { if (this.onHp) this.onHp(this.hp, this.maxHp); }
  _emitEnergy() { if (this.onEnergy) this.onEnergy(this.energy, this.maxEnergy); }
}
