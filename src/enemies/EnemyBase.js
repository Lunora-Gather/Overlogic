// EnemyBase.js — base enemy. Subclasses override tickBehavior(dt).
// Mirrors scripts/enemies/EnemyBase.gd. Pure class with tick + draw.

import { AudioManager } from '../systems/AudioManager.js?v=20260725-4';
import { spawnBurst, spawnText, spawnEngineTrail } from '../vfx/ParticleSystem.js?v=20260725-4';

export class EnemyBase {
  constructor() {
    this.enemyId = '';
    this.maxHp = 20; this.hp = 20;
    this.moveSpeed = 2.5; this.damage = 8;
    this.attackRange = 1; this.attackCooldown = 1.2;
    this.bodyRadius = 0.35;
    this.data = null;
    this.dead = false;
    this.attackTimer = 0;
    this.ctx = null;
    this.state = 'chasing';
    this.x = 0; this.y = 0;
    this.color = [1, 0.35, 0.25];
    this.stunTimer = 0;
    this.armor = 0;
    this.flashTimer = 0;
  }

  init(data, ctx) {
    this.data = data; this.ctx = ctx;
    this.enemyId = data.id;
    this.stunTimer = 0;
    this.maxHp = data.maxHp; this.hp = this.maxHp;
    this.moveSpeed = data.moveSpeed;
    this.damage = data.damage;
    this.attackRange = data.attackRange;
    this.attackCooldown = data.attackCooldown;
    this.bodyRadius = data.bodyRadius ?? 0.35;
    this.color = data.color || [1, 0.3, 0.3];
    this.armor = data.armor ?? 0;
    this.flashTimer = 0;
  }

  isDead() { return this.dead; }
  isCasting() { return false; }
  interrupt() { /* base no-op */ }

  takeDamage(amount, kind) {
    if (this.dead) return;
    let finalDmg = amount;
    if (this.armor > 0 && kind !== 'reflective_plating') {
      let ap = 0;
      if (this.ctx && this.ctx.robot && this.ctx.robot.stats) {
        ap = this.ctx.robot.stats.stat('armor_piercing', 0);
      }
      const effectiveArmor = Math.max(0, this.armor - ap);
      finalDmg = Math.max(1, amount - effectiveArmor);
    }
    this.hp -= finalDmg;
    this.flashTimer = 0.1; // 100ms visual flash on taking damage
    
    // Spawn floating damage text on enemy
    const dmgColor = kind === 'interrupt' ? '#ffe24b' : '#00d2ff';
    const mitigated = amount - finalDmg;
    const text = mitigated > 0 ? `-${Math.round(finalDmg)} (Mitigated)` : `-${Math.round(finalDmg)}`;
    spawnText(this.ctx, this.x, this.y - this.bodyRadius, text, dmgColor, 11);
    if (this.ctx && this.ctx.tracker) {
      this.ctx.tracker.recordDamageDealt(finalDmg, kind);
    }

    if (this.hp <= 0) {
      this.hp = 0; this.dead = true;
      if (this.ctx && this.ctx.onEnemyDied) {
        this.ctx.onEnemyDied(this.enemyId, this.displayName || this.enemyId);
      }
      this.ctx.tracker.recordEnemyDeath(this.enemyId);
      // Overlogic: low-HP kill bonus
      const r = this.ctx.robot;
      if (r && !r.dead) {
        const hpPct = r.hp / r.maxHp;
        if (hpPct < 0.20) {
          this.ctx.overlogic.addEvent('low_hp_kill', 12);
          this.ctx.tracker.recordLowHpKill();
        }
      }
      spawnBurst(this.ctx, this.x, this.y, `rgba(${this.color[0]*255|0},${this.color[1]*255|0},${this.color[2]*255|0},0.9)`, 12, 5, 0.4, 4);
      AudioManager.play('enemy_death', this.x);
    }
  }

  getSeparationForce() {
    let sepX = 0, sepY = 0;
    if (!this.ctx || !this.ctx.enemies) return { x: 0, y: 0 };
    for (const other of this.ctx.enemies) {
      if (other === this || other.dead) continue;
      const dx = this.x - other.x;
      const dy = this.y - other.y;
      const dist = Math.hypot(dx, dy);
      const minDist = this.bodyRadius + other.bodyRadius;
      if (dist < minDist && dist > 0.01) {
        const force = (minDist - dist) / minDist;
        // Gently push away from overlapping neighbors
        sepX += (dx / dist) * force * 3.5;
        sepY += (dy / dist) * force * 3.5;
      }
    }
    return { x: sepX, y: sepY };
  }

