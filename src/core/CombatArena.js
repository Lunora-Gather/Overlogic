// CombatArena.js — combat driver. Spawns waves, runs tick loop, renders, judges win/loss.
// Mirrors scripts/core/CombatArena.gd. Owns the rAF loop.

import { BattleContext } from './BattleContext.js?v=20260725-4';
import { RobotController } from '../robot/RobotController.js?v=20260725-4';
import { RobotStats } from '../robot/RobotStats.js?v=20260725-4';
import { LogicBrain } from '../logic/LogicBrain.js?v=20260725-4';
import { ActionExecutor } from '../logic/ActionExecutor.js?v=20260725-4';
import { Camera } from '../render/Camera.js?v=20260725-4';
import { drawArena } from '../render/ArenaRenderer.js?v=20260725-4';
import { GameDatabase } from './GameDatabase.js?v=20260725-4';
import { GameState } from './GameState.js?v=20260725-4';
import { AudioManager } from '../systems/AudioManager.js?v=20260725-4';
import { CrawlerEnemy } from '../enemies/CrawlerEnemy.js?v=20260725-4';
import { ShooterEnemy } from '../enemies/ShooterEnemy.js?v=20260725-4';
import { ChargerEnemy } from '../enemies/ChargerEnemy.js?v=20260725-4';
import { BossProtocolWarden } from '../enemies/BossProtocolWarden.js?v=20260725-4';
import { EmpDroneEnemy } from '../enemies/EmpDroneEnemy.js?v=20260725-4';
import { RepairDroneEnemy } from '../enemies/RepairDroneEnemy.js?v=20260725-4';
import { ShieldRelayEnemy } from '../enemies/ShieldRelayEnemy.js?v=20260725-4';
import { spawnBurst } from '../vfx/ParticleSystem.js?v=20260725-4';
import { HazardTile } from '../vfx/HazardTile.js?v=20260725-4';
import { recordBattle } from '../systems/RunHistory.js?v=20260725-4';
import { runModifiers } from '../systems/RunModifiers.js?v=20260725-4';
import { entity, t } from '../i18n/I18n.js?v=20260725-4';
import { recordFrame } from '../systems/RuntimeDiagnostics.js?v=20260725-4';

const WAVE_CLEAR_DELAY = 1.15;
const ENEMY_CLASSES = {
  crawler: CrawlerEnemy,
  shooter: ShooterEnemy,
  charger: ChargerEnemy,
  emp_drone: EmpDroneEnemy,
  repair_drone: RepairDroneEnemy,
  shield_drone: ShieldRelayEnemy,
  boss_warden: BossProtocolWarden,
  apex_warden: BossProtocolWarden,   // reuse boss class; stats differ via data JSON
};

export function isBossEnemyId(enemyId) {
  return enemyId === 'boss_warden' || enemyId === 'apex_warden';
}

export class CombatArena {
  constructor(canvas, hud) {
    this.canvas = canvas;
    this.g = canvas.getContext('2d');
    this.hud = hud;            // BattleHUD instance
    this.ctx = null;
    this.robot = null;
    this.stats = null;
    this.brain = null;
    this.executor = null;
    this.camera = new Camera();
    this.battle = null;
    this.pendingWaves = [];    // [{enemyId, count, at}]
    this.currentWave = 0;
    this.totalWaves = 0;
    this.paused = false;
    this.speed = 1;
    this.lastTs = 0;
    this.battleTime = 0;
    this._rafId = 0;
    this._finished = false;
    this._noEnemyTime = 0;     // for overlogic OOC decay
    this.onFinished = null;    // callback(won)
    this._phaseToastTimer = 0;
    this._waveClearTimer = 0;
    this.random = Math.random;
  }

