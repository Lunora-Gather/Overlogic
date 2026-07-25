// HazardTile.js — environmental pulsing plasma hazard.
// Cycles between Warning state and Active (damaging) state.

import { spawnBurst } from './ParticleSystem.js?v=20260725-3';

export class HazardTile {
  constructor(x, y, radius = 2.0, warnDuration = 1.5, activeDuration = 1.5) {
    this.x = x;
    this.y = y;
    this.radius = radius;
    this.warnDuration = warnDuration;
    this.activeDuration = activeDuration;
    
    this.state = 'warning'; // 'warning' or 'active'
    this.timer = warnDuration;
    this.dmgTimer = 0;
    this.damage = 10; // flat damage per tick
    this.tickInterval = 0.5; // damage every 0.5s when standing on it
  }

  // Returns true if the robot is overlapping this hazard
  isOverlapping(robot) {
    if (!robot || robot.dead) return false;
    const dist = Math.hypot(robot.x - this.x, robot.y - this.y);
    return dist <= this.radius + robot.bodyRadius;
  }

  tick(dt, ctx) {
    this.timer -= dt;
    if (this.timer <= 0) {
      if (this.state === 'warning') {
        this.state = 'active';
        this.timer = this.activeDuration;
        // spawn a burst of sparks when it activates
        spawnBurst(ctx, this.x, this.y, '#ff4757', 12, 6, 0.35, 4.0);
      } else {
        this.state = 'warning';
        this.timer = this.warnDuration;
      }
    }

    // Damage logic
    if (this.state === 'active') {
      if (this.isOverlapping(ctx.robot)) {
        this.dmgTimer -= dt;
        if (this.dmgTimer <= 0) {
          ctx.robot.takeDamage(this.damage, 'plasma_hazard');
          this.dmgTimer = this.tickInterval;
        }
      } else {
        this.dmgTimer = 0;
      }
    }
  }

  draw(g, scale) {
    const rx = this.x * scale;
    const ry = this.y * scale;
    const rRad = this.radius * scale;

    g.save();
    if (this.state === 'warning') {
      // Draw warning indicator (orange, pulsating outline, warning grid)
      const pulse = 0.8 + 0.2 * Math.sin(performance.now() / 100);
      
      // Outer indicator circle
      g.strokeStyle = `rgba(255, 127, 80, ${0.4 * pulse})`;
      g.lineWidth = 2;
      g.setLineDash([6, 4]);
      g.beginPath();
      g.arc(rx, ry, rRad, 0, Math.PI * 2);
      g.stroke();

      // Warning fill (low opacity orange)
      g.fillStyle = `rgba(255, 127, 80, 0.06)`;
      g.beginPath();
      g.arc(rx, ry, rRad, 0, Math.PI * 2);
      g.fill();

      // Draw danger warning sign inside
      g.fillStyle = `rgba(255, 127, 80, ${0.5 * pulse})`;
      g.font = 'bold 10px monospace';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText('⚠️ WARN', rx, ry);
    } else {
      // Active state (pulsating plasma/electric grid, crimson/neon red glow)
      const pulse = 0.9 + 0.1 * Math.sin(performance.now() / 60);
      
      // Outer glowing rim
      g.strokeStyle = 'rgba(255, 71, 87, 0.8)';
      g.lineWidth = 3;
      g.shadowColor = '#ff4757';
      g.shadowBlur = 12 * pulse;
      g.beginPath();
      g.arc(rx, ry, rRad, 0, Math.PI * 2);
      g.stroke();

      // Filling plasma gradient
      const grad = g.createRadialGradient(rx, ry, rRad * 0.2, rx, ry, rRad);
      grad.addColorStop(0, 'rgba(255, 71, 87, 0.25)');
      grad.addColorStop(0.7, 'rgba(255, 71, 87, 0.15)');
      grad.addColorStop(1, 'rgba(255, 71, 87, 0.0)');
      g.fillStyle = grad;
      g.beginPath();
      g.arc(rx, ry, rRad, 0, Math.PI * 2);
      g.fill();

      // Draw plasma warning sign
      g.fillStyle = '#ff4757';
      g.shadowBlur = 4;
      g.font = 'bold 11px monospace';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText('⚡ HAZARD ⚡', rx, ry);
    }
    g.restore();
  }
}
