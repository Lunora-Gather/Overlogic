// ActionExecutor.js — executes actions on the robot. Tracks per-action cooldowns.
// Mirrors scripts/logic/ActionExecutor.gd. Lives inside CombatArena tick loop.

import { GameDatabase } from '../core/GameDatabase.js?v=20260725-4';
import { Projectile } from '../vfx/Projectile.js?v=20260725-4';
import { Mine } from '../vfx/Mine.js?v=20260725-4';
import { AudioManager } from '../systems/AudioManager.js?v=20260725-4';
import { spawnBurst } from '../vfx/ParticleSystem.js?v=20260725-4';
import { t } from '../i18n/I18n.js?v=20260725-4';

export class ActionExecutor {
  constructor() {
    this.robot = null;
    this.ctx = null;
    this.stats = null;        // RobotStats
    this.tracker = null;
    this.cooldowns = new Map(); // actionId -> remaining seconds
  }

  setup(robot, ctx, stats, tracker) {
    this.robot = robot;
    this.ctx = ctx;
    this.stats = stats;
    this.tracker = tracker;
    this.cooldowns.clear();
    // Expose executor to context so conditions like overdrive_ready can query it
    ctx.executor = this;
  }

  // Advance cooldown timers. dt is already combat-speed-scaled.
  tick(dt) {
    for (const [k, v] of this.cooldowns) {
      const nv = v - dt;
      if (nv <= 0) this.cooldowns.delete(k);
      else this.cooldowns.set(k, nv);
    }
  }

  isOnCooldown(actionId) {
    const v = this.cooldowns.get(actionId);
    return typeof v === 'number' && v > 0;
  }

  energyCost(actionId) { return this.stats.actionEnergyCost(actionId); }

  _startCd(actionId) { this.cooldowns.set(actionId, this.stats.actionCooldown(actionId, this.robot)); }

  // Returns a semantic block reason for actions that would spend resources
  // without producing an effect. Cooldown and energy are diagnosed separately.
  unavailableReason(actionId) {
    switch (actionId) {
      case 'shield':
        return this.robot.shieldTimer > 0 ? 'already_active' : '';
      case 'overdrive':
        return this.robot.overdriveTimer > 0 ? 'already_active' : '';
      case 'repair':
        return this.robot.hp >= this.robot.maxHp - 0.01 ? 'not_needed' : '';
      case 'drop_mine':
        return this.ctx.mines.filter(mine => !mine.dead).length >= 3 ? 'capacity' : '';
      case 'emp_burst': {
        const radius = GameDatabase.getAction('emp_burst')?.effectValue?.radius || 5;
        return this.ctx.countEnemiesWithin({ x: this.robot.x, y: this.robot.y }, radius) === 0
          ? 'no_target'
          : '';
      }
      case 'energy_transfer':
        if (!this.robot.shieldActive) return 'requires_shield';
        return this.robot.energy >= this.robot.maxEnergy - 1 ? 'not_needed' : '';
      case 'sidestep':
        return this.ctx.nearestHostileProjectileTo({ x: this.robot.x, y: this.robot.y })
          ? ''
          : 'no_target';
      default:
        return '';
    }
  }

  // Returns true if action actually executed.
  execute(actionId, rule = null) {
    if (this.isOnCooldown(actionId)) return false;
    const cost = this.energyCost(actionId);
    if (this.robot.energy < cost) return false;
    if (this.unavailableReason(actionId)) return false;

    // Thermal Recycle: actions executed during Meltdown cool CPU temp by -10°C
    if (this.ctx && this.ctx.overlogic && this.ctx.overlogic.active && this.stats.stat('thermal_recycle', 0) > 0) {
      this.ctx.overlogic.value = Math.max(0, this.ctx.overlogic.value - 10);
      this.ctx.overlogic._checkState();
      if (this.stats.hasSynergy('thermal_grid')) {
        this.robot.energy = Math.min(this.robot.maxEnergy, this.robot.energy + 4);
      }
      if (this.ctx.hud) {
        this.ctx.hud.logConsole(t('log.thermalRecycle'), 'success');
      }
    }

    switch (actionId) {
      case 'basic_attack':    return this._basicAttack(rule);
      case 'dash_toward':     return this._dash(true, rule);
      case 'dash_away':       return this._dash(false, rule);
      case 'sidestep':        return this._sidestep();
      case 'shield':          return this._shield();
      case 'interrupt_shot':  return this._interruptShot();
      case 'overdrive':       return this._overdrive();
      case 'repair':          return this._repair();
      case 'drop_mine':       this._dropMine(); return true;
      case 'emp_burst':       return this._empBurst();
      case 'energy_transfer': return this._energyTransfer();
      case 'dash_through':    return this._dashThrough(rule);
      default: return false;
    }
  }

