// ShieldRelayEnemy.js — support unit that projects a short-lived damage barrier.
// It creates a second readable interrupt window alongside Repair Drone: the
// player must decide whether to break the cast or burn through the protected
// target while the relay retreats from close pressure.

import { EnemyBase } from './EnemyBase.js?v=20260725-4';
import { AudioManager } from '../systems/AudioManager.js?v=20260725-4';
import { spawnBurst } from '../vfx/ParticleSystem.js?v=20260725-4';
import { t } from '../i18n/I18n.js?v=20260725-4';

export class ShieldRelayEnemy extends EnemyBase {
  constructor() {
    super();
    this.relayState = 'seeking'; // seeking / casting / retreating
    this.shieldTarget = null;
    this.shieldTimer = 0;
    this.shieldCooldownTimer = 0;
    this.shieldRange = 5.5;
    this.shieldReduction = 0.55;
    this.shieldDuration = 4.5;
    this.shieldTelegraph = 1.2;
    this.retreatDistance = 4.5;
    this.pulseAngle = 0;
  }

  init(data, ctx) {
    super.init(data, ctx);
    this.shieldRange = Math.max(1, Number(data.shieldRange) || 5.5);
    this.shieldReduction = Math.max(0, Math.min(0.9, Number(data.shieldReduction) || 0.55));
    this.shieldDuration = Math.max(0.4, Number(data.shieldDuration) || 4.5);
    this.shieldTelegraph = Math.max(0.2, Number(data.shieldTelegraph) || 1.2);
    this.retreatDistance = Math.max(1.5, Number(data.retreatDistance) || 4.5);
    this.relayState = 'seeking';
    this.shieldTarget = null;
    this.shieldTimer = 0;
    this.shieldCooldownTimer = 0;
    this.pulseAngle = 0;
  }

  isCasting() {
    return this.relayState === 'casting';
  }

  isShielding() {
    return !this.isCasting() && this.shieldTimer > 0 && this.shieldTarget &&
      !this.shieldTarget.dead && this.shieldTarget.damageShieldSource === this &&
      this.shieldTarget.damageShieldTimer > 0;
  }

  interrupt() {
    if (!this.isCasting()) return;
    this.relayState = 'seeking';
    this.shieldTarget = null;
    this.shieldTimer = 0;
    this.shieldCooldownTimer = Math.max(this.shieldCooldownTimer, 1.8);
    this.ctx?.hud?.logConsole(t('log.shieldInterrupted'), 'success');
  }

  _findShieldTarget() {
    let best = null;
    let bestScore = -Infinity;
    for (const enemy of this.ctx?.enemies || []) {
      if (!enemy || enemy === this || enemy.dead || enemy.enemyId === 'repair_drone' || enemy.enemyId === 'shield_drone') continue;
      const hpRatio = enemy.maxHp > 0 ? enemy.hp / enemy.maxHp : 1;
      const isBoss = enemy.enemyId === 'boss_warden' || enemy.enemyId === 'apex_warden';
      const score = (1 - hpRatio) * 2 + (isBoss ? 0.65 : 0) + Math.min(0.25, enemy.damage / 100);
      if (score > bestScore) {
        best = enemy;
        bestScore = score;
      }
    }
    return best;
  }

  _moveToward(target, dt, speedMul = 1) {
    const dx = target.x - this.x;
    const dy = target.y - this.y;
    const distance = Math.hypot(dx, dy) || 1;
    const next = this.ctx.clampToArena({
      x: this.x + (dx / distance) * this.moveSpeed * speedMul * dt,
      y: this.y + (dy / distance) * this.moveSpeed * speedMul * dt,
    });
    this.x = next.x;
    this.y = next.y;
  }

  _moveAway(target, dt, speedMul = 1) {
    const dx = this.x - target.x;
    const dy = this.y - target.y;
    const distance = Math.hypot(dx, dy) || 1;
    const next = this.ctx.clampToArena({
      x: this.x + (dx / distance) * this.moveSpeed * speedMul * dt,
      y: this.y + (dy / distance) * this.moveSpeed * speedMul * dt,
    });
    this.x = next.x;
    this.y = next.y;
  }

  _clearShield() {
    if (this.shieldTarget?.damageShieldSource === this) {
      this.shieldTarget.damageShieldTimer = 0;
      this.shieldTarget.damageShieldMultiplier = 1;
      this.shieldTarget.damageShieldSource = null;
    }
    this.shieldTimer = 0;
    this.shieldTarget = null;
  }

  _completeShield() {
    const target = this.shieldTarget;
    if (target && !target.dead) {
      if (target.damageShieldSource && target.damageShieldSource !== this) {
        target.damageShieldSource._clearShield();
      }
      target.damageShieldTimer = this.shieldDuration;
      target.damageShieldMultiplier = this.shieldReduction;
      target.damageShieldSource = this;
      this.shieldTimer = this.shieldDuration;
      this.ctx.tracker.recordEnemyShield(target.enemyId, this.shieldDuration);
      spawnBurst(this.ctx, target.x, target.y, '#6ab8ff', 14, 3.8, 0.4, 3);
      this.ctx.hud?.logConsole(t('log.enemyShield', { value: Math.round((1 - this.shieldReduction) * 100) }), 'warn');
      AudioManager.play('shield_on', target.x);
    } else {
      this.shieldTarget = null;
    }
    this.relayState = 'seeking';
    this.shieldCooldownTimer = Math.max(this.attackCooldown, 0.6);
  }

