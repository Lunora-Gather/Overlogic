import { installBrowserShims, withSeededRandom } from './test-env.mjs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

installBrowserShims();

const { GameDatabase } = await import('../src/core/GameDatabase.js');
await GameDatabase.loadAll();
const { GameState } = await import('../src/core/GameState.js');
const { BattleContext } = await import('../src/core/BattleContext.js');
const { RobotController } = await import('../src/robot/RobotController.js');
const { RobotStats } = await import('../src/robot/RobotStats.js');
const { LogicBrain } = await import('../src/logic/LogicBrain.js');
const { ActionExecutor } = await import('../src/logic/ActionExecutor.js');
const { CrawlerEnemy } = await import('../src/enemies/CrawlerEnemy.js');
const { ShooterEnemy } = await import('../src/enemies/ShooterEnemy.js');
const { ChargerEnemy } = await import('../src/enemies/ChargerEnemy.js');
const { EmpDroneEnemy } = await import('../src/enemies/EmpDroneEnemy.js');
const { BossProtocolWarden } = await import('../src/enemies/BossProtocolWarden.js');
const { HazardTile } = await import('../src/vfx/HazardTile.js');
const { difficultyModifiers } = await import('../src/systems/RunModifiers.js');

const ENEMY_CLASSES = {
  crawler: CrawlerEnemy,
  shooter: ShooterEnemy,
  charger: ChargerEnemy,
  emp_drone: EmpDroneEnemy,
  boss_warden: BossProtocolWarden,
  apex_warden: BossProtocolWarden,
};

function addHazards(ctx, battle) {
  const ids2 = new Set(['battle_4', 'battle_6']);
  const ids3 = new Set(['battle_5', 'battle_7']);
  const ids4 = new Set(['battle_8', 'battle_9', 'battle_10']);
  if (ids2.has(battle.id)) {
    ctx.hazards.push(new HazardTile(-4, -4, 2.0), new HazardTile(4, 4, 2.0));
  } else if (ids3.has(battle.id)) {
    ctx.hazards.push(new HazardTile(-5, 3, 2.2), new HazardTile(5, -3, 2.2), new HazardTile(0, 0, 1.8));
  } else if (ids4.has(battle.id)) {
    ctx.hazards.push(
      new HazardTile(-6, -6, 2.5),
      new HazardTile(6, 6, 2.5),
      new HazardTile(-6, 6, 2.5),
      new HazardTile(6, -6, 2.5),
    );
  }
}

function spawnWave(ctx, spawns, random = Math.random) {
  const modifiers = difficultyModifiers(GameState.runConfig?.difficulty);
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
  const dt = options.dt ?? 1 / 30;
  const ctx = new BattleContext();
  ctx.hud = { logConsole() {} };
  const stats = new RobotStats();
  stats.loadFromGameState();
  const robot = new RobotController();
  robot.initFromStats(stats, ctx);
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

  let time = 0;
  let won = false;
  let waveClearTime = 0;
  let deployed = false;
  while (time < maxTime && !robot.dead) {
    if (!deployed && pending.length > 0) {
      spawnWave(ctx, pending.shift().spawns, random);
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
    actions: report.action_usage,
  };
}

function runSuite() {
  GameState.clearStorage();
  GameState.normalizeAfterDatabaseLoad();
  const earlyBattles = [0, 1, 2].map((index) => GameDatabase.getBattle(index));
  const earlyGate = withSeededRandom(20260701, () =>
    earlyBattles.map((battle) => simulateBattle(battle))
  );

  GameState.clearStorage();
  GameState.normalizeAfterDatabaseLoad();
  GameState._advanceTeachRulesTo(4);
  const rosterDiagnostics = withSeededRandom(20260725, () =>
    Array.from({ length: GameDatabase.getBattleCount() }, (_, index) =>
      simulateBattle(GameDatabase.getBattle(index), { maxTime: 120 })
    )
  );
  return { earlyGate, rosterDiagnostics };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const results = runSuite();
  const failed = results.earlyGate.filter((result) => !result.won);
  if (failed.length > 0) {
    console.error(JSON.stringify(results, null, 2));
    throw new Error('Baseline simulation failed: early battles should be winnable with default rules.');
  }
  console.log(JSON.stringify(results, null, 2));
}