  start(battle) {
    // High DPI / Retina Support
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = 720 * dpr;
    this.canvas.height = 720 * dpr;
    this.dpr = dpr;

    this.battle = battle;
    this._finished = false;
    this.battleTime = 0;
    this._noEnemyTime = 0;
    this.paused = false;
    this.speed = 1;
    this.currentWave = 0;
    this._waveClearTimer = 0;
    this.random = GameState.randomFor(`arena:${battle.id}:${GameState.currentMapColumn}`);

    // Fresh context + robot + brain
    this.ctx = new BattleContext();
    this.ctx.hud = this.hud;
    this.ctx.random = this.random;
    this.stats = new RobotStats();
    this.stats.loadFromGameState();
    const modifiers = runModifiers(GameState.runConfig || {});
    if (modifiers.robotEnergyRegen !== 1) {
      this.stats.base.energy_regen = Math.max(0, this.stats.stat('energy_regen', 8) * modifiers.robotEnergyRegen);
    }
    this.robot = new RobotController();
    this.robot.initFromStats(this.stats, this.ctx);
    this.robot.moveSpeed *= modifiers.robotMoveSpeed;
    this.ctx.robot = this.robot;
    AudioManager.play('battle_start');
    this.hud.onBattleStart(battle);
    if (modifiers.protocol) {
      this.hud.logConsole(t(GameState.runConfig?.mode === 'weekly' ? 'log.weeklyProtocol' : 'log.dailyProtocol', {
        name: t(modifiers.protocol.titleKey),
        description: t(modifiers.protocol.descriptionKey),
      }), 'info');
    }

    // Spawn environmental hazards depending on battle
    this.ctx.hazards = [];
    if (battle.hazardPattern === 'cross') {
      this.ctx.hazards.push(new HazardTile(-5, -5, 2.2));
      this.ctx.hazards.push(new HazardTile(5, 5, 2.2));
      this.ctx.hazards.push(new HazardTile(-5, 5, 2.2));
      this.ctx.hazards.push(new HazardTile(5, -5, 2.2));
      this.hud.logConsole(t('log.criticalHazards', { count: 4 }), 'danger');
    } else if (battle.id === 'battle_4' || battle.id === 'battle_6') {
      // Swarm / Iron Tide — plasma hazards
      this.ctx.hazards.push(new HazardTile(-4, -4, 2.0));
      this.ctx.hazards.push(new HazardTile(4, 4, 2.0));
      this.hud.logConsole(t('log.hazards', { count: 2 }), 'warn');
    } else if (battle.id === 'battle_5' || battle.id === 'battle_7') {
      // Shadow Grid / Mixed Protocol — 3 hazards
      this.ctx.hazards.push(new HazardTile(-5, 3, 2.2));
      this.ctx.hazards.push(new HazardTile(5, -3, 2.2));
      this.ctx.hazards.push(new HazardTile(0, 0, 1.8));
      this.hud.logConsole(t('log.hazards', { count: 3 }), 'warn');
    } else if (battle.id === 'battle_8') {
      // Crucible — heavy hazards
      this.ctx.hazards.push(new HazardTile(-6, -6, 2.5));
      this.ctx.hazards.push(new HazardTile(6, 6, 2.5));
      this.ctx.hazards.push(new HazardTile(-6, 6, 2.5));
      this.ctx.hazards.push(new HazardTile(6, -6, 2.5));
      this.hud.logConsole(t('log.criticalHazards', { count: 4 }), 'danger');
    } else if (battle.id === 'battle_9' || battle.id === 'battle_10') {
      // Warden / Apex Warden boss arenas
      this.ctx.hazards.push(new HazardTile(-6, -6, 2.5));
      this.ctx.hazards.push(new HazardTile(6, 6, 2.5));
      this.ctx.hazards.push(new HazardTile(-6, 6, 2.5));
      this.ctx.hazards.push(new HazardTile(6, -6, 2.5));
      this.hud.logConsole(t('log.criticalHazards', { count: 4 }), 'danger');
    }

    this.executor = new ActionExecutor();
    this.executor.setup(this.robot, this.ctx, this.stats, this.ctx.tracker);
    // expose executor to ctx for condition evaluation (overdrive_ready)
    this.ctx.executor = this.executor;
    this.brain = new LogicBrain();
    this.brain.setup(this.robot, this.ctx, this.executor, this.ctx.tracker);
    this.ctx.tracker.setRuleSnapshot(GameState.rules);
    this.brain.onLabel = (label, rule, diagnostics, diagnosticReasons) => {
      this.hud.setCurrentLogic(label, rule, this.ctx.overlogic.active);
      if (diagnostics) {
        this.hud.updateDiagnostics(diagnostics, diagnosticReasons);
      }
    };

    // Wire robot HUD callbacks
    this.robot.onHp = (hp, mx) => this.hud.setHp(hp, mx);
    this.robot.onEnergy = (en, mx) => this.hud.setEnergy(en, mx);
    this.robot.onShield = (on) => this.hud.setShield(on);
    this.robot.onOverdrive = (on) => this.hud.setOverdrive(on);
    this.robot.onDied = () => this._finish(false);
    this.robot.onDamage = (amount, source) => {
      const sourceName = entity('enemy', source, source);
      this.hud.logConsole(t('log.damage', { amount: amount.toFixed(0), source: sourceName }), 'warn');
      this.camera.shake(0.25, amount * 1.2);
    };
    this.ctx.onEnemyDied = (enemyId, displayName) => {
      this.hud.logConsole(t('log.terminated', { name: entity('enemy', enemyId, displayName) }), 'success');
    };

    // Build wave spawn schedule
    const waves = {};
    for (const s of battle.enemySpawns) {
      if (!waves[s.wave]) waves[s.wave] = [];
      waves[s.wave].push(s);
    }
    this.totalWaves = Object.keys(waves).length;
    this.pendingWaves = [];
    let waveNum = 0;
    for (const w of Object.keys(waves).sort((a, b) => +a - +b)) {
      waveNum += 1;
      this.pendingWaves.push({ wave: +w, spawns: waves[w] });
    }

    // Boss wiring
    this.lastTs = performance.now();
    this._loop(this.lastTs);
  }