  tickBehavior(dt) {
    const robot = this.ctx.robot;
    if (!robot || robot.dead) return;
    this.pulseAngle += dt * 3.2;
    this.shieldCooldownTimer = Math.max(0, this.shieldCooldownTimer - dt);
    if (this.shieldTarget?.dead) this._clearShield();
    if (!this.isCasting() && this.shieldTimer > 0) {
      this.shieldTimer = Math.max(0, this.shieldTimer - dt);
      if (this.shieldTimer === 0) this._clearShield();
    }

    if (this.isCasting()) {
      this.state = 'casting';
      this.shieldTimer -= dt;
      if (this.shieldTimer <= 0) this._completeShield();
      return;
    }

    const robotDistance = Math.hypot(robot.x - this.x, robot.y - this.y);
    if (robotDistance < this.retreatDistance) {
      this.relayState = 'retreating';
      this.state = 'retreating';
      this._moveAway(robot, dt, 1.15);
      return;
    }

    const target = this._findShieldTarget();
    this.relayState = 'seeking';
    if (target) {
      const targetDistance = Math.hypot(target.x - this.x, target.y - this.y);
      if (targetDistance <= this.shieldRange && this.shieldCooldownTimer <= 0 && !target.damageShieldTimer) {
        this.relayState = 'casting';
        this.shieldTarget = target;
        this.shieldTimer = this.shieldTelegraph;
        this.state = 'casting';
        return;
      }
      if (targetDistance > this.shieldRange * 0.78) {
        this.state = 'chasing';
        this._moveToward(target, dt, 0.9);
        return;
      }
      this.state = 'guarding';
      return;
    }

    if (robotDistance > this.shieldRange) {
      this.state = 'chasing';
      this._moveToward(robot, dt, 0.55);
    } else {
      this.state = 'guarding';
    }
  }

  draw(g, scale) {
    if (this.dead) { super.draw(g, scale); return; }
    const rPx = Math.max(this.bodyRadius * scale, 9);
    const pulse = 0.5 + 0.5 * Math.sin(this.pulseAngle);
    g.save();
    g.translate(this.x * scale, this.y * scale);
    g.rotate(this.pulseAngle * 0.28);
    g.shadowColor = '#6ab8ff';
    g.shadowBlur = 10 + pulse * 8;
    g.strokeStyle = '#6ab8ff';
    g.lineWidth = 2;
    g.fillStyle = '#081b32';
    g.beginPath();
    for (let i = 0; i < 6; i += 1) {
      const angle = (i / 6) * Math.PI * 2 - Math.PI / 6;
      const x = Math.cos(angle) * rPx;
      const y = Math.sin(angle) * rPx;
      if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
    }
    g.closePath();
    g.fill();
    g.stroke();
    g.shadowBlur = 0;
    g.strokeStyle = `rgba(190, 225, 255, ${0.55 + pulse * 0.4})`;
    g.beginPath();
    g.moveTo(-rPx * 0.55, 0); g.lineTo(rPx * 0.55, 0);
    g.moveTo(0, -rPx * 0.55); g.lineTo(0, rPx * 0.55);
    g.stroke();
    g.restore();

    if (this.isShielding()) {
      g.save();
      g.strokeStyle = `rgba(106, 184, 255, ${0.3 + pulse * 0.35})`;
      g.lineWidth = 2;
      g.setLineDash([5, 4]);
      g.beginPath();
      g.arc(this.shieldTarget.x * scale, this.shieldTarget.y * scale,
        (this.shieldTarget.bodyRadius + 0.45 + pulse * 0.18) * scale, 0, Math.PI * 2);
      g.stroke();
      g.setLineDash([]);
      g.restore();
    }

    if (this.isCasting()) {
      const progress = 1 - this.shieldTimer / this.shieldTelegraph;
      g.save();
      g.strokeStyle = `rgba(106, 184, 255, ${0.4 + progress * 0.5})`;
      g.lineWidth = 2;
      g.beginPath();
      g.arc(this.x * scale, this.y * scale, (this.bodyRadius + 0.35 + progress * 0.55) * scale, 0, Math.PI * 2);
      g.stroke();
      if (this.shieldTarget && !this.shieldTarget.dead) {
        g.strokeStyle = 'rgba(106, 184, 255, 0.35)';
        g.setLineDash([4, 4]);
        g.beginPath();
        g.moveTo(this.x * scale, this.y * scale);
        g.lineTo(this.shieldTarget.x * scale, this.shieldTarget.y * scale);
        g.stroke();
        g.setLineDash([]);
      }
      g.restore();
    }
    this.drawHpBar(g, scale);
  }
}