  // dt is combat-speed-scaled.
  tick(dt) {
    if (this.dead || !this.ctx || !this.ctx.robot || this.ctx.robot.dead) return;
    
    if (this.flashTimer > 0) this.flashTimer -= dt;
    
    if (this.stunTimer > 0) {
      this.stunTimer -= dt;
      this.state = 'stunned';
      return;
    }
    this.attackTimer -= dt;
    this.tickBehavior(dt);

    // Apply mutual separation force post-movement for all active (non-leaping, non-charging) enemies
    if (this.state !== 'leaping' && this.state !== 'charging') {
      const sep = this.getSeparationForce();
      if (sep.x !== 0 || sep.y !== 0) {
        const next = this.ctx.clampToArena({ x: this.x + sep.x * dt, y: this.y + sep.y * dt });
        this.x = next.x;
        this.y = next.y;
      }
    }
  }

  // Override in subclass.
  tickBehavior(dt) {
    const r = this.ctx.robot;
    const dx = r.x - this.x, dy = r.y - this.y;
    const dist = Math.hypot(dx, dy) || 1;
    const dirX = dx / dist, dirY = dy / dist;
    if (dist > this.attackRange) {
      this.state = 'chasing';
      const next = this.ctx.clampToArena({ x: this.x + dirX * this.moveSpeed * dt, y: this.y + dirY * this.moveSpeed * dt });
      this.x = next.x; this.y = next.y;
      
      // Spawn walking trace particles
      if (Math.random() < 0.18) {
        const [cr, cg, cb] = this.color;
        spawnEngineTrail(this.ctx, this.x, this.y, `rgba(${cr*255|0},${cg*255|0},${cb*255|0},0.2)`, 0.08);
      }
    } else {
      this.state = 'attacking';
      if (this.attackTimer <= 0) {
        this.ctx.robot.takeDamage(this.damage, this.enemyId);
        this.attackTimer = this.attackCooldown;
      }
    }
  }

  drawHpBar(g, scale) {
    if (this.dead) return;

    // Draw stun indicator if stunned
    if (this.stunTimer > 0) {
      g.save();
      g.fillStyle = '#ffda79';
      g.shadowColor = '#ffda79';
      g.shadowBlur = 6;
      g.font = '8px monospace';
      g.textAlign = 'center';
      g.fillText('⚡ STUNNED ⚡', this.x * scale, this.y * scale - this.bodyRadius * scale - 12);
      g.restore();
    }

    if (this.hp >= this.maxHp) return;
    const sz = this.bodyRadius * 2 * scale;
    const bw = sz, bh = 3;
    g.fillStyle = 'rgba(255, 60, 60, 0.2)';
    g.fillRect(this.x * scale - bw/2, this.y * scale - this.bodyRadius * scale - 7, bw, bh);
    g.fillStyle = '#f55';
    g.fillRect(this.x * scale - bw/2, this.y * scale - this.bodyRadius * scale - 7, bw * (this.hp/this.maxHp), bh);
  }

  draw(g, scale) {
    if (this.dead) {
      const sz = this.bodyRadius * 2 * scale;
      g.fillStyle = '#444';
      g.fillRect(this.x * scale - sz/2, this.y * scale - sz/2, sz, sz);
      return;
    }
    // Fallback: smooth circle outline with glowing core
    const rPx = this.bodyRadius * scale;
    const [cr, cg, cb] = this.color;
    g.save();
    g.fillStyle = `rgba(${cr*255|0},${cg*255|0},${cb*255|0},0.2)`;
    g.strokeStyle = `rgb(${cr*255|0},${cg*255|0},${cb*255|0})`;
    g.lineWidth = 2;
    g.beginPath();
    g.arc(this.x * scale, this.y * scale, rPx, 0, Math.PI * 2);
    g.fill();
    g.stroke();
    
    // Draw damage flash overlay
    if (this.flashTimer > 0) {
      g.fillStyle = 'rgba(255, 255, 255, 0.65)';
      g.beginPath();
      g.arc(this.x * scale, this.y * scale, rPx, 0, Math.PI * 2);
      g.fill();
    }
    
    g.restore();
    
    this.drawHpBar(g, scale);
  }
}
