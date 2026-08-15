// ParticleSystem.js — advanced particle system supporting sparks, thrusters, shockwaves, and floating numbers.
// Mirrors scripts/vfx/ParticleSystem.gd.

import { GameState } from '../core/GameState.js?v=20260725-4';

function reducedMotion() {
  return GameState.settings?.reduceMotion === true;
}

export class Particle {
  constructor(x, y, vx, vy, life, color, size, type = 'spark', text = '') {
    this.x = x; this.y = y; this.vx = vx; this.vy = vy;
    this.life = life; this.maxLife = life;
    this.color = color; this.size = size;
    this.type = type; // spark / engine / shockwave / text
    this.text = text;
    this.dead = false;
  }

  tick(dt, ctx = null) {
    if (this.type !== 'beam') {
      this.x += this.vx * dt;
      this.y += this.vy * dt;
    }
    if (this.type === 'spark') {
      // decelerate sparks over time
      this.vx *= Math.exp(-2.5 * dt);
      this.vy *= Math.exp(-2.5 * dt);
    }

    // Dynamic physical push from active shockwaves
    if (ctx && ctx.particles && (this.type === 'spark' || this.type === 'engine')) {
      for (const sw of ctx.particles) {
        if (sw.type === 'shockwave' && !sw.dead) {
          const dx = this.x - sw.x;
          const dy = this.y - sw.y;
          const dist = Math.hypot(dx, dy);
          const swProgress = 1 - (sw.life / sw.maxLife);
          const currentRadius = sw.size * (1 - (1 - swProgress) * (1 - swProgress));
          if (dist > 0.05 && dist < currentRadius) {
            // Push away from shockwave center
            const pushForce = (1 - dist / currentRadius) * 15 * (sw.life / sw.maxLife) * dt;
            this.x += (dx / dist) * pushForce;
            this.y += (dy / dist) * pushForce;
          }
        }
      }
    }

    this.life -= dt;
    if (this.life <= 0) this.dead = true;
  }

  draw(g, scale) {
    const a = Math.max(0, this.life / this.maxLife);
    g.save();
    
    if (this.type === 'shockwave') {
      g.globalAlpha = a * 0.7;
      g.strokeStyle = this.color;
      g.lineWidth = 1.5 + (1 - a) * 4;
      g.beginPath();
      // size is the final radius in meters, expands from 0 to size
      const currentRadius = this.size * (1 - a * a); // ease out expansion
      g.arc(this.x * scale, this.y * scale, currentRadius * scale, 0, Math.PI * 2);
      g.stroke();
    } else if (this.type === 'text') {
      g.globalAlpha = a;
      g.fillStyle = this.color;
      g.font = `bold ${Math.round(11 + a * 4)}px "SF Mono", monospace`;
      g.textAlign = 'center';
      g.shadowColor = 'rgba(0,0,0,0.8)';
      g.shadowBlur = 3;
      g.fillText(this.text, this.x * scale, this.y * scale);
    } else if (this.type === 'engine') {
      g.globalAlpha = a * 0.8;
      const rad = this.size * (0.3 + a * 0.7) * scale;
      const grad = g.createRadialGradient(
        this.x * scale, this.y * scale, 0,
        this.x * scale, this.y * scale, rad
      );
      grad.addColorStop(0, this.color);
      grad.addColorStop(0.3, this.color);
      grad.addColorStop(1, 'transparent');
      g.fillStyle = grad;
      g.beginPath();
      g.arc(this.x * scale, this.y * scale, rad, 0, Math.PI * 2);
      g.fill();
    } else if (this.type === 'beam') {
      g.globalAlpha = a * 0.85;
      g.strokeStyle = this.color;
      g.lineWidth = this.size * a;
      g.shadowColor = this.color;
      g.shadowBlur = 10 * a;
      g.beginPath();
      g.moveTo(this.x * scale, this.y * scale);
      g.lineTo(this.vx * scale, this.vy * scale);
      g.stroke();
    } else { // spark
      g.globalAlpha = a;
      g.fillStyle = this.color;
      g.shadowColor = this.color;
      g.shadowBlur = 4;
      const s = this.size * (0.5 + a * 0.5);
      g.fillRect(this.x * scale - s/2, this.y * scale - s/2, s, s);
    }

    g.restore();
  }
}

export function spawnBurst(ctx, x, y, color, count = 8, speed = 4, life = 0.3, size = 4) {
  if (!ctx || !ctx.particles) return;
  if (reducedMotion()) {
    // Keep a small, short-lived confirmation spark for state changes without
    // flooding reduced-motion users with expanding particle fields.
    count = Math.max(1, Math.ceil(count * 0.2));
    life *= 0.55;
  }
  if (ctx.particles.length > 300) ctx.particles.splice(0, ctx.particles.length - 300);
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2 + (Math.random() - 0.5) * 0.4;
    const sp = speed * (0.4 + Math.random() * 0.6);
    ctx.particles.push(new Particle(x, y, Math.cos(a) * sp, Math.sin(a) * sp, life * (0.8 + Math.random()*0.4), color, size, 'spark'));
  }
}

export function spawnEngineTrail(ctx, x, y, color, size = 0.25) {
  if (!ctx || !ctx.particles) return;
  if (reducedMotion()) return;
  if (ctx.particles.length > 300) ctx.particles.splice(0, ctx.particles.length - 300);
  // slight drift backward/random
  const angle = Math.random() * Math.PI * 2;
  const speed = 0.2 + Math.random() * 0.3;
  ctx.particles.push(new Particle(
    x, y, 
    Math.cos(angle) * speed, Math.sin(angle) * speed, 
    0.3 + Math.random() * 0.2, 
    color, 
    size, 
    'engine'
  ));
}

export function spawnShockwave(ctx, x, y, color, maxRadius = 2.0, life = 0.4) {
  if (!ctx || !ctx.particles) return;
  if (reducedMotion()) return;
  ctx.particles.push(new Particle(x, y, 0, 0, life, color, maxRadius, 'shockwave'));
}

export function spawnText(ctx, x, y, text, color, size = 12) {
  if (!ctx || !ctx.particles) return;
  // float upward with a bit of random horizontal sway
  const vx = (Math.random() - 0.5) * 0.6;
  const vy = -1.5 - Math.random() * 0.5;
  ctx.particles.push(new Particle(x, y, vx, vy, 0.8, color, size, 'text', text));
}

export function spawnReflectBeam(ctx, sx, sy, tx, ty, color = '#00d2ff') {
  if (!ctx || !ctx.particles) return;
  if (ctx.particles.length > 300) ctx.particles.splice(0, ctx.particles.length - 300);
  ctx.particles.push(new Particle(sx, sy, tx, ty, 0.15, color, 2.5, 'beam'));
}
