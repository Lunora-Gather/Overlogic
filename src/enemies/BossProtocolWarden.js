// BossProtocolWarden.js — 3-phase boss. Mirrors scripts/enemies/BossProtocolWarden.gd.
import { EnemyBase } from './EnemyBase.js?v=20260725-4';
import { Projectile } from '../vfx/Projectile.js?v=20260725-4';
import { AudioManager } from '../systems/AudioManager.js?v=20260725-4';
import { spawnBurst, spawnShockwave } from '../vfx/ParticleSystem.js?v=20260725-4';
import { GameDatabase } from '../core/GameDatabase.js?v=20260725-4';
import { CrawlerEnemy } from './CrawlerEnemy.js?v=20260725-4';

export class BossProtocolWarden extends EnemyBase {
  constructor() {
    super();
    this.currentPhase = 1;
    this.phase2HpPct = 0.65;
    this.phase3HpPct = 0.30;
    this.actionTimer = 0;
    this.summonTimer = 8;
    this.laserTimer = 5;
    this.laserCastingTimer = 0;
    this.laserFiringTimer = 0;
    this.laserActive = false;
    this.laserAngle = 0;
    this.onPhaseChanged = null;
    this.onLaserFire = null;
  }

  init(data, ctx) {
    super.init(data, ctx);
    this.phase2HpPct = data.phase2HpPct ?? 0.65;
    this.phase3HpPct = data.phase3HpPct ?? 0.30;
  }

  isCasting() { return this.laserActive && this.laserCastingTimer > 0; }

  interrupt() {
    if (this.laserActive && this.laserCastingTimer > 0) {
      this.laserActive = false;
      this.laserCastingTimer = 0;
      this.laserTimer = 5;
    }
  }

  takeDamage(amount, kind) {
    if (this.dead) return;
    const oldHp = this.hp;
    super.takeDamage(amount, kind);
    const pct = this.hp / this.maxHp;
    if (this.currentPhase === 1 && pct <= this.phase2HpPct) this._enterPhase(2);
    else if (this.currentPhase === 2 && pct <= this.phase3HpPct) this._enterPhase(3);
    else if (this.currentPhase === 3 && pct <= 0.15) this._enterPhase(4);
    if (this.hp <= 0 && oldHp > 0) {
      spawnBurst(this.ctx, this.x, this.y, 'rgba(255,60,120,0.9)', 24, 7, 0.6, 6);
    }
  }

  _enterPhase(p) {
    this.currentPhase = p;
    if (this.onPhaseChanged) this.onPhaseChanged(p);
    AudioManager.play('boss_phase');
    
    // Spawn advanced screen-wide phase shockwaves and burst sparks
    spawnShockwave(this.ctx, this.x, this.y, 'rgba(255,45,116,0.6)', 5.0, 0.7);
    spawnBurst(this.ctx, this.x, this.y, '#ff2d74', 32, 6, 0.55, 5);

    if (p === 4) {
      this.laserActive = false;
      this.laserCastingTimer = 0;
      this.laserFiringTimer = 0;
      this.orbitAngle = Math.atan2(this.y, this.x);
      this.actionTimer = 0.2;
    }
  }

  tickBehavior(dt) {
    const r = this.ctx.robot;
    const dx = r.x - this.x, dy = r.y - this.y;
    const dist = Math.hypot(dx, dy) || 1;
    const dirX = dx / dist, dirY = dy / dist;
    switch (this.currentPhase) {
      case 1: this._phase1(dt, r, dirX, dirY, dist); break;
      case 2: this._phase2(dt, r, dirX, dirY, dist); break;
      case 3: this._phase3(dt, r, dirX, dirY); break;
      case 4: this._phase4(dt, r); break;
    }
  }