  _loop(ts) {
    if (this._finished) return;
    this._rafId = requestAnimationFrame((t) => this._loop(t));
    const rawDt = Math.max(0, (ts - this.lastTs) / 1000);
    recordFrame(rawDt * 1000);
    const realDt = Math.min(0.05, rawDt); // cap to avoid huge jumps
    this.lastTs = ts;
    if (this.paused) { this._render(); return; }
    const dt = realDt * this.speed;
    this._update(dt);
    this._render();
  }

  _update(dt) {
    this.battleTime += dt;
    this.ctx.time = this.battleTime;
    this.ctx.timeSpeed = this.speed;

    // Deploy the first wave immediately. Later waves arrive only after the
    // current wave is cleared, giving rule changes readable tactical pacing.
    if (this.currentWave === 0 && this.pendingWaves.length > 0) this._deployNextWave();

    // Edge-detect casting-seen for stats
    if (this.ctx.tickCastingEdge()) this.ctx.tracker.recordCastingSeen();

    // Robot tick
    this.robot.tick(dt);
    // Logic brain tick (may fire actions)
    this.brain.tick(dt);
    // Executor cooldowns
    this.executor.tick(dt);
    // Enemies
    for (const e of this.ctx.enemies) e.tick(dt);
    // Projectiles
    for (const p of [...this.ctx.projectiles]) p.tick(dt);
    // Mines
    for (const m of [...this.ctx.mines]) m.tick(dt);
    // Hazards
    for (const h of this.ctx.hazards) h.tick(dt, this.ctx);
    // Particles
    for (const p of this.ctx.particles) p.tick(dt, this.ctx);
    this.ctx.particles = this.ctx.particles.filter(p => !p.dead);
    // Clean dead enemies (removed immediately on death; brief death burst is spawned in takeDamage)
    this.ctx.enemies = this.ctx.enemies.filter(e => !e.dead);
    if (this.ctx.liveEnemies() === 0 && this.pendingWaves.length > 0) {
      this._waveClearTimer += dt;
      this.hud.setWaveIncoming(
        this.currentWave + 1,
        this.totalWaves,
        Math.max(0, WAVE_CLEAR_DELAY - this._waveClearTimer),
      );
      if (this._waveClearTimer >= WAVE_CLEAR_DELAY) this._deployNextWave();
    } else {
      this._waveClearTimer = 0;
    }

    // Tracker time + overlogic
    this.ctx.tracker.tick(dt);
    const inCombat = this.ctx.liveEnemies() > 0;
    if (!inCombat) this._noEnemyTime += dt; else this._noEnemyTime = 0;
    this.ctx.overlogic.tick(dt, inCombat);
    this.hud.setOverlogic(this.ctx.overlogic.value, this.ctx.overlogic.active);

    // Camera
    this.camera.follow(this.robot, dt);
    this.camera.tick(dt);
    if (this._phaseToastTimer > 0) {
      this._phaseToastTimer -= dt;
      if (this._phaseToastTimer <= 0) this.hud.hidePhaseToast();
    }

    // Boss bar
    if (this.ctx.boss) {
      this.hud.setBossHp(this.ctx.boss.hp, this.ctx.boss.maxHp);
    }

    // Win check: all waves spawned AND no live enemies
    if (this.pendingWaves.length === 0 && this.ctx.liveEnemies() === 0 && !this.robot.dead) {
      this._finish(true);
    }
  }

  _deployNextWave() {
    const next = this.pendingWaves.shift();
    if (!next) return;
    this._waveClearTimer = 0;
    this._spawnWave(next.spawns);
    this.currentWave += 1;
    this.ctx.tracker.recordWave(this.currentWave, this.totalWaves);
    this.hud.setWave(this.currentWave, this.totalWaves);
    this.hud.logConsole(t('log.wave', { current: this.currentWave, total: this.totalWaves }), 'info');
  }

