import { installBrowserShims } from './test-env.mjs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

installBrowserShims();

const { GameDatabase } = await import('../src/core/GameDatabase.js?v=20260725-4');
await GameDatabase.loadAll();
const { GameState } = await import('../src/core/GameState.js?v=20260725-4');
const { BattleContext } = await import('../src/core/BattleContext.js?v=20260725-4');
const { RobotController } = await import('../src/robot/RobotController.js?v=20260725-4');
const { RobotStats } = await import('../src/robot/RobotStats.js?v=20260725-4');
const { LogicBrain } = await import('../src/logic/LogicBrain.js?v=20260725-4');
const { ActionExecutor } = await import('../src/logic/ActionExecutor.js?v=20260725-4');
const { CrawlerEnemy } = await import('../src/enemies/CrawlerEnemy.js?v=20260725-4');
const { ShooterEnemy } = await import('../src/enemies/ShooterEnemy.js?v=20260725-4');
const { ChargerEnemy } = await import('../src/enemies/ChargerEnemy.js?v=20260725-4');
const { EmpDroneEnemy } = await import('../src/enemies/EmpDroneEnemy.js?v=20260725-4');
const { RepairDroneEnemy } = await import('../src/enemies/RepairDroneEnemy.js?v=20260725-4');
const { ShieldRelayEnemy } = await import('../src/enemies/ShieldRelayEnemy.js?v=20260725-4');
const { BossProtocolWarden } = await import('../src/enemies/BossProtocolWarden.js?v=20260725-4');
const { HazardTile } = await import('../src/vfx/HazardTile.js?v=20260725-4');
const { runModifiers, weeklyProtocol } = await import('../src/systems/RunModifiers.js?v=20260725-4');

const ENEMY_CLASSES = {
  crawler: CrawlerEnemy,
  shooter: ShooterEnemy,
  charger: ChargerEnemy,
  emp_drone: EmpDroneEnemy,
  repair_drone: RepairDroneEnemy,
  shield_drone: ShieldRelayEnemy,
  boss_warden: BossProtocolWarden,
  apex_warden: BossProtocolWarden,
};

function addHazards(ctx, battle) {
  for (const hazard of battle.hazards || []) {
    ctx.hazards.push(new HazardTile(hazard.x, hazard.y, hazard.radius));
  }
}

function spawnWave(ctx, spawns, random = Math.random) {
  const modifiers = runModifiers(GameState.runConfig || {});
  for (const spawn of spawns) {
    const data = GameDatabase.getEnemy(spawn.enemyId);
    if (!data) throw new Error(`Missing enemy ${spawn.enemyId}`);
    const EnemyClass = ENEMY_CLASSES[spawn.enemyId] || CrawlerEnemy;
    for (let i = 0; i < spawn.count; i += 1) {
      const enemy = new EnemyClass();
      enemy.init(data, ctx);
      enemy.maxHp *= modifiers.enemyHp;
      enemy.hp = enemy.maxHp;
      enemy.damage *= modifiers.enemyDamage;
      enemy.moveSpeed *= modifiers.enemySpeed;
      const angle = (i / Math.max(1, spawn.count)) * Math.PI * 2 + random() * 0.4;
      const radius = 8 + random();
      const pos = ctx.clampToArena({ x: Math.cos(angle) * radius, y: Math.sin(angle) * radius });
      enemy.x = pos.x;
      enemy.y = pos.y;
      if (spawn.enemyId === 'boss_warden' || spawn.enemyId === 'apex_warden') ctx.boss = enemy;
      ctx.enemies.push(enemy);
    }
  }
}

