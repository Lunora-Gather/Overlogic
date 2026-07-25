// Mine.js — static explosive. Detonates when enemy within trigger radius.
// Mirrors scripts/vfx/Mine.gd. Pure class with tick + draw.

import { AudioManager } from '../systems/AudioManager.js?v=20260725-3';
import { spawnBurst, spawnShockwave } from './ParticleSystem.js?v=20260725-3';

export class Mine {
  constructor() {
    this.x = 0; this.y = 0;
    this.triggerRadius = 1.5; this.explosionRadius = 2; this.dmg = 20;
    this.ctx = null; this.armed = true;
    this.dead = false;
    this._pulse = 0;
  }

  setup(start, tr, er, dmg, ctx) {
    this.x = start.x; this.y = start.y;
    this.triggerRadius = tr; this.explosionRadius = er; this.dmg = dmg;
    this.ctx = ctx;
  }

  tick(dt) {
    if (!this.armed || this.dead) return;
    this._pulse += dt;
    for (const e of this.ctx.enemies) {
      if (e.dead) continue;
      if (Math.hypot(e.x - this.x, e.y - this.y) <= this.triggerRadius) {
        this._detonate();
        return;
      }
    }
  }

  _detonate() {
    this.armed = false; this.dead = true;
    for (const e of this.ctx.enemies) {
      if (e.dead) continue;
      if (Math.hypot(e.x - this.x, e.y - this.y) <= this.explosionRadius) {
        e.takeDamage(this.dmg, 'mine');
      }
    }
    
    // Spawn advanced explosion particles
    spawnShockwave(this.ctx, this.x, this.y, 'rgba(80,255,140,0.7)', this.explosionRadius, 0.4);
    spawnBurst(this.ctx, this.x, this.y, '#50ff8c', 16, 5, 0.45, 4.5);
    spawnBurst(this.ctx, this.x, this.y, '#ffd24b', 8, 3, 0.3, 3);

    AudioManager.play('mine_explosion', this.x);
    const i = this.ctx.mines.indexOf(this);
    if (i >= 0) this.ctx.mines.splice(i, 1);
  }

  draw(g, scale) {
    const pulse = 0.5 + 0.5 * Math.sin(this._pulse * 8);
    const radius = 0.25; // mine physical size in meters
    const radPx = radius * scale;
    
    g.save();
    g.translate(this.x * scale, this.y * scale);
    
    // Rotating outer ring
    g.rotate(this._pulse * 1.5);
    g.strokeStyle = 'rgba(80,255,140,0.5)';
    g.lineWidth = 1.5;
    g.beginPath();
    g.arc(0, 0, radPx, 0, Math.PI * 2);
    g.stroke();
    
    // Draw 3 internal cyber-spokes
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2;
      g.beginPath();
      g.moveTo(0, 0);
      g.lineTo(Math.cos(a) * radPx, Math.sin(a) * radPx);
      g.stroke();
    }
    
    // Blinking core
    g.fillStyle = `rgba(80,255,140,${0.3 + pulse * 0.7})`;
    g.shadowColor = '#50ff8c';
    g.shadowBlur = 8;
    g.beginPath();
    g.arc(0, 0, radPx * 0.45, 0, Math.PI * 2);
    g.fill();
    
    g.restore();
    
    // Draw outer trigger range ring in world space
    g.strokeStyle = `rgba(80,255,140,${0.08 + pulse * 0.08})`;
    g.lineWidth = 1;
    g.beginPath();
    g.arc(this.x * scale, this.y * scale, this.triggerRadius * scale, 0, Math.PI * 2);
    g.stroke();
  }
}
