// CrawlerEnemy.js — basic melee chaser with leap attack.
import { EnemyBase } from './EnemyBase.js?v=20260725-3';
import { spawnBurst, spawnEngineTrail } from '../vfx/ParticleSystem.js?v=20260725-3';
import { AudioManager } from '../systems/AudioManager.js?v=20260725-3';

export class CrawlerEnemy extends EnemyBase {
  constructor() {
    super();
    this.jumpState = 'idle';   // idle / telegraph / leaping
    this.jumpTimer = 0;
    this.targetPos = { x: 0, y: 0 };
    this.startPos = { x: 0, y: 0 };
  }

  isCasting() {
    return this.jumpState === 'telegraph';
  }

  interrupt() {
    if (this.jumpState === 'telegraph') {
      this.jumpState = 'idle';
      this.jumpTimer = 0;
      this.attackTimer = this.attackCooldown;
    }
  }

  tickBehavior(dt) {
    const r = this.ctx.robot;
    if (!r || r.dead) return;
    const dx = r.x - this.x, dy = r.y - this.y;
    const dist = Math.hypot(dx, dy) || 1;
    const dirX = dx / dist, dirY = dy / dist;

    switch (this.jumpState) {
      case 'idle':
        if (dist <= 3.5 && this.attackTimer <= 0) {
          this.jumpState = 'telegraph';
          this.jumpTimer = 0.8;
          this.targetPos = { x: r.x, y: r.y };
        } else {
          this.state = 'chasing';
          const next = this.ctx.clampToArena({ x: this.x + dirX * this.moveSpeed * dt, y: this.y + dirY * this.moveSpeed * dt });
          this.x = next.x; this.y = next.y;
          
          if (Math.random() < 0.18) {
            const [cr, cg, cb] = this.color;
            spawnEngineTrail(this.ctx, this.x, this.y, `rgba(${cr*255|0},${cg*255|0},${cb*255|0},0.2)`, 0.08);
          }
        }
        break;
      case 'telegraph':
        this.state = 'casting';
        this.jumpTimer -= dt;
        if (this.jumpTimer <= 0) {
          this.jumpState = 'leaping';
          this.jumpTimer = 0.4;
          this.startPos = { x: this.x, y: this.y };
        }
        break;
      case 'leaping':
        this.state = 'leaping';
        this.jumpTimer -= dt;
        const t = 1 - Math.max(0, this.jumpTimer) / 0.4;
        this.x = this.startPos.x + (this.targetPos.x - this.startPos.x) * t;
        this.y = this.startPos.y + (this.targetPos.y - this.startPos.y) * t;
        
        if (this.jumpTimer <= 0) {
          this.x = this.targetPos.x;
          this.y = this.targetPos.y;
          this.jumpState = 'idle';
          this.attackTimer = this.attackCooldown;
          
          // Land area damage
          const distToPlayer = Math.hypot(r.x - this.x, r.y - this.y);
          if (distToPlayer <= 1.5) {
            r.takeDamage(this.damage * 1.5, this.enemyId);
          }
          
          // Spawn landing shockwave particles
          spawnBurst(this.ctx, this.x, this.y, '#ff3e3e', 15, 6, 0.4, 5);
          AudioManager.play('mine_explosion');
        }
        break;
    }
  }

  draw(g, scale) {
    if (this.dead) { super.draw(g, scale); return; }
    
    // Draw telegraph landing circle (drawn in world coordinates under the crawler)
    if (this.jumpState === 'telegraph') {
      const t = 1 - this.jumpTimer / 0.8;
      g.save();
      g.strokeStyle = `rgba(255, 62, 62, ${0.4 + t * 0.5})`;
      g.lineWidth = 2;
      g.beginPath();
      g.arc(this.targetPos.x * scale, this.targetPos.y * scale, 1.5 * scale, 0, Math.PI * 2);
      g.stroke();
      
      g.fillStyle = `rgba(255, 62, 62, ${0.08 + t * 0.12})`;
      g.beginPath();
      g.arc(this.targetPos.x * scale, this.targetPos.y * scale, 1.5 * t * scale, 0, Math.PI * 2);
      g.fill();
      g.restore();
    }
    
    // If leaping, draw floor shadow
    const rPx = this.bodyRadius * scale;
    let height = 0;
    if (this.jumpState === 'leaping') {
      const t = 1 - this.jumpTimer / 0.4;
      height = 1.6 * Math.sin(t * Math.PI);
      
      g.save();
      g.fillStyle = 'rgba(0, 0, 0, 0.35)';
      g.beginPath();
      g.arc(this.x * scale, this.y * scale, rPx * (1 - Math.min(0.5, height * 0.3)), 0, Math.PI * 2);
      g.fill();
      g.restore();
    }
    
    g.save();
    // Offset drawing for height if leaping
    g.translate(this.x * scale, (this.y - height) * scale);
    
    // Rotate towards players
    const r = this.ctx.robot;
    if (r) {
      const angle = Math.atan2(r.y - this.y, r.x - this.x);
      g.rotate(angle);
    }
    
    g.shadowColor = '#ff3e3e';
    g.shadowBlur = 8;
    g.strokeStyle = '#ff3e3e';
    g.lineWidth = 2;
    g.fillStyle = '#1e0a0a';
    
    // Body capsule
    g.beginPath();
    g.arc(0, 0, rPx, 0, Math.PI * 2);
    g.fill();
    g.stroke();
    
    // Animated spider-legs walk cycles
    g.strokeStyle = '#ff3e3e';
    g.lineWidth = 1.5;
    g.shadowBlur = 0;
    const walkCycle = Math.sin(performance.now() * 0.015);
    for (let i = 0; i < 4; i++) {
      const legAngle = (i - 1.5) * 0.5 + (i % 2 === 0 ? walkCycle * 0.35 : -walkCycle * 0.35);
      g.beginPath();
      g.moveTo(-rPx * 0.2, (i - 1.5) * rPx * 0.5);
      g.lineTo(-rPx * 0.8 * Math.cos(legAngle), (i - 1.5) * rPx * 0.75 + rPx * 0.45 * Math.sin(legAngle));
      g.stroke();
    }
    
    // Glowing red optical lens
    g.fillStyle = '#ff3e3e';
    g.shadowBlur = 6;
    g.beginPath();
    g.arc(rPx * 0.6, 0, rPx * 0.25, 0, Math.PI * 2);
    g.fill();
    
    g.restore();
    
    this.drawHpBar(g, scale);
  }
}
