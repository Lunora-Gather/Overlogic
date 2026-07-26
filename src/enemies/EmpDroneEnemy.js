// EmpDroneEnemy.js — fast harassment drone that drains robot energy on close contact.
// Behavior: approach → EMP drain → retreat. Yellow color, small body.
import { EnemyBase } from './EnemyBase.js?v=20260725-4';
import { spawnBurst } from '../vfx/ParticleSystem.js?v=20260725-4';
import { AudioManager } from '../systems/AudioManager.js?v=20260725-4';
import { t } from '../i18n/I18n.js?v=20260725-4';

export class EmpDroneEnemy extends EnemyBase {
  constructor() {
    super();
    this.droneState = 'approach'; // approach / retreating / cooldown
    this.stateTimer = 0;
    this.empCooldownTimer = 0;
    this.pulseAngle = 0;
  }

  isCasting() {
    return this.droneState === 'approach' && this.empCooldownTimer <= 0;
  }

  interrupt() {
    if (this.droneState === 'approach') {
      this.droneState = 'retreating';
      this.stateTimer = 1.2;
      this.empCooldownTimer = 3.0;
    }
  }

  tickBehavior(dt) {
    const r = this.ctx.robot;
    if (!r || r.dead) return;

    this.pulseAngle += dt * 4.0;
    if (this.empCooldownTimer > 0) this.empCooldownTimer -= dt;

    const dx = r.x - this.x, dy = r.y - this.y;
    const dist = Math.hypot(dx, dy) || 1;
    const dirX = dx / dist, dirY = dy / dist;

    switch (this.droneState) {
      case 'approach': {
        if (dist <= this.attackRange && this.empCooldownTimer <= 0) {
          // EMP drain
          const drain = this.data?.empEnergyDrain || 40;
          r.energy = Math.max(0, r.energy - drain);
          if (this.ctx.hud) {
            this.ctx.hud.logConsole(t('log.enemyEmp', { value: drain }), 'warn');
          }
          AudioManager.play('emp_burst');
          spawnBurst(this.ctx, this.x, this.y, '#ffe033', 20, 5, 0.35, 4);
          this.droneState = 'retreating';
          this.stateTimer = 1.5;
          this.empCooldownTimer = 4.0;
        } else if (dist > this.attackRange) {
          // Move toward robot
          const next = this.ctx.clampToArena({
            x: this.x + dirX * this.moveSpeed * dt,
            y: this.y + dirY * this.moveSpeed * dt,
          });
          this.x = next.x; this.y = next.y;
        }
        break;
      }
      case 'retreating': {
        this.stateTimer -= dt;
        // Flee away from robot
        const next = this.ctx.clampToArena({
          x: this.x - dirX * this.moveSpeed * 1.2 * dt,
          y: this.y - dirY * this.moveSpeed * 1.2 * dt,
        });
        this.x = next.x; this.y = next.y;
        if (this.stateTimer <= 0) {
          this.droneState = 'approach';
        }
        break;
      }
    }
  }

  draw(g, scale) {
    if (this.dead) { super.draw(g, scale); return; }

    const rPx = Math.max(this.bodyRadius * scale, 9);
    const pulse = 0.5 + 0.5 * Math.sin(this.pulseAngle);

    g.save();
    g.translate(this.x * scale, this.y * scale);

    // Outer glow ring
    g.shadowColor = '#ffe033';
    g.shadowBlur = 10 + pulse * 8;
    g.strokeStyle = `rgba(255, 224, 51, ${0.5 + pulse * 0.5})`;
    g.lineWidth = 1.5;
    g.beginPath();
    g.arc(0, 0, rPx * 1.6, 0, Math.PI * 2);
    g.stroke();

    // Body
    g.fillStyle = '#1a1200';
    g.strokeStyle = '#ffe033';
    g.lineWidth = 2;
    g.shadowBlur = 6;
    // Hexagonal drone body
    g.beginPath();
    for (let i = 0; i < 6; i++) {
      const angle = (i / 6) * Math.PI * 2 - Math.PI / 6;
      const px = Math.cos(angle) * rPx;
      const py = Math.sin(angle) * rPx;
      if (i === 0) g.moveTo(px, py); else g.lineTo(px, py);
    }
    g.closePath();
    g.fill();
    g.stroke();

    // Center emitter
    g.fillStyle = `rgba(255, 224, 51, ${0.6 + pulse * 0.4})`;
    g.shadowBlur = 8;
    g.beginPath();
    g.arc(0, 0, rPx * 0.35, 0, Math.PI * 2);
    g.fill();

    // EMP ready indicator
    if (this.empCooldownTimer <= 0) {
      g.strokeStyle = `rgba(255, 224, 51, ${pulse})`;
      g.lineWidth = 1;
      g.setLineDash([3, 3]);
      g.beginPath();
      g.arc(0, 0, rPx * 2.2, 0, Math.PI * 2);
      g.stroke();
      g.setLineDash([]);
    }

    g.restore();
    this.drawHpBar(g, scale);
  }
}
