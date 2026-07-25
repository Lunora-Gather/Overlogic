// Projectile.js — bullet. Player bullets damage enemies; enemy bullets damage robot.
// Mirrors scripts/vfx/Projectile.gd. Pure class with tick + draw.

import { AudioManager } from '../systems/AudioManager.js?v=20260725-4';
import { spawnBurst, spawnEngineTrail, spawnText } from './ParticleSystem.js?v=20260725-4';
import { t } from '../i18n/I18n.js?v=20260725-4';

export class Projectile {
  constructor() {
    this.x = 0; this.y = 0;
    this.dir = { x: 0, y: 0 };
    this.speed = 12; this.life = 2; this.dmg = 8;
    this.kind = 'basic';      // basic / interrupt / enemy
    this.fromPlayer = true;
    this.specificTarget = null;
    this.sourceKind = null;
    this.ctx = null;
    this.dead = false;
  }

  setup(start, dir, speed, life, dmg, kind, fromPlayer, specificTarget = null, sourceKind = null) {
    this.x = start.x; this.y = start.y;
    const len = Math.hypot(dir.x, dir.y) || 1;
    this.dir = { x: dir.x / len, y: dir.y / len };
    this.speed = speed; this.life = life; this.dmg = dmg;
    this.kind = kind; this.fromPlayer = fromPlayer;
    this.specificTarget = specificTarget;
    this.sourceKind = sourceKind;
  }

  setCtx(ctx) { this.ctx = ctx; }

  // dt is combat-speed-scaled.
  tick(dt) {
    if (!this.ctx || this.dead) return;
    // Mild homing for interrupt toward specific target
    if (this.specificTarget && !this.specificTarget.dead) {
      const dx = this.specificTarget.x - this.x, dy = this.specificTarget.y - this.y;
      const len = Math.hypot(dx, dy) || 1;
      this.dir = { x: dx / len, y: dy / len };
    }
    this.x += this.dir.x * this.speed * dt;
    this.y += this.dir.y * this.speed * dt;
    this.life -= dt;

    // Spawn flight trail particles
    const trailColor = this.fromPlayer
      ? (this.kind === 'basic' ? 'rgba(0, 210, 255, 0.25)' : 'rgba(255, 226, 75, 0.3)')
      : (this.kind === 'boss_enraged' ? 'rgba(210, 62, 255, 0.25)' : 'rgba(255, 106, 77, 0.25)');
    spawnEngineTrail(this.ctx, this.x, this.y, trailColor, this.fromPlayer ? 0.08 : (this.kind === 'boss_enraged' ? 0.15 : 0.12));

    if (this.life <= 0) { this._destroy(); return; }
    if (this.fromPlayer) {
      for (const e of this.ctx.enemies) {
        if (e.dead) continue;
        if (Math.hypot(e.x - this.x, e.y - this.y) <= e.bodyRadius + 0.15) {
          const wasCasting = e.isCasting();
          e.takeDamage(this.dmg, this.kind);
          
          // Heavy Impact Stun check
          const r = this.ctx.robot;
          if (this.kind === 'basic' && r && r.stats && r.stats.stat('heavy_impact', 0) > 0) {
            if ((this.ctx.random || Math.random)() < 0.25) {
              e.stunTimer = 0.8;
              spawnText(this.ctx, e.x, e.y - e.bodyRadius - 0.2, 'STUN', '#ffda79', 11);
              if (this.ctx && this.ctx.hud) {
                this.ctx.hud.logConsole(t('log.heavyImpact'), 'success');
              }
            }
          }

          if (this.kind === 'interrupt') {
            e.interrupt();
            if (wasCasting) {
              this.ctx.tracker.recordInterruptSuccess();
              this.ctx.overlogic.addEvent('precision_interrupt', 8);
              AudioManager.play('interrupt_success', this.x);
            }
          }
          this._destroy();
          return;
        }
      }
    } else {
      const r = this.ctx.robot;
      if (r && !r.dead && Math.hypot(r.x - this.x, r.y - this.y) <= r.bodyRadius + 0.15) {
        r.takeDamage(this.dmg, this.sourceKind || 'projectile');
        this._destroy();
      }
    }
  }

  _destroy() {
    this.dead = true;
    const i = this.ctx.projectiles.indexOf(this);
    if (i >= 0) this.ctx.projectiles.splice(i, 1);

    // Spawn burst of sparks on hit/expiration
    const sparkColor = this.fromPlayer
      ? (this.kind === 'basic' ? '#00d2ff' : '#ffe24b')
      : (this.kind === 'boss_enraged' ? '#d23eff' : '#ff6a4d');
    spawnBurst(this.ctx, this.x, this.y, sparkColor, 8, 4, 0.25, 3.5);
  }

  draw(g, scale) {
    const size = this.fromPlayer ? 0.08 : (this.kind === 'boss_enraged' ? 0.15 : 0.12); // size in meters
    const angle = Math.atan2(this.dir.y, this.dir.x);
    const color = this.fromPlayer
      ? (this.kind === 'basic' ? '#00d2ff' : '#ffe24b')
      : (this.kind === 'boss_enraged' ? '#d23eff' : '#ff6a4d');

    g.save();
    g.translate(this.x * scale, this.y * scale);
    g.rotate(angle);

    // Draw glowing energy capsule
    g.shadowColor = color;
    g.shadowBlur = 8;
    g.fillStyle = color;

    const length = size * 3.5 * scale;
    const width = size * scale;

    g.beginPath();
    g.arc(0, 0, width / 2, -Math.PI / 2, Math.PI / 2);
    g.lineTo(-length, width / 2);
    g.arc(-length, 0, width / 2, Math.PI / 2, -Math.PI / 2);
    g.closePath();
    g.fill();

    g.restore();
  }
}