  _phase4(dt, r) {
    // 1. Orbit rapidly around (0,0)
    // Keep tangential speed below the basic projectile speed. At 2 rad/s the
    // boss moved ~13 m/s and could become effectively unhittable by the
    // 12 m/s starter weapon, turning the last phase into a reward-lock.
    this.orbitAngle = (this.orbitAngle || 0) + dt * 0.55;
    const orbitRadius = 6.5;
    this.x = Math.cos(this.orbitAngle) * orbitRadius;
    this.y = Math.sin(this.orbitAngle) * orbitRadius;

    // 2. Bullet hell spray
    this.actionTimer -= dt;
    if (this.actionTimer <= 0) {
      const baseAng = (this.ctx.time / 0.6) % (Math.PI * 2);
      for (let i = 0; i < 6; i++) {
        const ang = baseAng + (i / 6) * Math.PI * 2;
        const p = new Projectile();
        p.setup(
          { x: this.x, y: this.y },
          { x: Math.cos(ang), y: Math.sin(ang) },
          7.0, // speed
          3.0, // life
          6,   // dmg
          'boss_enraged',
          false,
          null,
          this.enemyId,
        );
        p.setCtx(this.ctx);
        this.ctx.projectiles.push(p);
      }
      this.actionTimer = 0.55;
      AudioManager.play('basic_attack');
    }
  }

  _phase1(dt, r, dirX, dirY, dist) {
    this.actionTimer -= dt;
    if (this.actionTimer <= 0) {
      this._fireSpread({ x: r.x, y: r.y }, 3, 10, 6, 10);
      this.actionTimer = 1.8;
    }
    if (dist < 3 && this.attackTimer <= 0) {
      this.ctx.robot.takeDamage(15, this.enemyId);
      this.attackTimer = 1.5;
    }
  }

  _phase2(dt, r, dirX, dirY, dist) {
    this.actionTimer -= dt;
    if (this.actionTimer <= 0) {
      this._fireSpread({ x: r.x, y: r.y }, 3, 10, 6, 10);
      this.actionTimer = 1.3;
    }
    this.summonTimer -= dt;
    if (this.summonTimer <= 0) {
      this._summonCrawler();
      this.summonTimer = 8;
    }
    if (dist > 4) {
      const next = this.ctx.clampToArena({ x: this.x + dirX * this.moveSpeed * dt, y: this.y + dirY * this.moveSpeed * dt });
      this.x = next.x; this.y = next.y;
    }
  }

  _phase3(dt, r, dirX, dirY) {
    if (this.laserFiringTimer > 0) {
      this.laserFiringTimer -= dt;
      if (this.laserFiringTimer <= 0) {
        this.laserActive = false;
        this.laserTimer = 5;
      }
      return;
    }
    if (!this.laserActive) {
      this.laserTimer -= dt;
      if (this.laserTimer <= 0) {
        this.laserActive = true;
        this.laserCastingTimer = 1.5;
        this.laserAngle = Math.atan2(r.y - this.y, r.x - this.x);
      }
    } else {
      this.laserCastingTimer -= dt;
      if (this.laserCastingTimer <= 0) {
        this._checkLaserHit({ x: r.x, y: r.y });
        this.laserFiringTimer = 0.4; // Keep laser firing visible for 0.4s
        if (this.onLaserFire) this.onLaserFire();
      }
    }
  }

  _checkLaserHit(robotPos) {
    const r = this.ctx.robot;
    if (!r || r.dead) return;
    const dx = robotPos.x - this.x, dy = robotPos.y - this.y;
    const localX = dx * Math.cos(-this.laserAngle) - dy * Math.sin(-this.laserAngle);
    const localY = dx * Math.sin(-this.laserAngle) + dy * Math.cos(-this.laserAngle);
    const rad = r.bodyRadius || 0.4;
    if (localX >= -rad && localX <= 8 + rad && Math.abs(localY) <= 1.5 + rad) {
      r.takeDamage(30, this.enemyId);
    }
  }