  _resolveTarget(priority) {
    const enemies = this.ctx.enemies.filter(e => !e.dead);
    if (enemies.length === 0) return null;

    switch (priority) {
      case 'lowest_hp': {
        let best = null, minHp = Infinity;
        for (const e of enemies) {
          if (e.hp < minHp) { minHp = e.hp; best = e; }
        }
        return best;
      }
      case 'caster': {
        const casters = this.ctx.castingEnemies();
        if (casters.length > 0) {
          let best = null, minDist = Infinity;
          for (const c of casters) {
            const d = Math.hypot(c.x - this.robot.x, c.y - this.robot.y);
            if (d < minDist) { minDist = d; best = c; }
          }
          if (best) return best;
        }
        return this.ctx.nearestEnemyTo({ x: this.robot.x, y: this.robot.y });
      }
      case 'boss': {
        const boss = this.ctx.boss;
        if (boss && !boss.dead) return boss;
        return this.ctx.nearestEnemyTo({ x: this.robot.x, y: this.robot.y });
      }
      case 'nearest':
      default:
        return this.ctx.nearestEnemyTo({ x: this.robot.x, y: this.robot.y });
    }
  }

  executeDefault() {
    const e = this.ctx.nearestEnemyTo({ x: this.robot.x, y: this.robot.y });
    if (!e) return;
    const dx = e.x - this.robot.x, dy = e.y - this.robot.y;
    const len = Math.hypot(dx, dy) || 1;
    this.robot.moveIntent = {
      x: (dx / len) * this.robot.moveSpeed * 0.6,
      y: (dy / len) * this.robot.moveSpeed * 0.6,
    };
  }

  _basicAttack(rule) {
    const priority = rule?.targetPriority || 'nearest';
    const e = this._resolveTarget(priority);
    if (!e) return false;
    const dist = Math.hypot(e.x - this.robot.x, e.y - this.robot.y);
    const range = this.stats.actionRange('basic_attack');
    if (dist > range) {
      const dx = e.x - this.robot.x, dy = e.y - this.robot.y;
      const len = Math.hypot(dx, dy) || 1;
      this.robot.moveIntent = { x: (dx/len) * this.robot.moveSpeed, y: (dy/len) * this.robot.moveSpeed };
      return false;
    }
    this.robot.fireBullet({ x: e.x, y: e.y }, this.stats.basicDamage(), 12, 2, 'basic');
    this.robot.energy -= this.energyCost('basic_attack');
    this._startCd('basic_attack');
    AudioManager.play('basic_attack');
    return true;
  }

  _dash(toward, rule) {
    const priority = rule?.targetPriority || 'nearest';
    const e = this._resolveTarget(priority);
    if (!e) return false;
    let dx = e.x - this.robot.x, dy = e.y - this.robot.y;
    const len = Math.hypot(dx, dy);
    if (len === 0) { dx = 1; dy = 0; } else { dx /= len; dy /= len; }
    if (!toward) { dx = -dx; dy = -dy; }
    this.robot.doDash({ x: dx, y: dy }, this.stats.stat('dash_distance', 3), 0.15);
    this.robot.energy -= this.energyCost(toward ? 'dash_toward' : 'dash_away');
    this._startCd(toward ? 'dash_toward' : 'dash_away');
    AudioManager.play('dash');
    return true;
  }

  _sidestep() {
    const projectile = this.ctx.nearestHostileProjectileTo({ x: this.robot.x, y: this.robot.y });
    if (!projectile) return false;
    const action = GameDatabase.getAction('sidestep');
    const effect = action.effectValue;
    let sideX = -projectile.dir.y;
    let sideY = projectile.dir.x;
    const projectileToRobotX = this.robot.x - projectile.x;
    const projectileToRobotY = this.robot.y - projectile.y;
    if (projectileToRobotX * sideX + projectileToRobotY * sideY < 0) {
      sideX = -sideX;
      sideY = -sideY;
    }
    this.robot.doDash(
      { x: sideX, y: sideY },
      effect.dashDist || 2.6,
      effect.invulnTime || 0.16,
    );
    this.robot.energy -= this.energyCost('sidestep');
    this._startCd('sidestep');
    AudioManager.play('dash');
    return true;
  }

  _shield() {
    const dur = this.stats.stat('shield_dur', 2);
    const reduce = this.stats.stat('shield_reduce', 0.70);
    this.robot.activateShield(dur, reduce);
    this.robot.energy -= this.energyCost('shield');
    this._startCd('shield');
    AudioManager.play('shield_on');
    return true;
  }

  _interruptShot() {
    const casters = this.ctx.castingEnemies();
    if (casters.length === 0) return false;
    let target = null, best = Infinity;
    for (const c of casters) {
      const d = Math.hypot(c.x - this.robot.x, c.y - this.robot.y);
      if (d < best) { best = d; target = c; }
    }
    if (!target) return false;
    const a = GameDatabase.getAction('interrupt_shot');
    const ev = a.effectValue;
    if (best > this.stats.actionRange('interrupt_shot')) {
      const dx = target.x - this.robot.x;
      const dy = target.y - this.robot.y;
      const length = Math.hypot(dx, dy) || 1;
      this.robot.moveIntent = {
        x: (dx / length) * this.robot.moveSpeed,
        y: (dy / length) * this.robot.moveSpeed,
      };
      return false;
    }
    this.robot.fireBullet({ x: target.x, y: target.y }, ev.dmg, ev.bulletSpeed, ev.bulletLife, 'interrupt', target);
    this.robot.energy -= this.energyCost('interrupt_shot');
    this._startCd('interrupt_shot');
    AudioManager.play('interrupt_success');
    return true;
  }