export function simulateBattle(battle, options = {}) {
  const maxTime = options.maxTime ?? 90;
  // Match the live arena's fixed simulation step so balance gates exercise
  // the same deterministic timing model as real players.
  const dt = options.dt ?? 1 / 60;
  const ctx = new BattleContext();
  ctx.hud = { logConsole() {} };
  const stats = new RobotStats();
  stats.loadFromGameState();
  const modifiers = runModifiers(GameState.runConfig || {});
  if (modifiers.robotEnergyRegen !== 1) {
    stats.base.energy_regen = Math.max(0, stats.stat('energy_regen', 8) * modifiers.robotEnergyRegen);
  }
  const robot = new RobotController();
  robot.initFromStats(stats, ctx);
  robot.moveSpeed *= modifiers.robotMoveSpeed;
  ctx.robot = robot;
  const executor = new ActionExecutor();
  executor.setup(robot, ctx, stats, ctx.tracker);
  const brain = new LogicBrain();
  brain.setup(robot, ctx, executor, ctx.tracker);
  ctx.tracker.setRuleSnapshot(GameState.rules);
  addHazards(ctx, battle);

  const waves = new Map();
  for (const spawn of battle.enemySpawns || []) {
    const key = spawn.wave || 1;
    if (!waves.has(key)) waves.set(key, []);
    waves.get(key).push(spawn);
  }
  const pending = [...waves.keys()]
    .sort((a, b) => a - b)
    .map((wave) => ({ spawns: waves.get(wave) }));
  const random = GameState.randomFor(`arena:${battle.id}:${GameState.currentMapColumn}`);
  ctx.random = random;

  let time = 0;
  let won = false;
  let waveClearTime = 0;
  let deployed = false;
  let currentWave = 0;
  while (time < maxTime && !robot.dead) {
    if (!deployed && pending.length > 0) {
      spawnWave(ctx, pending.shift().spawns, random);
      currentWave += 1;
      ctx.tracker.recordWave(currentWave, waves.size);
      deployed = true;
    }
    ctx.time = time;
    if (ctx.tickCastingEdge()) ctx.tracker.recordCastingSeen();
    robot.tick(dt);
    brain.tick(dt);
    executor.tick(dt);
    for (const enemy of [...ctx.enemies]) enemy.tick(dt);
    for (const projectile of [...ctx.projectiles]) projectile.tick(dt);
    for (const mine of [...ctx.mines]) mine.tick(dt);
    for (const hazard of ctx.hazards) hazard.tick(dt, ctx);
    for (const particle of ctx.particles) particle.tick(dt, ctx);
    ctx.particles = ctx.particles.filter((particle) => !particle.dead);
    ctx.enemies = ctx.enemies.filter((enemy) => !enemy.dead);
    ctx.tracker.tick(dt);
    const inCombat = ctx.liveEnemies() > 0;
    ctx.overlogic.tick(dt, inCombat);
    if (!inCombat && pending.length > 0) {
      waveClearTime += dt;
      if (waveClearTime >= 1.15) {
        spawnWave(ctx, pending.shift().spawns, random);
        currentWave += 1;
        ctx.tracker.recordWave(currentWave, waves.size);
        waveClearTime = 0;
      }
    } else {
      waveClearTime = 0;
    }
    if (pending.length === 0 && ctx.liveEnemies() === 0) {
      won = true;
      break;
    }
    time += dt;
  }

  const report = ctx.tracker.toReport();
  return {
    battleId: battle.id,
    battleName: battle.displayName,
    won,
    time: Number(time.toFixed(2)),
    hp: Number(Math.max(0, robot.hp).toFixed(1)),
    energy: Number(robot.energy.toFixed(1)),
    damageTaken: Math.round(Object.values(report.damage_by_source).reduce((sum, value) => sum + value, 0)),
    damageDealt: Math.round(report.total_damage_dealt || 0),
    enemyRepairs: Object.fromEntries(Object.entries(report.enemy_repairs || {}).map(([id, value]) => [id, Math.round(value)])),
    enemyShieldCasts: report.enemy_shields || {},
    enemyShieldMitigation: Object.fromEntries(Object.entries(report.enemy_shield_mitigation || {}).map(([id, value]) => [id, Math.round(value)])),
    actions: report.action_usage,
    timelineEvents: report.timeline.length,
    wavesRecorded: report.timeline.filter((event) => event.kind === 'wave').length,
  };
}