  _fireSpread(target, count, dmg, speed, spreadDeg) {
    const baseAng = Math.atan2(target.y - this.y, target.x - this.x);
    const spread = spreadDeg * Math.PI / 180;
    for (let i = 0; i < count; i++) {
      const offset = spread * (i - (count - 1) / 2);
      const ang = baseAng + offset;
      const p = new Projectile();
      p.setup(
        { x: this.x, y: this.y },
        { x: Math.cos(ang), y: Math.sin(ang) },
        speed,
        3,
        dmg,
        'enemy',
        false,
        null,
        this.enemyId,
      );
      p.setCtx(this.ctx);
      this.ctx.projectiles.push(p);
    }
  }

  _summonCrawler() {
    let live = 0;
    for (const e of this.ctx.enemies) if (!e.dead && e.enemyId === 'crawler') live += 1;
    if (live >= 4) return;
    for (let i = 0; i < 2; i++) {
      if (live >= 4) break;
      const crawlerData = GameDatabase.getEnemy('crawler');
      const crawler = new CrawlerEnemy();
      crawler.init(crawlerData, this.ctx);
      const ang = (this.ctx.random || Math.random)() * Math.PI * 2;
      const pos = this.ctx.clampToArena({ x: this.x + Math.cos(ang) * 1.5, y: this.y + Math.sin(ang) * 1.5 });
      crawler.x = pos.x; crawler.y = pos.y;
      this.ctx.enemies.push(crawler);
      live += 1;
    }
  }

  draw(g, scale) {
    super.draw(g, scale);
    
    // laser telegraph (glowing red outline boundary lane)
    if (this.laserActive && this.laserCastingTimer > 0) {
      const t = 1 - this.laserCastingTimer / 1.5;
      g.save();
      g.translate(this.x * scale, this.y * scale);
      g.rotate(this.laserAngle);
      g.fillStyle = `rgba(255,40,40,${0.15 + t * 0.2})`;
      g.fillRect(0, -1.5 * scale, 8 * scale, 3 * scale);
      g.strokeStyle = `rgba(255,80,80,${0.4 + t * 0.4})`;
      g.lineWidth = 1.5;
      g.strokeRect(0, -1.5 * scale, 8 * scale, 3 * scale);
      g.restore();
    }
    
    // laser Firing graphics
    if (this.laserFiringTimer > 0) {
      g.save();
      g.translate(this.x * scale, this.y * scale);
      g.rotate(this.laserAngle);
      
      const beamW = 8 * scale;
      const beamH = 3 * scale;
      
      // Outer red glow envelope
      g.shadowColor = '#ff2d74';
      g.shadowBlur = 20;
      g.fillStyle = 'rgba(255, 45, 116, 0.7)';
      g.fillRect(0, -beamH / 2, beamW, beamH);
      
      // Inner hot plasma white core
      g.fillStyle = '#ffffff';
      g.shadowColor = '#ffffff';
      g.shadowBlur = 10;
      g.fillRect(0, -beamH * 0.35 / 2, beamW, beamH * 0.35);
      
      // Draw electric arcs along the beam
      g.strokeStyle = '#ffb8e2';
      g.lineWidth = 2;
      g.beginPath();
      let cx = 0;
      g.moveTo(0, 0);
      while (cx < beamW) {
        cx += 15 + Math.random() * 20;
        const cy = (Math.random() - 0.5) * beamH * 0.35;
        g.lineTo(cx, cy);
      }
      g.stroke();
      
      g.restore();
    }

    // Phase 4 rotating geometric star warning shields
    if (this.currentPhase === 4 && !this.dead) {
      g.save();
      g.translate(this.x * scale, this.y * scale);
      const rot = (performance.now() / 250) % (Math.PI * 2);
      g.rotate(rot);
      g.strokeStyle = 'rgba(255, 45, 116, 0.65)';
      g.lineWidth = 2;
      g.shadowColor = '#ff2d74';
      g.shadowBlur = 12;
      
      g.beginPath();
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        const rRad = this.bodyRadius * scale * 1.45;
        const px = Math.cos(a) * rRad;
        const py = Math.sin(a) * rRad;
        if (i === 0) g.moveTo(px, py);
        else g.lineTo(px, py);
      }
      g.closePath();
      g.stroke();
      g.restore();
    }
  }
}