  _spawnWave(spawns) {
    const modifiers = runModifiers(GameState.runConfig || {});
    for (const s of spawns) {
      const data = GameDatabase.getEnemy(s.enemyId);
      if (!data) continue;
      for (let i = 0; i < s.count; i++) {
        const Cls = ENEMY_CLASSES[s.enemyId] || CrawlerEnemy;
        const e = new Cls();
        e.init(data, this.ctx);
        e.maxHp *= modifiers.enemyHp;
        e.hp = e.maxHp;
        e.damage *= modifiers.enemyDamage;
        e.moveSpeed *= modifiers.enemySpeed;
        // spawn at arena edge, distributed around ring
        const ang = (i / Math.max(1, s.count)) * Math.PI * 2 + this.random() * 0.4;
        const r = 8 + this.random() * 1;
        const pos = this.ctx.clampToArena({ x: Math.cos(ang) * r, y: Math.sin(ang) * r });
        e.x = pos.x; e.y = pos.y;
        this.ctx.enemies.push(e);
        if (isBossEnemyId(s.enemyId)) {
          this.ctx.boss = e;
          const localizedBossName = entity('enemy', s.enemyId, data.displayName);
          this.hud.logConsole(t('log.bossDetected', { name: localizedBossName }), 'danger');
          e.onPhaseChanged = (p) => {
            this.camera.shake(0.35, 10);
            this.hud.showPhaseToast(t('log.phase', { name: localizedBossName, phase: p }));
            this._phaseToastTimer = 1.6;
            this.hud.logConsole(t('log.bossPhase', { name: localizedBossName, phase: p }), 'danger');
          };
          e.onLaserFire = () => {
            this.camera.shake(0.4, 15);
            AudioManager.play('boss_phase');
          };
          this.hud.showBossBar(localizedBossName);
        }
      }
    }
  }

  _render() {
    drawArena(this.g, this.canvas, this.ctx, this.camera);
    this.hud.setTimer(this.battleTime);
  }

  _finish(won) {
    if (this._finished) return;
    this._finished = true;
    cancelAnimationFrame(this._rafId);
    const endHp = this.robot.hp; // capture HP for persistence
    const report = this.ctx.tracker.toReport();
    report._runSeed = GameState.runConfig?.seed ?? null;
    report._runMode = GameState.runConfig?.mode || 'standard';
    report._difficulty = GameState.runConfig?.difficulty || 'standard';
    report._battleId = this.battle?.id || null;
    report._won = won === true;
    report._sandbox = String(this.battle?.id || '').startsWith('sandbox_');
    if (!won) {
      this.ctx.tracker.snapshotDeath(
        this.robot.hp, this.robot.energy,
        this.ctx.countEnemiesWithin({ x: this.robot.x, y: this.robot.y }, 4)
      );
      AudioManager.play('defeat');
      // snapshotDeath mutates the tracker, so rebuild after the final event.
      Object.assign(report, this.ctx.tracker.toReport());
      GameState.lastReport = report;
      this.hud.logConsole(t('log.failed'), 'danger');
    } else {
      AudioManager.play('victory');
      GameState.lastReport = report;
      // Pass endHp so the next battle starts with this HP
      GameState.lastReport._endHp = endHp;
      this.hud.logConsole(t('log.success'), 'success');
    }
    GameState.saveToStorage();
    // Sandbox is for debugging builds, not a progression faucet. Keep its
    // report available for the current screen, but never award profile XP,
    // achievements, or formal history entries for it.
    if (!report._sandbox) {
      const progression = recordBattle(GameState.lastReport);
      if (progression?.challenges?.unlocked?.length && typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('overlogic:challenge-complete', {
          detail: { count: progression.challenges.unlocked.length },
        }));
      }
    }
    this.hud.hideBossBar();
    if (this.onFinished) this.onFinished(won);
  }

  setPaused(p) { this.paused = p; }
  togglePause() { this.paused = !this.paused; }
  stepFrame() {
    if (!this.paused || this._finished) return;
    this._update(0.15);
    this._render();
  }
  setSpeed(s) { this.speed = s; }
  toggleSpeed() {
    if (this.speed === 0.5) this.speed = 1;
    else if (this.speed === 1) this.speed = 2;
    else if (this.speed === 2) this.speed = 4;
    else this.speed = 0.5;
    return this.speed;
  }

  stop() {
    this._finished = true;
    cancelAnimationFrame(this._rafId);
  }
}
