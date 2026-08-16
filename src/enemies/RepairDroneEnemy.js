// RepairDroneEnemy.js — support unit that repairs damaged allies.
// It creates a readable interrupt window and rewards the player for using
// enemy_casting -> interrupt_shot with the caster target priority.

import { EnemyBase } from './EnemyBase.js?v=20260725-4';
import { AudioManager } from '../systems/AudioManager.js?v=20260725-4';
import { spawnBurst } from '../vfx/ParticleSystem.js?v=20260725-4';
import { t } from '../i18n/I18n.js?v=20260725-4';

export class RepairDroneEnemy extends EnemyBase {
  constructor() {
    super();
    this.repairState = 'seeking'; // seeking / casting / retreating
    this.repairTarget = null;
    this.repairTimer = 0;
    this.repairCooldownTimer = 0;
    this.repairAmount = 18;
    this.repairRange = 5.5;
    this.repairTelegraph = 1.1;
    this.retreatDistance = 4.5;
    this.pulseAngle = 0;
  }

  init(data, ctx) {
    super.init(data, ctx);
    this.repairAmount = Math.max(0, Number(data.repairAmount) || 18);
    this.repairRange = Math.max(1, Number(data.repairRange) || 5.5);
    this.repairTelegraph = Math.max(0.2, Number(data.repairTelegraph) || 1.1);
    this.retreatDistance = Math.max(1.5, Number(data.retreatDistance) || 4.5);
    this.repairState = 'seeking';
    this.repairTarget = null;
    this.repairTimer = 0;
    this.repairCooldownTimer = 0;
    this.pulseAngle = 0;
  }

  isCasting() {
    return this.repairState === 'casting';
  }

  interrupt() {
    if (!this.isCasting()) return;
    this.repairState = 'seeking';
    this.repairTarget = null;
    this.repairTimer = 0;
    this.repairCooldownTimer = Math.max(this.repairCooldownTimer, 1.6);
    this.ctx?.hud?.logConsole(t('log.repairInterrupted'), 'success');
  }

  _findRepairTarget() {
    let best = null;
    let bestRatio = 0.98;
    for (const enemy of this.ctx?.enemies || []) {
      if (!enemy || enemy === this || enemy.dead || enemy.enemyId === 'repair_drone') continue;
      const ratio = enemy.maxHp > 0 ? enemy.hp / enemy.maxHp : 1;
      if (ratio < bestRatio) {
        best = enemy;
        bestRatio = ratio;
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

  _completeRepair() {
    const target = this.repairTarget;
    if (target && !target.dead) {
      const before = target.hp;
      target.hp = Math.min(target.maxHp, target.hp + this.repairAmount);
      const restored = Math.max(0, target.hp - before);
      if (restored > 0) {
        target.flashTimer = 0.12;
        this.ctx.tracker.recordEnemyRepair(this.enemyId, restored);
        spawnBurst(this.ctx, target.x, target.y, '#55ffb0', 12, 3.5, 0.35, 3);
        this.ctx.hud?.logConsole(t('log.enemyRepair', { value: Math.round(restored) }), 'warn');
        AudioManager.play('shield_on', target.x);
      }
    }
    this.repairTarget = null;
    this.repairState = 'seeking';
    this.repairCooldownTimer = Math.max(this.attackCooldown, 0.5);
  }

  tickBehavior(dt) {
    const robot = this.ctx.robot;
    if (!robot || robot.dead) return;
    this.pulseAngle += dt * 3.5;
    this.repairCooldownTimer = Math.max(0, this.repairCooldownTimer - dt);

    if (this.isCasting()) {
      this.state = 'casting';
      this.repairTimer -= dt;
      if (this.repairTimer <= 0) this._completeRepair();
      return;
    }

    const target = this._findRepairTarget();
    const robotDistance = Math.hypot(robot.x - this.x, robot.y - this.y);
    if (robotDistance < this.retreatDistance) {
      this.repairState = 'retreating';
      this.state = 'retreating';
      this._moveAway(robot, dt, 1.15);
      return;
    }

    this.repairState = 'seeking';
    if (target) {
      const targetDistance = Math.hypot(target.x - this.x, target.y - this.y);
      if (targetDistance <= this.repairRange && this.repairCooldownTimer <= 0) {
        this.repairState = 'casting';
        this.repairTarget = target;
        this.repairTimer = this.repairTelegraph;
        this.state = 'casting';
        return;
      }
      if (targetDistance > this.repairRange * 0.78) {
        this.state = 'chasing';
        this._moveToward(target, dt, 0.9);
        return;
      }
      this.state = 'guarding';
      return;
    }

    // With no damaged ally, hover at a readable distance instead of idling
    // at the arena edge forever. It becomes a real target before it repairs.
    if (robotDistance > this.repairRange) {
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
    g.rotate(this.pulseAngle * 0.35);

    g.shadowColor = '#55ffb0';
    g.shadowBlur = 9 + pulse * 8;
    g.strokeStyle = '#55ffb0';
    g.lineWidth = 2;
    g.fillStyle = '#08261b';
    g.beginPath();
    g.moveTo(rPx, 0);
    g.lineTo(0, rPx);
    g.lineTo(-rPx, 0);
    g.lineTo(0, -rPx);
    g.closePath();
    g.fill();
    g.stroke();
    g.shadowBlur = 0;
    g.strokeStyle = `rgba(190, 255, 220, ${0.55 + pulse * 0.4})`;
    g.lineWidth = 1.5;
    g.beginPath();
    g.moveTo(-rPx * 0.55, 0); g.lineTo(rPx * 0.55, 0);
    g.moveTo(0, -rPx * 0.55); g.lineTo(0, rPx * 0.55);
    g.stroke();
    g.restore();

    if (this.isCasting()) {
      const progress = 1 - this.repairTimer / this.repairTelegraph;
      g.save();
      g.strokeStyle = `rgba(85, 255, 176, ${0.4 + progress * 0.5})`;
      g.lineWidth = 2;
      g.beginPath();
      g.arc(this.x * scale, this.y * scale, (this.bodyRadius + 0.35 + progress * 0.55) * scale, 0, Math.PI * 2);
      g.stroke();
      if (this.repairTarget && !this.repairTarget.dead) {
        g.strokeStyle = 'rgba(85, 255, 176, 0.35)';
        g.setLineDash([4, 4]);
        g.beginPath();
        g.moveTo(this.x * scale, this.y * scale);
        g.lineTo(this.repairTarget.x * scale, this.repairTarget.y * scale);
        g.stroke();
        g.setLineDash([]);
      }
      g.restore();
    }
    this.drawHpBar(g, scale);
  }
}
