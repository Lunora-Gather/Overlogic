// ShooterEnemy.js — ranged kiter. Mirrors scripts/enemies/ShooterEnemy.gd.
import { EnemyBase } from './EnemyBase.js?v=20260725-4';
import { Projectile } from '../vfx/Projectile.js?v=20260725-4';

export class ShooterEnemy extends EnemyBase {
  constructor() {
    super();
    this.projectileSpeed = 8;
    this.projectileLife = 3;
    this.kiteDistance = 3;
  }

  init(data, ctx) {
    super.init(data, ctx);
    this.projectileSpeed = data.projectileSpeed ?? 8;
    this.projectileLife = data.projectileLife ?? 3;
    this.kiteDistance = data.kiteDistance ?? 3;
  }

  tickBehavior(dt) {
    const r = this.ctx.robot;
    const dx = r.x - this.x, dy = r.y - this.y;
    const dist = Math.hypot(dx, dy) || 1;
    const dirX = dx / dist, dirY = dy / dist;
    if (dist < this.kiteDistance) {
      this.state = 'kiting';
      const next = this.ctx.clampToArena({ x: this.x - dirX * this.moveSpeed * dt, y: this.y - dirY * this.moveSpeed * dt });
      this.x = next.x; this.y = next.y;
    } else if (dist > this.attackRange) {
      this.state = 'chasing';
      const next = this.ctx.clampToArena({ x: this.x + dirX * this.moveSpeed * dt, y: this.y + dirY * this.moveSpeed * dt });
      this.x = next.x; this.y = next.y;
    } else {
      this.state = 'attacking';
      if (this.attackTimer <= 0) {
        this._fireAt({ x: r.x, y: r.y });
        this.attackTimer = this.attackCooldown;
      }
    }
  }

  _fireAt(target) {
    const p = new Projectile();
    const dx = target.x - this.x, dy = target.y - this.y;
    const len = Math.hypot(dx, dy) || 1;
    p.setup(
      { x: this.x, y: this.y },
      { x: dx / len, y: dy / len },
      this.projectileSpeed,
      this.projectileLife,
      this.damage,
      'enemy',
      false,
      null,
      this.enemyId,
    );
    p.setCtx(this.ctx);
    this.ctx.projectiles.push(p);
  }

  draw(g, scale) {
    if (this.dead) { super.draw(g, scale); return; }
    const rPx = Math.max(this.bodyRadius * scale, 9);
    g.save();
    g.translate(this.x * scale, this.y * scale);
    
    // Rotate towards target player
    const r = this.ctx.robot;
    if (r) {
      const angle = Math.atan2(r.y - this.y, r.x - this.x);
      g.rotate(angle);
    }
    
    g.shadowColor = '#ff9d3e';
    g.shadowBlur = 8;
    g.strokeStyle = '#ff9d3e';
    g.lineWidth = 2;
    
    // Hexagonal Hover chassis
    g.fillStyle = '#1e140a';
    g.beginPath();
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      const px = Math.cos(a) * rPx;
      const py = Math.sin(a) * rPx;
      if (i === 0) g.moveTo(px, py); else g.lineTo(px, py);
    }
    g.closePath();
    g.fill();
    g.stroke();
    
    // Spinning stabilizer rings (draw as ellipse overlay)
    g.shadowBlur = 0;
    g.strokeStyle = 'rgba(255, 157, 62, 0.4)';
    g.lineWidth = 1;
    g.beginPath();
    g.arc(0, 0, rPx * 1.3, 0, Math.PI * 2);
    g.stroke();
    
    // Weapon pod nozzle pointing forward
    g.fillStyle = '#ff9d3e';
    g.shadowBlur = 6;
    g.fillRect(rPx * 0.35, -rPx * 0.18, rPx * 0.65, rPx * 0.36);
    
    g.restore();

    // Laser sight aiming reticle (if close to firing)
    if (this.attackTimer > 0 && this.attackTimer < 0.6) {
      const r = this.ctx.robot;
      if (r) {
        g.save();
        g.strokeStyle = 'rgba(255, 157, 62, 0.5)';
        g.lineWidth = 1;
        g.setLineDash([4, 4]);
        g.beginPath();
        g.moveTo(this.x * scale, this.y * scale);
        g.lineTo(r.x * scale, r.y * scale);
        g.stroke();
        
        // Target crosshair reticle at player position
        g.strokeStyle = 'rgba(255, 157, 62, 0.75)';
        g.setLineDash([]);
        g.lineWidth = 1.5;
        g.beginPath();
        g.arc(r.x * scale, r.y * scale, 8, 0, Math.PI * 2);
        g.stroke();
        
        g.beginPath();
        g.moveTo(r.x * scale - 12, r.y * scale); g.lineTo(r.x * scale + 12, r.y * scale);
        g.moveTo(r.x * scale, r.y * scale - 12); g.lineTo(r.x * scale, r.y * scale + 12);
        g.stroke();
        
        g.restore();
      }
    }
    
    this.drawHpBar(g, scale);
  }
}