  _overdrive() {
    const a = GameDatabase.getAction('overdrive');
    const ev = a.effectValue;
    const dur = this.stats.stat('overdrive_dur', 5);
    this.robot.activateOverdrive(dur, ev.atkSpdMul, ev.moveSpdMul);
    this.robot.energy -= this.energyCost('overdrive');
    this._startCd('overdrive');
    this.ctx.overlogic.addEvent('overdrive', 18);
    AudioManager.play('shield_on');
    return true;
  }

  _repair() {
    const a = GameDatabase.getAction('repair');
    const ev = a.effectValue;
    this.robot.heal(ev.heal);
    this.robot.energy -= this.energyCost('repair');
    this._startCd('repair');
    AudioManager.play('shield_on');
    return true;
  }

  _dropMine() {
    const a = GameDatabase.getAction('drop_mine');
    const ev = a.effectValue;
    this.robot.spawnMine(ev.triggerRadius, ev.explosionRadius, ev.dmg);
    this.robot.energy -= this.energyCost('drop_mine');
    this._startCd('drop_mine');
    AudioManager.play('basic_attack');
  }

  _empBurst() {
    const a = GameDatabase.getAction('emp_burst');
    const ev = a.effectValue;
    const radius = ev.radius || 5.0;
    const stunDur = ev.stunDuration || 0.8;
    let hit = 0;
    for (const e of this.ctx.enemies) {
      if (e.dead) continue;
      const dist = Math.hypot(e.x - this.robot.x, e.y - this.robot.y);
      if (dist <= radius) {
        e.stunTimer = stunDur;
        hit++;
      }
    }
    // Visual burst
    spawnBurst(this.ctx, this.robot.x, this.robot.y, '#ffe033', 30, radius * 1.4, 0.4, 5);
    this.robot.energy -= this.energyCost('emp_burst');
    this._startCd('emp_burst');
    AudioManager.play('emp_burst');
    if (this.ctx.hud) {
      this.ctx.hud.logConsole(t('log.empBurst', { count: hit, seconds: stunDur }), 'success');
    }
    return true;
  }

  _energyTransfer() {
    const a = GameDatabase.getAction('energy_transfer');
    const ev = a.effectValue;
    const restore = ev.restore || 35;
    const before = this.robot.energy;
    this.robot.energy = Math.min(this.robot.maxEnergy, this.robot.energy + restore);
    // Consume the active shield buffer as the conversion cost.
    this.robot.shieldTimer = 0;
    if (this.robot.onShield) this.robot.onShield(false);
    this._startCd('energy_transfer');
    AudioManager.play('energy_transfer');
    if (this.ctx.hud) {
      this.ctx.hud.logConsole(t('log.energyTransfer', { value: Math.round(this.robot.energy - before) }), 'success');
    }
    return true;
  }

  _dashThrough(rule) {
    const priority = rule?.targetPriority || 'nearest';
    const e = this._resolveTarget(priority);
    if (!e) return false;
    const dx = e.x - this.robot.x, dy = e.y - this.robot.y;
    const len = Math.hypot(dx, dy) || 1;
    const dirX = dx / len, dirY = dy / len;
    const a = GameDatabase.getAction('dash_through');
    const ev = a.effectValue;
    const dashDist = ev.dashDist || 4.0;
    const kineticBreach = this.stats.hasSynergy('kinetic_breach');
    if (len > this.stats.actionRange('dash_through')) {
      this.robot.moveIntent = {
        x: dirX * this.robot.moveSpeed,
        y: dirY * this.robot.moveSpeed,
      };
      return false;
    }
    // Dash through: move past the enemy
    this.robot.doDash({ x: dirX, y: dirY }, dashDist, ev.invulnTime || 0.1);
    // Damage all enemies along the path (within dash line)
    for (const enemy of this.ctx.enemies) {
      if (enemy.dead) continue;
      const ex = enemy.x - this.robot.x, ey = enemy.y - this.robot.y;
      const proj = ex * dirX + ey * dirY;
      if (proj >= 0 && proj <= dashDist) {
        const perpDist = Math.abs(ex * dirY - ey * dirX);
        if (perpDist <= enemy.bodyRadius + 0.5) {
          enemy.takeDamage((ev.dmg || 14) * (kineticBreach ? 1.5 : 1), 'dash_through');
          if (kineticBreach) enemy.stunTimer = Math.max(enemy.stunTimer || 0, 0.5);
        }
      }
    }
    this.robot.energy -= this.energyCost('dash_through');
    this._startCd('dash_through');
    AudioManager.play('dash_through');
    return true;
  }

  // Cooldown fraction for HUD (0 = ready, 1 = just used).
  cooldownFraction(actionId) {
    const rem = this.cooldowns.get(actionId);
    if (typeof rem !== 'number') return 0;
    const total = this.stats.actionCooldown(actionId, this.robot);
    if (total <= 0) return 0;
    return Math.max(0, Math.min(1, rem / total));
  }
}
