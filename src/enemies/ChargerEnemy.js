// ChargerEnemy.js — charge caster. Telegraph → charge → impact.
// Mirrors scripts/enemies/ChargerEnemy.gd.

import { EnemyBase } from './EnemyBase.js?v=20260725-3';

export class ChargerEnemy extends EnemyBase {
  constructor() {
    super();
    this.chargeSpeed = 7;
    this.chargeTelegraph = 1.2;
    this.chargeDistance = 6;
    this.chargeState = 'idle';   // idle / casting / charging
    this.chargeTimer = 0;
    this.chargeDir = { x: 0, y: 0 };
    this.chargeRemaining = 0;
  }

  init(data, ctx) {
    super.init(data, ctx);
    this.chargeSpeed = data.chargeSpeed ?? 7;
    this.chargeTelegraph = data.chargeTelegraph ?? 1.2;
    this.chargeDistance = data.chargeDistance ?? 6;
  }

  isCasting() { return this.chargeState === 'casting'; }

  interrupt() {
    if (this.chargeState === 'casting') {
      this.chargeState = 'idle';
      this.chargeTimer = 0;
      this.attackTimer = this.attackCooldown;
    }
  }

  tickBehavior(dt) {
    const r = this.ctx.robot;
    const dx = r.x - this.x, dy = r.y - this.y;
    const dist = Math.hypot(dx, dy) || 1;
    const dirX = dx / dist, dirY = dy / dist;
    switch (this.chargeState) {
      case 'idle':
        if (dist <= 5 && this.attackTimer <= 0) {
          this.chargeState = 'casting';
          this.chargeTimer = this.chargeTelegraph;
        } else {
          this.state = 'chasing';
          const next = this.ctx.clampToArena({ x: this.x + dirX * this.moveSpeed * dt, y: this.y + dirY * this.moveSpeed * dt });
          this.x = next.x; this.y = next.y;
        }
        break;
      case 'casting':
        this.state = 'casting';
        this.chargeTimer -= dt;
        if (this.chargeTimer <= 0) {
          this.chargeState = 'charging';
          this.chargeDir = { x: dirX, y: dirY };
          this.chargeRemaining = this.chargeDistance;
        }
        break;
      case 'charging': {
        this.state = 'charging';
        const step = this.chargeSpeed * dt;
        const prevX = this.x, prevY = this.y;
        const nx = this.x + this.chargeDir.x * step;
        const ny = this.y + this.chargeDir.y * step;
        const clamped = this.ctx.clampToArena({ x: nx, y: ny });
        const moved = Math.hypot(clamped.x - prevX, clamped.y - prevY);
        this.x = clamped.x; this.y = clamped.y;
        this.chargeRemaining -= moved;
        if (Math.hypot(this.x - r.x, this.y - r.y) <= this.bodyRadius + r.bodyRadius) {
          r.takeDamage(this.damage, this.enemyId);
          this.chargeState = 'idle';
          this.attackTimer = this.attackCooldown;
        } else if (this.chargeRemaining <= 0 || moved < step * 0.5) {
          this.chargeState = 'idle';
          this.attackTimer = this.attackCooldown;
        }
        break;
      }
    }
  }

  draw(g, scale) {
    if (this.dead) { super.draw(g, scale); return; }
    const rPx = this.bodyRadius * scale;
    
    g.save();
    g.translate(this.x * scale, this.y * scale);
    
    // Rotate based on movement / charge direction
    let angle = 0;
    if (this.chargeState === 'charging') {
      angle = Math.atan2(this.chargeDir.y, this.chargeDir.x);
    } else {
      const r = this.ctx.robot;
      if (r) angle = Math.atan2(r.y - this.y, r.x - this.x);
    }
    g.rotate(angle);
    
    g.shadowColor = '#ff2c2c';
    g.shadowBlur = 10;
    g.strokeStyle = '#ff2c2c';
    g.lineWidth = 2.5;
    g.fillStyle = '#2d0606';
    
    // Triangular armored shield ram
    g.beginPath();
    g.moveTo(rPx * 1.15, 0);
    g.lineTo(-rPx * 0.8, -rPx * 0.95);
    g.lineTo(-rPx * 0.8, rPx * 0.95);
    g.closePath();
    g.fill();
    g.stroke();
    
    // Back jet vents & engine fire
    g.shadowBlur = 0;
    if (this.chargeState === 'charging' || this.chargeState === 'casting') {
      g.fillStyle = '#ff7a2c';
      const flameLen = rPx * (0.8 + Math.random() * 0.7);
      g.beginPath();
      g.moveTo(-rPx * 0.8, -rPx * 0.35);
      g.lineTo(-rPx * 0.8 - flameLen, 0);
      g.lineTo(-rPx * 0.8, rPx * 0.35);
      g.closePath();
      g.fill();
    } else {
      g.fillStyle = '#16274a';
      g.fillRect(-rPx * 0.9, -rPx * 0.3, rPx * 0.2, rPx * 0.6);
    }
    
    g.restore();
    
    // Warning telegraph rings (casting)
    if (this.chargeState === 'casting') {
      const t = 1 - this.chargeTimer / this.chargeTelegraph;
      
      // Draw outer warning circle lane
      g.strokeStyle = `rgba(255, 44, 44, ${0.35 + t * 0.55})`;
      g.lineWidth = 2;
      g.beginPath();
      g.arc(this.x * scale, this.y * scale, (this.bodyRadius + 0.3 + t * 0.5) * scale, 0, Math.PI * 2);
      g.stroke();
      
      // Draw charging lane indicator leading to target player
      const r = this.ctx.robot;
      if (r) {
        g.save();
        g.strokeStyle = `rgba(255, 44, 44, ${0.1 + t * 0.25})`;
        g.lineWidth = rPx * 1.8;
        g.beginPath();
        g.moveTo(this.x * scale, this.y * scale);
        // Extend line forward
        const dx = r.x - this.x, dy = r.y - this.y;
        const dist = Math.hypot(dx, dy) || 1;
        g.lineTo((this.x + (dx/dist) * this.chargeDistance) * scale, (this.y + (dy/dist) * this.chargeDistance) * scale);
        g.stroke();
        g.restore();
      }
    }
    
    this.drawHpBar(g, scale);
  }
}