function runSuite() {
  prepareRun({ seed: 20260701 });
  const earlyBattles = [0, 1, 2].map((index) => GameDatabase.getBattle(index));
  const earlyGate = earlyBattles.map((battle) => simulateBattle(battle));

  // Mid-game gates represent a reachable build after the first few reward
  // choices, rather than an unupgraded robot entering the Crucible.
  prepareRun({ seed: 20260725, fullRules: true, midGameBuild: true });
  const rosterDiagnostics = Array.from({ length: GameDatabase.getBattleCount() }, (_, index) =>
    simulateBattle(GameDatabase.getBattle(index), { maxTime: 120 })
  );
  const midGameGate = rosterDiagnostics.slice(3, 8);

  prepareRun({ seed: 20260726, fullRules: true, lateGameBuild: true });
  const bossGate = [8, 9].map((index) =>
    simulateBattle(GameDatabase.getBattle(index), { maxTime: 120 })
  );
  const ascensionGate = [10, 11, 12].map((index) =>
    simulateBattle(GameDatabase.getBattle(index), { maxTime: 150 })
  );

  const difficultyGate = ['casual', 'standard', 'veteran'].map((difficulty) => {
    prepareRun({ seed: 20260727, difficulty, fullRules: true, lateGameBuild: true });
    return { difficulty, ...simulateBattle(GameDatabase.getBattle(7), { maxTime: 120 }) };
  });

  const weeklyGate = [202631, 202632, 202633].map((seed) => {
    prepareRun({ seed, mode: 'weekly', fullRules: true, lateGameBuild: true });
    return {
      seed,
      protocol: weeklyProtocol(seed)?.id || null,
      ...simulateBattle(GameDatabase.getBattle(7), { maxTime: 120 }),
    };
  });

  return { earlyGate, midGameGate, bossGate, ascensionGate, difficultyGate, weeklyGate, rosterDiagnostics };
}

function prepareRun({ seed, mode = 'standard', difficulty = 'standard', fullRules = false, midGameBuild = false, lateGameBuild = false }) {
  GameState.clearStorage();
  GameState.normalizeAfterDatabaseLoad();
  GameState.runConfig = { mode, difficulty, seed };
  if (fullRules) GameState._advanceTeachRulesTo(4);
  if (midGameBuild) {
    Object.assign(GameState.stats, {
      basic_dmg: 10,
    });
    GameState.runStats.rewardsChosen = ['pu_basic_dmg'];
  }
  if (lateGameBuild) {
    // Six legal campaign selections: damage ×3, armor penetration ×2 and
    // Emergency Recall. This is a demanding but reachable Apex route build,
    // not a synthetic max-stat robot.
    Object.assign(GameState.stats, {
      basic_dmg: 15.625,
      armor_piercing: 6,
      emergency_recall: 1,
    });
    GameState.runStats.rewardsChosen = [
      'pu_basic_dmg', 'pu_armor_piercing', 'pu_armor_piercing',
      'pu_basic_dmg', 'pu_emergency_recall', 'pu_basic_dmg',
    ];
  }
}

function gateFailures(results) {
  const checks = [
    ...results.earlyGate.map((result) => ({ gate: 'early', maxTime: 60, result })),
    ...results.midGameGate.map((result) => ({ gate: 'mid', maxTime: 90, result })),
    ...results.bossGate.map((result) => ({ gate: 'boss', maxTime: 60, result })),
    ...results.ascensionGate.map((result) => ({ gate: 'ascension', maxTime: 150, result })),
    ...results.difficultyGate.map((result) => ({ gate: `difficulty:${result.difficulty}`, maxTime: 90, result })),
    ...results.weeklyGate.map((result) => ({ gate: `weekly:${result.protocol}`, maxTime: 120, result })),
  ];
  return checks.filter(({ result, maxTime }) => (
    !result.won || result.time > maxTime || result.hp <= 0 ||
    !Number.isFinite(result.damageDealt) || result.damageDealt <= 0
  ));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const results = runSuite();
  const failed = gateFailures(results);
  if (failed.length > 0) {
    console.error(JSON.stringify(results, null, 2));
    console.error('Failed balance gates:', JSON.stringify(failed, null, 2));
    throw new Error('Balance simulation failed: a required campaign, boss, or difficulty gate is no longer viable.');
  }
  console.log(JSON.stringify(results, null, 2));
}
