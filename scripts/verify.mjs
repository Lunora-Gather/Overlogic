import assert from 'node:assert/strict';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { installBrowserShims, withSeededRandom } from './test-env.mjs';
import { simulateBattle } from './simulate-balance.mjs';

installBrowserShims();

const { GameDatabase } = await import('../src/core/GameDatabase.js?v=20260725-4');
await GameDatabase.loadAll();
const { GameState } = await import('../src/core/GameState.js?v=20260725-4');
const { buildReport } = await import('../src/systems/PostBattleReportBuilder.js?v=20260725-4');
const { buildRewardOptions, buildUpgradeOptions, rewardDescription } = await import('../src/systems/RewardManager.js?v=20260725-4');
const { GameManager } = await import('../src/core/GameManager.js?v=20260725-4');
const { CombatArena, isBossEnemyId } = await import('../src/core/CombatArena.js?v=20260725-4');
const { BattleContext } = await import('../src/core/BattleContext.js?v=20260725-4');
const { CombatStatsTracker } = await import('../src/systems/CombatStatsTracker.js?v=20260725-4');
const { RobotController } = await import('../src/robot/RobotController.js?v=20260725-4');
const { RobotStats } = await import('../src/robot/RobotStats.js?v=20260725-4');
const { ActionExecutor } = await import('../src/logic/ActionExecutor.js?v=20260725-4');
const { ConditionEvaluator } = await import('../src/logic/ConditionEvaluator.js?v=20260725-4');
const { OverlogicSystem } = await import('../src/systems/OverlogicSystem.js?v=20260725-4');
const { ChargerEnemy } = await import('../src/enemies/ChargerEnemy.js?v=20260725-4');
const { CrawlerEnemy } = await import('../src/enemies/CrawlerEnemy.js?v=20260725-4');
const { escapeHtml } = await import('../src/ui/safeHtml.js?v=20260725-4');
const { entity, setLocale, t, translationDiagnostics } = await import('../src/i18n/I18n.js?v=20260725-4');
const { difficultyModifiers, dailyProtocol, runModifiers } = await import('../src/systems/RunModifiers.js?v=20260725-4');
const { activeSynergyIds, synergyState } = await import('../src/systems/ProtocolSynergies.js?v=20260725-4');
const { recordBattle, recentBattles, historySummary, clearHistory } = await import('../src/systems/RunHistory.js?v=20260725-4');
const { profileSnapshot, profileRank, resetProfile } = await import('../src/systems/ProfileProgression.js?v=20260725-4');
const { challengeSnapshot, recordChallengeBattle, clearChallenges } = await import('../src/systems/LiveChallenges.js?v=20260725-4');
const { clearRunArchive, recordCompletedRun, replaceRunArchive, runArchiveSnapshot, runRecords } = await import('../src/systems/RunArchive.js?v=20260725-4');
const {
  recordRuntimeError,
  recordRuntimeEvent,
  recordFrame,
  markBootComplete,
  runtimeDiagnosticsSnapshot,
  resetRuntimeDiagnostics,
} = await import('../src/systems/RuntimeDiagnostics.js?v=20260725-4');

function collectJsFiles(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === '.git') continue;
    const path = `${dir}/${entry.name}`;
    if (entry.isDirectory()) collectJsFiles(path, out);
    else if (entry.name.endsWith('.js') || entry.name.endsWith('.mjs')) out.push(path);
  }
  return out;
}

function verifySyntax() {
  for (const file of [...collectJsFiles('src'), ...collectJsFiles('scripts'), 'sw.js']) {
    execFileSync('node', ['--check', file], { stdio: 'pipe' });
  }
}

async function verifyImportGraph() {
  // Import every UI module without constructing it. This catches missing
  // runtime imports that syntax checks cannot see (for example, a report
  // renderer referencing a database singleton without importing it).
  for (const file of fs.readdirSync('src/ui').filter((name) => name.endsWith('.js'))) {
    await import(`../src/ui/${file}`);
  }
}

function verifyDataContracts() {
  assert.deepEqual(GameDatabase.validateContracts(), [], 'content tables must satisfy the runtime data contract');
  const errors = [];
  for (let i = 0; i < GameDatabase.getBattleCount(); i += 1) {
    const battle = GameDatabase.getBattle(i);
    for (const spawn of battle.enemySpawns || []) {
      if (!GameDatabase.getEnemy(spawn.enemyId)) errors.push(`${battle.id}: missing enemy ${spawn.enemyId}`);
    }
    for (const rewardId of battle.rewardPool || []) {
      if (!GameDatabase.getReward(rewardId)) errors.push(`${battle.id}: missing reward ${rewardId}`);
    }
  }
  for (const reward of GameDatabase.allRewards()) {
    if (reward.rewardType === 'new_action' && !GameDatabase.getAction(reward.targetId)) {
      errors.push(`${reward.id}: missing action ${reward.targetId}`);
    }
    if (reward.rewardType === 'new_condition' && !GameDatabase.getCondition(reward.targetId)) {
      errors.push(`${reward.id}: missing condition ${reward.targetId}`);
    }
  }
  assert.deepEqual(errors, []);
}

async function verifyGameplayContracts() {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: false, status: 503, async json() { return {}; } });
  await assert.rejects(GameDatabase._fetchJson('data/unavailable.json', { retries: 0 }), /HTTP 503/);
  globalThis.fetch = originalFetch;

  GameState.clearStorage();
  GameState.normalizeAfterDatabaseLoad();
  GameState.configureRun('daily', 'veteran');
  assert.equal(GameState.runConfig.mode, 'daily');
  assert.equal(GameState.runConfig.difficulty, 'veteran');
  const dailyA = GameState.randomFor('contract');
  const seqA = [dailyA(), dailyA(), dailyA()];
  const dailyB = GameState.randomFor('contract');
  assert.deepEqual(seqA, [dailyB(), dailyB(), dailyB()], 'daily seed random streams must be reproducible');
  assert.equal(difficultyModifiers('casual').enemyHp < 1, true);
  assert.equal(difficultyModifiers('veteran').enemyDamage > 1, true);
  const protocolA = dailyProtocol(GameState.dailySeed());
  const protocolB = dailyProtocol(GameState.dailySeed());
  assert(protocolA && protocolA.id === protocolB.id, 'daily protocol must be deterministic for the UTC seed');
  assert.equal(dailyProtocol(0), null, 'invalid daily seeds must not select a protocol');
  const standardModifiers = runModifiers({ mode: 'standard', difficulty: 'standard', seed: 20260816 });
  assert.equal(standardModifiers.protocol, null, 'standard runs must not inherit daily mutators');
  const dailyModifiers = runModifiers({ mode: 'daily', difficulty: 'standard', seed: 20260816 });
  assert(dailyModifiers.protocol && dailyModifiers.enemySpeed !== 1 || dailyModifiers.enemyDamage !== 1,
    'daily runs must apply a visible protocol modifier');
  GameState.configureRun('standard', 'standard');
  assert.equal(Number.isSafeInteger(GameState.runConfig.seed), true, 'standard runs must receive a shareable seed');
  GameState.configureRun('standard', 'veteran', 20260816);
  const runCode = GameState.exportRunCode();
  assert.match(runCode, /^OLR1-STANDARD-VETERAN-/);
  assert.deepEqual(GameState.parseRunCode(runCode), { mode: 'standard', difficulty: 'veteran', seed: 20260816 });
  assert.equal(GameState.parseRunCode('OLR1-STANDARD-VETERAN-NOT_A_SEED'), null);
  GameState.configureRun('standard', 'standard', 20260816);
  const standardA = GameState.randomFor('standard-contract');
  const standardSeq = [standardA(), standardA(), standardA()];
  const standardB = GameState.randomFor('standard-contract');
  assert.deepEqual(standardSeq, [standardB(), standardB(), standardB()], 'standard runs must be reproducible from their seed');

  localStorage.setItem('overlogic_settings', JSON.stringify({
    volume: 99, mute: 'false', screenShake: 0, reduceMotion: false,
    language: 'invalid', runMode: 'invalid', difficulty: 'invalid',
  }));
  GameState.loadSettings();
  assert.equal(GameState.settings.volume, 1, 'settings volume must be clamped');
  assert.equal(GameState.settings.mute, false, 'settings booleans must not trust truthy strings');
  assert.equal(GameState.settings.screenShake, true, 'invalid settings booleans must use safe defaults');
  assert.equal(GameState.settings.language, 'en');
  assert.equal(GameState.settings.runMode, 'standard');
  assert.equal(GameState.settings.difficulty, 'standard');

  assert(GameDatabase.getCondition('projectile_nearby'), 'projectile warning condition must exist');
  assert(GameDatabase.getAction('sidestep'), 'evasive sidestep action must exist');
  assert.equal(GameDatabase.getCondition('boss_phase').maxValue, 4, 'boss phase condition must expose the final phase');
  assert.equal(GameDatabase.getCondition('energy_low').minValue, 0.01, 'energy low should allow fine-grained thresholds');
  GameState.resetRun();
  GameState.advanceTeachNode();
  assert(GameState.availableConditionIds().includes('projectile_nearby'));
  assert(GameState.availableActionIds().includes('sidestep'));
  assert(GameState.rules.some(rule => rule.conditionId === 'projectile_nearby' && rule.actionId === 'sidestep'));
  assert.equal(GameState.hasRunProgress(), false);
  assert.equal(GameState.canConfigureRun(), true);
  GameState.advanceTeachNode();
  assert(GameState.availableConditionIds().includes('battle_time_above'));
  assert(GameState.availableConditionIds().includes('enemy_count_high'));
  GameState.advanceTeachNode();
  assert(GameState.availableConditionIds().includes('energy_low'));

  const tacticalCtx = new BattleContext();
  const tacticalStats = new RobotStats();
  tacticalStats.loadFromGameState();
  const tacticalRobot = new RobotController();
  tacticalRobot.initFromStats(tacticalStats, tacticalCtx);
  tacticalCtx.robot = tacticalRobot;
  tacticalCtx.hud = { logConsole() {} };
  const tacticalExecutor = new ActionExecutor();
  tacticalExecutor.setup(tacticalRobot, tacticalCtx, tacticalStats, tacticalCtx.tracker);
  assert.equal(tacticalExecutor.unavailableReason('repair'), 'not_needed');
  tacticalRobot.activateShield(2, 0.7);
  assert.equal(tacticalRobot.shieldActive, true);
  assert.equal(tacticalExecutor.unavailableReason('shield'), 'already_active');
  tacticalRobot.energy = 40;
  assert.equal(tacticalExecutor.unavailableReason('energy_transfer'), '');
  tacticalRobot.shieldTimer = 0;
  assert.equal(tacticalExecutor.unavailableReason('energy_transfer'), 'requires_shield');
  tacticalCtx.projectiles.push({
    x: 1, y: 0, dir: { x: -1, y: 0 }, fromPlayer: false, dead: false,
  });
  const evaluator = new ConditionEvaluator();
  tacticalRobot.energy = 20;
  assert.equal(evaluator.evaluateSingle(tacticalRobot, tacticalCtx, 'energy_low', 0.25), true);
  tacticalCtx.time = 12;
  assert.equal(evaluator.evaluateSingle(tacticalRobot, tacticalCtx, 'battle_time_above', 10), true);
  tacticalCtx.enemies = [{ dead: false }, { dead: false }, { dead: false }, { dead: false }];
  assert.equal(evaluator.evaluateSingle(tacticalRobot, tacticalCtx, 'enemy_count_high', 4), true);
  assert.equal(evaluator.evaluate(tacticalRobot, tacticalCtx, {
    conditionId: 'energy_low', conditionValue: 0.25, negateCondition1: true,
  }), false, 'rule-level NOT must invert the primary condition');
  tacticalCtx.enemies = [];
  assert.equal(evaluator.evaluateSingle(tacticalRobot, tacticalCtx, 'projectile_nearby', 2.4), true);
  tacticalCtx.projectiles[0].dir = { x: 1, y: 0 };
  assert.equal(evaluator.evaluateSingle(tacticalRobot, tacticalCtx, 'projectile_nearby', 2.4), false);
  tacticalCtx.projectiles[0].dir = { x: -1, y: 0 };
  tacticalRobot.energy = 100;
  assert.equal(tacticalExecutor.execute('sidestep'), true);
  assert(tacticalRobot.dashTimer > 0, 'sidestep should create a real evasive dash');

  const exportedRules = GameState.exportRulesCode();
  assert(exportedRules.startsWith('OL1-'), 'shared builds should have a recognizable version prefix');
  GameState.rules = [];
  assert.equal(GameState.importRulesCode(exportedRules), true, 'shared builds should round-trip');
  assert(GameState.rules.length >= 3, 'shared builds should preserve the active rule stack');

  const charger = new ChargerEnemy();
  charger.init(GameDatabase.getEnemy('charger'), tacticalCtx);
  charger.chargeState = 'casting';
  charger.attackTimer = 0;
  charger.interrupt();
  assert(charger.attackTimer > 0, 'interrupting a charger must create a real recast window');
  const crawler = new CrawlerEnemy();
  crawler.init(GameDatabase.getEnemy('crawler'), tacticalCtx);
  crawler.jumpState = 'telegraph';
  crawler.attackTimer = 0;
  crawler.interrupt();
  assert(crawler.attackTimer > 0, 'interrupting a crawler leap must create a real recast window');

  const overlogic = new OverlogicSystem();
  overlogic.addEvent('test', 85);
  assert.equal(overlogic.active, true, 'Overlogic should enter its burst state at the readable threshold');
  overlogic.tick(6, true);
  assert.equal(overlogic.active, false, 'Overlogic should recover after a bounded combat window');

  const firstRewards = new Set(buildRewardOptions(GameState.getActiveBattle()));
  assert(firstRewards.size > 0, 'first battle should expose rewards');
  assert([...firstRewards].every((id) => GameDatabase.getBattle(0).rewardPool.includes(id)), 'first rewards must come from battle 1 pool');
  assert([...firstRewards].some((id) => GameDatabase.getReward(id)?.rewardType === 'passive'), 'reward choices must include a passive');

  assert.equal(isBossEnemyId('boss_warden'), true);
  assert.equal(isBossEnemyId('apex_warden'), true);
  assert.equal(isBossEnemyId('charger'), false);
  assert.match(rewardDescription(GameDatabase.getReward('pu_max_energy')), /Energy capacity/);
  assert.match(rewardDescription(GameDatabase.getReward('pu_move_speed')), /movement speed/);
  assert.match(rewardDescription(GameDatabase.getReward('pu_shield_cd')), /Shield cooldown/);

  const mixedRewardBattle = {
    rewardPool: ['new_action_repair', 'new_action_drop_mine', 'new_condition_surrounded', 'pu_max_hp'],
  };
  withSeededRandom(20260725, () => {
    for (let index = 0; index < 25; index += 1) {
      const options = buildRewardOptions(mixedRewardBattle);
      assert(options.some(id => GameDatabase.getReward(id)?.rewardType === 'passive'), 'mixed reward draws must retain a passive');
    }
  });
  const moduleOnlyOptions = buildRewardOptions({
    id: 'module-only-contract',
    rewardPool: [
      'new_action_repair',
      'new_action_drop_mine',
      'new_condition_surrounded',
      'new_condition_enemy_hp_low',
    ],
  });
  assert(
    moduleOnlyOptions.some(id => GameDatabase.getReward(id)?.rewardType === 'passive'),
    'module-only pools must receive and retain a passive fallback',
  );

  GameState.runStats.rewardsChosen = ['pu_superconductors'];
  const exhaustedOptions = buildRewardOptions({
    id: 'non-stacking-contract',
    rewardPool: ['pu_superconductors', 'pu_max_hp', 'pu_basic_dmg'],
  });
  assert(!exhaustedOptions.includes('pu_superconductors'), 'one-shot passive rewards must not be offered twice');
  GameState.resetRun();

  const apexHud = {
    logConsole() {},
    showPhaseToast() {},
    showBossBar() {},
  };
  const apexArena = new CombatArena({ getContext: () => ({}) }, apexHud);
  apexArena.ctx = new BattleContext();
  apexArena._spawnWave([{ enemyId: 'apex_warden', count: 1 }]);
  assert.equal(apexArena.ctx.boss?.enemyId, 'apex_warden', 'Apex Warden must receive boss HUD and targeting wiring');

  const upgradeRewards = buildUpgradeOptions();
  assert.equal(upgradeRewards.length, 3, 'upgrade vault should offer three choices');
  assert(upgradeRewards.every((id) => GameDatabase.getReward(id)?.rewardType === 'passive'), 'upgrade vault should only offer passives');

  GameState.persistentHp = 12;
  GameState.lastReport = { total_damage_dealt: 72, battle_time: 4.3 };
  GameState.onBattleWon('pu_max_hp', 12);
  assert.equal(GameState.stats.max_hp, 120);
  assert.equal(GameState.persistentHp, 32);
  assert.equal(GameState.runStats.battlesWon, 1);
  assert.equal(GameState.runStats.totalDamageDealt, 72);
  assert.equal(GameState.runStats.totalBattleTime, 4.3);
  assert.deepEqual(GameState.runStats.rewardsChosen, ['pu_max_hp']);

  GameState.resetRun();
  const pendingBattle = GameState.getActiveBattle();
  GameState.lastReport = {
    _won: true,
    _battleId: pendingBattle.id,
    _endHp: 80,
    total_damage_dealt: 25,
    battle_time: 3.5,
  };
  assert.equal(GameState.hasPendingBattleResolution(), true, 'won reports must survive a refresh until reward resolution');
  assert.equal(GameState.isPendingFinalBattle(), false);
  assert.equal(GameState.onBattleWon('pu_basic_dmg', 80), true);
  assert.equal(GameState.hasPendingBattleResolution(), false, 'resolved rewards must not be replayable');
  assert.equal(GameState.onBattleWon('pu_basic_dmg', 80), false, 'duplicate reward resolution must be rejected');

  GameState.resetRun();
  GameState.currentMapColumn = GameState.mapNodes.length - 1;
  GameState.selectedNodeId = '6_boss';
  const pendingFinalBattle = GameState.getActiveBattle();
  GameState.lastReport = { _won: true, _battleId: pendingFinalBattle.id, _endHp: 45 };
  assert.equal(GameState.isPendingFinalBattle(), true, 'final boss reports must resume directly to victory');

  GameState.resetRun();
  GameState.rules[0].priority = 42;
  GameState.pushUndoState();
  assert.equal(GameState._undoStack.length > 0, true);
  GameState.resetRun();
  assert.deepEqual(GameState.rules.map(rule => rule.id), ['rule_1', 'rule_2', 'rule_3']);
  assert.equal(GameState._undoStack.length, 0, 'new runs must clear undo history');
  assert.equal(GameState._redoStack.length, 0, 'new runs must clear redo history');
  assert.equal(GameState.rules[0].priority, 100);

  GameState.stats = { max_hp: Number.NaN, basic_cd: -10, shield_reduce: 2 };
  GameState.normalizeAfterDatabaseLoad();
  assert.equal(GameState.stats.max_hp, 100, 'invalid stats must fall back to base values');
  assert.equal(GameState.stats.basic_cd, 0.01, 'cooldowns must remain positive after migration');
  assert.equal(GameState.stats.shield_reduce, 0.99, 'damage reduction must stay below 100%');

  GameState.resetRun();
  GameState.currentMapColumn = GameState.mapNodes.length;
  GameState.selectedNodeId = '6_boss';
  GameState.saveToStorage();
  GameState.loadFromStorage();
  GameState.normalizeAfterDatabaseLoad();
  assert.equal(GameState.isDemoCleared(), true, 'completed runs must remain completed after reload');
  assert.equal(GameState.selectedNodeId, null, 'completed runs must not point back to a playable node');

  GameState.resetRun();
  GameState.currentMapColumn = 3;
  GameState.selectedNodeId = '3_b';
  GameState.persistentHp = 3;
  GameState.selectMapNode('3_b');
  assert.equal(GameState.stats.max_hp, 125);
  assert.equal(GameState.persistentHp, 125);
  assert.equal(GameState.currentMapColumn, 4);

  GameState.resetRun();
  const ruleCountBeforeInvalidAdd = GameState.rules.length;
  assert.equal(GameState.addRule('missing_condition', null, 'basic_attack', 1), false);
  assert.equal(GameState.rules.length, ruleCountBeforeInvalidAdd, 'invalid rules must not enter the active build');
  const nearbyRule = GameState.rules.find(rule => rule.conditionId === 'enemy_nearby');
  GameState.setRuleConditionValue(nearbyRule.id, -999);
  assert.equal(nearbyRule.conditionValue, 1, 'condition parameters must clamp to their data contract');
  GameState.setRuleConditionValue(nearbyRule.id, 999);
  assert.equal(nearbyRule.conditionValue, 20, 'condition parameters must clamp to their data contract');

  GameState.resetRun();
  GameState.rules[1].priority = 100;
  assert.equal(GameState.normalizeRulePriorities(), true);
  assert.deepEqual(
    [...GameState.rules].sort((a, b) => b.priority - a.priority).map((rule) => rule.priority),
    [100, 90, 80],
  );

  GameState.resetRun();
  GameState.currentMapColumn = GameState.mapNodes.length - 1;
  assert.equal(GameManager.state, 'main');
  GameManager.onBattleFinished(true);
  assert.equal(GameManager.state, 'victory', 'final boss win should go directly to victory');
}

function verifyReportContracts() {
  const report = {
    damage_by_source: { crawler: 40 },
    action_usage: { basic_attack: 3 },
    interrupt_misses: 3,
    shield_activated_at_hp: -1,
    energy_overflow_time: 8,
    death_hp: 0,
    death_energy: 15,
    death_nearby_enemy_count: 4,
  };
  const early = buildReport(report, ['basic_attack', 'dash_away', 'shield'], ['enemy_nearby', 'hp_low', 'on_hazard']);
  assert(!early.suggestions.some((s) => s.rule?.conditionId === 'surrounded'), 'early report must not recommend locked Surrounded condition');
  assert(early.suggestions.some((s) => s.rule?.conditionId === 'enemy_nearby' && s.rule?.actionId === 'dash_away'));

  const late = buildReport(
    report,
    ['basic_attack', 'dash_away', 'shield', 'interrupt_shot', 'overdrive'],
    ['enemy_nearby', 'hp_low', 'on_hazard', 'enemy_casting', 'energy_high'],
  );
  assert(late.suggestions.some((s) => s.rule?.conditionId === 'enemy_casting'));
  assert(late.suggestions.some((s) => s.rule?.conditionId === 'energy_high'));
}

function verifySaveMigration() {
  localStorage.clear();
  localStorage.setItem('overlogic_run_save', JSON.stringify({
    currentBattleIndex: 999,
    currentMapColumn: 999,
    selectedNodeId: 'missing',
    mapNodes: [],
    teachNode: 9,
    stats: { max_hp: 140 },
    persistentHp: 999,
    unlockedConditionIds: ['surrounded', 'missing_condition'],
    unlockedActionIds: ['repair', 'missing_action'],
    rules: [
      { id: 'r1', conditionId: 'hp_low', conditionValue: 0.3, actionId: 'shield', priority: 100, targetPriority: 'invalid-target', enabled: true },
      { id: 'r2', conditionId: 'missing_condition', actionId: 'missing_action', priority: 1, enabled: true },
    ],
    _ruleCounter: 2,
  }));
  GameState.loadFromStorage();
  const changed = GameState.normalizeAfterDatabaseLoad();
  assert.equal(changed, true);
  assert.equal(GameState.currentMapColumn < GameState.mapNodes.length, true);
  assert.equal(GameState.currentBattleIndex < GameDatabase.getBattleCount(), true);
  assert.equal(GameState.teachNode <= 4, true);
  assert.equal(GameState.persistentHp <= GameState.stats.max_hp, true);
  assert.deepEqual(GameState.unlockedConditionIds, ['surrounded']);
  assert.deepEqual(GameState.unlockedActionIds, ['repair']);
  assert.equal(GameState.rules.length, 1);
  assert.equal(GameState.rules[0].targetPriority, 'nearest', 'invalid target priorities must migrate safely');

  const rulesBeforeInvalidLoadout = JSON.stringify(GameState.rules);
  assert.equal(GameState.saveLoadout(0), false, 'loadout writes must reject invalid slots');
  assert.equal(GameState.loadLoadout(4), false, 'loadout reads must reject invalid slots');
  assert.equal(GameState.hasLoadout('1'), false, 'loadout slot keys must be strict integers');
  const loadoutGetItem = localStorage.getItem;
  localStorage.getItem = function getItemWithLoadoutFailure(key) {
    if (key === 'overlogic_loadout_slot_1') throw new Error('loadout read denied');
    return loadoutGetItem.call(localStorage, key);
  };
  assert.equal(GameState.hasLoadout(1), false, 'loadout read failures must be contained');
  localStorage.getItem = loadoutGetItem;
  assert(runtimeDiagnosticsSnapshot().errors.some((entry) => entry.context === 'storage:loadout-1'),
    'loadout read failures should enter bounded support diagnostics');
  localStorage.setItem('overlogic_loadout_slot_1', JSON.stringify([
    { id: 'bad', conditionId: 'missing_condition', actionId: 'missing_action' },
  ]));
  assert.equal(GameState.loadLoadout(1), false, 'invalid loadouts must be rejected without clearing rules');
  assert.equal(JSON.stringify(GameState.rules), rulesBeforeInvalidLoadout);

  GameState.resetRun();
  localStorage.setItem('overlogic_loadout_slot_2', JSON.stringify([
    { id: 'rule_99', conditionId: 'hp_low', conditionValue: 0.3, actionId: 'shield', priority: 100 },
    { id: 'rule_99', conditionId: 'enemy_nearby', conditionValue: 8, actionId: 'basic_attack', priority: 10 },
  ]));
  assert.equal(GameState.loadLoadout(2).ok, true, 'valid loadouts should load');
  assert.equal(new Set(GameState.rules.map(rule => rule.id)).size, GameState.rules.length, 'loaded rules must have unique IDs');
  assert.equal(GameState.addRule('enemy_nearby', 6, 'basic_attack', 5), true);
  assert.equal(new Set(GameState.rules.map(rule => rule.id)).size, GameState.rules.length, 'new rules must not collide with loaded IDs');
  const undoDepthBeforeMissingDelete = GameState._undoStack.length;
  assert.equal(GameState.removeRule('missing-rule'), false, 'deleting a missing rule must be a no-op');
  assert.equal(GameState._undoStack.length, undoDepthBeforeMissingDelete);

  GameState.resetRun();
  GameState.rules[0].priority = 91;
  assert.equal(GameState.saveToStorage(), true);
  GameState.rules[0].priority = 73;
  assert.equal(GameState.saveToStorage(), true);
  const verifiedPrimary = JSON.parse(localStorage.getItem('overlogic_run_save'));
  assert.equal(typeof verifiedPrimary._integrity, 'string', 'new saves must carry an integrity checksum');
  localStorage.setItem('overlogic_run_save', JSON.stringify({ rules: [], _integrity: 'tampered' }));
  assert.equal(GameState.loadFromStorage(), true, 'a corrupt primary save must fall back to the last verified backup');
  assert.equal(GameState.rules[0].priority, 91, 'backup restore must recover the previous complete state');
  assert.equal(GameState.storageStatus.restoredFromBackup, true);
  const portableSave = GameState.exportSaveData();
  GameState.resetRun();
  assert.equal(GameState.rules[0].priority, 100);
  assert.equal(GameState.importSaveData(portableSave), true, 'portable saves must round-trip through validation');
  assert.equal(GameState.rules[0].priority, 91);
  assert.equal(GameState.importSaveData('{"product":"other"}'), false, 'foreign save formats must be rejected');
  const supportBundle = JSON.parse(GameState.exportSupportBundle());
  assert.equal(supportBundle.product, 'overlogic');
  assert(supportBundle.runtimeDiagnostics && supportBundle.runtimeDiagnostics.version === 1,
    'support bundle must include bounded runtime diagnostics');
}

function verifyTranslationContracts() {
  const diagnostics = translationDiagnostics();
  for (const [locale, result] of Object.entries(diagnostics)) {
    assert.deepEqual(result.missing, [], `${locale} must translate every canonical key`);
    assert.deepEqual(result.extra, [], `${locale} must not accumulate orphaned translation keys`);
    assert.deepEqual(result.placeholderMismatch, [], `${locale} placeholders must match English`);
    assert.deepEqual(result.simplifiedLeaks, [], `${locale} must not leak simplified-only characters into Traditional Chinese`);
  }
}

function verifyRuntimeDiagnosticsContracts() {
  resetRuntimeDiagnostics();
  markBootComplete(123.456);
  recordFrame(16.7);
  recordFrame(72.5);
  recordRuntimeEvent('external-save-updated');
  recordRuntimeError(new Error('fetch https://example.test/private C:\\Users\\player\\save.json'), 'test');
  for (let index = 0; index < 30; index += 1) recordRuntimeError(`error-${index}`, 'flood');
  const snapshot = runtimeDiagnosticsSnapshot();
  assert.equal(snapshot.bootDurationMs, 123, 'boot duration should be rounded and bounded');
  assert.equal(snapshot.frames.count, 2);
  assert.equal(snapshot.frames.longFrameCount, 1);
  assert.equal(snapshot.events.length, 1);
  assert.equal(snapshot.errors.length, 20, 'runtime errors must use a bounded ring buffer');
  assert(!snapshot.errors.some((entry) => entry.message.includes('https://') || entry.message.includes('C:\\Users')),
    'support diagnostics must redact URLs and local paths');
  resetRuntimeDiagnostics();
}

function verifyUiSafetyContracts() {
  assert.equal(escapeHtml('<img src=x onerror=alert(1)>'), '&lt;img src=x onerror=alert(1)&gt;');
  assert.equal(escapeHtml(`"quoted" & 'single'`), '&quot;quoted&quot; &amp; &#39;single&#39;');
  const html = fs.readFileSync('index.html', 'utf8');
  const editorUi = fs.readFileSync('src/ui/LogicEditorUI.js', 'utf8');
  const codeModalUi = fs.readFileSync('src/ui/CodeModal.js', 'utf8');
  const particleSystem = fs.readFileSync('src/vfx/ParticleSystem.js', 'utf8');
  const backgroundAnim = fs.readFileSync('src/systems/BackgroundAnim.js', 'utf8');
  const mainUi = fs.readFileSync('src/main.js', 'utf8');
  const menuUi = fs.readFileSync('src/ui/MainMenu.js', 'utf8');
  const gameManager = fs.readFileSync('src/core/GameManager.js', 'utf8');
  const arenaRenderer = fs.readFileSync('src/render/ArenaRenderer.js', 'utf8');
  assert(html.includes('id="mission-briefing"'), 'editor should expose launch readiness');
  assert(html.includes('id="setting-reduce-motion"'), 'settings should expose reduced motion');
  assert(html.includes('rel="manifest"') && html.includes('id="boot-status"') && html.includes('data-i18n="boot.loading"'), 'release shell should expose localized install metadata and boot status');
  assert(html.includes('http-equiv="Content-Security-Policy"') && html.includes('name="referrer" content="no-referrer"'), 'release shell must declare browser-enforced security and referrer policies');
  assert(html.includes('for="setting-volume"'), 'volume control must be associated with its label');
  assert(html.includes('for="setting-mute"'), 'mute control must be associated with its label');
  assert(html.includes('for="setting-shake"'), 'camera shake control must be associated with its label');
  assert(html.includes('aria-live="assertive"'), 'critical combat status should be announced');
  assert(html.includes('role="progressbar"'), 'combat meters should expose progress semantics');
  assert(html.includes('data-i18n-aria-label="combat.arena"'), 'combat canvas should have a localized accessible label');
  assert(html.includes('data-i18n-aria-label="chart.reportAlt"'), 'report chart should have an accessible label');
  assert(html.includes('id="btn-pause"') && html.includes('aria-pressed="false"'), 'pause control should expose its state');
  assert(html.includes('aria-keyshortcuts="S"'), 'speed control should expose its keyboard shortcut');
  assert(html.includes('id="locale-switcher"'), 'menu should expose a locale switcher');
  assert(html.includes('id="run-mode"'), 'menu should expose run modes');
  assert(html.includes('id="run-challenges"'), 'menu should expose daily objectives');
  assert(html.includes('id="btn-new-run"'), 'menu should distinguish continuing from starting a new run');
  assert(html.includes('id="confirm-overlay"') && html.includes('aria-describedby="confirm-message"'), 'destructive menu actions should use an accessible themed confirm dialog');
  assert(html.includes('id="code-overlay"') && html.includes('id="code-textarea"'), 'build sharing must use an accessible themed code dialog');
  assert(html.includes('class="editor-mobile-tabs"'), 'mobile editor should expose panel navigation');
  assert(html.includes('id="btn-export-rules"'), 'editor should expose build sharing');
  assert(html.includes('data-i18n-aria-label="editor.formPriority"'), 'rule builder priority must be labelled');
  assert(html.includes('data-i18n-aria-label="editor.formCondition1"'), 'rule builder condition must be labelled');
  assert(html.includes('id="synergy-list"'), 'editor should expose build synergies');
  assert(html.includes('id="rep-timeline"'), 'failure report should expose a critical timeline');
  assert(editorUi.includes("t('brief.countermeasure')"), 'launch readiness must show the countermeasure check it scores');
  assert(editorUi.includes("t('brief.launchChecks')"), 'dynamic readiness checks must have a localized accessible label');
  assert(mainUi.includes('settingsOriginalVolume'), 'closing settings must restore an unapplied volume preview');
  assert(menuUi.includes("this._requestConfirm('menu.newRunConfirm')") && menuUi.includes("this._requestConfirm('reset.confirm')"), 'destructive actions must use the themed confirm flow');
  assert(menuUi.includes('hasPendingBattleResolution') && menuUi.includes('resumePendingBattle'), 'main menu must recover an unresolved victory after refresh');
  assert(gameManager.includes('resumePendingBattle') && gameManager.includes('isPendingFinalBattle'), 'game manager must route pending victories safely');
  assert(editorUi.includes('this.codeModal.openExport') && editorUi.includes('this.codeModal.openImport'), 'build sharing must use the themed code dialog');
  assert(!editorUi.includes('prompt('), 'editor must not fall back to native prompt dialogs');
  assert(codeModalUi.includes('trapDialogFocus') && codeModalUi.includes('document.execCommand'), 'code dialog must trap focus and provide a clipboard fallback');
  assert(particleSystem.includes('reduceMotion') && particleSystem.includes('spawnEngineTrail'), 'reduced motion must reach the canvas particle system');
  assert(backgroundAnim.includes('setTransform(1, 0, 0, 1, 0, 0)'), 'background resize must reset the canvas transform before scaling');
  assert(mainUi.includes("new Event('mouseover'"), 'tooltips must be reachable from keyboard focus');
  assert(mainUi.includes("setLocale(GameState.settings.language") && mainUi.includes("t('boot.offlineDetail')"), 'boot shell must honor saved locale and localize recovery copy');
  assert(mainUi.includes('overlogic_run_archive') && mainUi.includes('event.key !== null'), 'external tabs must surface changes across all persistent data stores');
  assert(menuUi.includes('dailyProtocol') && menuUi.includes('menu.dailyProtocolLabel'), 'daily mode must disclose its deterministic protocol before launch');
  assert(mainUi.includes('bgAnim?.stop();\n      arena.setPaused(true)') && mainUi.includes('bgAnim?.start();\n      arena.setPaused(false)'), 'background animation must pause with hidden combat and resume on return');
  assert(arenaRenderer.includes('cacheOx') && arenaRenderer.includes('camera.x * scale'), 'grid cache must follow camera movement');
  const workflow = fs.readFileSync('.github/workflows/verify.yml', 'utf8');
  assert(workflow.includes('needs: verify'), 'Pages deployment must be gated by verification');
  assert(workflow.includes('npm run balance'), 'CI must gate deployment on balance simulation');
  const buildScript = fs.readFileSync('scripts/build.mjs', 'utf8');
  const devServer = fs.readFileSync('scripts/serve.mjs', 'utf8');
  const serviceWorker = fs.readFileSync('sw.js', 'utf8');
  const reportUi = fs.readFileSync('src/ui/PostBattleReportUI.js', 'utf8');
  const historyUi = fs.readFileSync('src/ui/MainMenu.js', 'utf8');
  const arenaUi = fs.readFileSync('src/core/CombatArena.js', 'utf8');
  assert(buildScript.includes("'manifest.webmanifest'") && buildScript.includes("'sw.js'"), 'build must publish the installable shell');
  assert(serviceWorker.includes('__RELEASE__') && serviceWorker.includes('PRECACHE_URLS') && serviceWorker.includes('putCacheSafe') && serviceWorker.includes('ignoreSearch') && serviceWorker.includes('networkFirst'), 'service worker must use versioned precache and offline navigation fallback');
  assert(buildScript.includes('collectPrecacheUrls') && buildScript.includes('PRECACHE_URLS'), 'build must inject the complete runtime precache manifest');
  assert(buildScript.includes('requestedRelease') && buildScript.includes('A-Za-z0-9'), 'build must sanitize release identifiers before injecting cache/query versions');
  assert(devServer.includes('relativePath') && devServer.includes('X-Content-Type-Options'), 'dev server must reject traversal and send safe response headers');
  assert(reportUi.includes("import { GameDatabase } from '../core/GameDatabase.js") && reportUi.includes('GameDatabase.getEnemy'), 'failure report must resolve enemy telemetry through the database');
  assert(historyUi.includes("import { escapeHtml } from './safeHtml.js") && historyUi.includes('escapeHtml(battle)'), 'history cards must escape imported identifiers');
  assert(arenaUi.includes('if (!report._sandbox)') && arenaUi.includes('recordBattle(GameState.lastReport)'), 'sandbox runs must not enter progression history');
  assert(arenaUi.includes("overlogic:challenge-complete"), 'completed daily objectives must provide player feedback');
  assert(arenaUi.includes('runModifiers') && arenaUi.includes('log.dailyProtocol'), 'combat must apply and announce daily protocol modifiers');
  assert(arenaUi.indexOf('this.hud.onBattleStart(battle)') < arenaUi.indexOf("t('log.dailyProtocol'"),
    'battle HUD must initialize before protocol and hazard notices are written');
  assert(gameManager.includes('GameState.recordRunCompletion()'), 'completed campaigns must enter the run archive');
  assert(html.includes('name="overlogic-release"') && html.includes('id="app-version"'), 'settings should expose a supportable release identifier');
  assert(html.includes('id="btn-data-support"') && mainUi.includes('exportSupportBundle'), 'settings should expose a privacy-safe support export');
  setLocale('zh-CN', { notify: false });
  assert.equal(t('menu.start'), '开始模拟');
  assert.equal(t('combat.temperature'), '核心温度');
  assert.equal(t('report.unavailable'), '当前不可用');
  assert.notEqual(t('menu.config.standard'), t('menu.config.modeStandard'));
  assert.equal(entity('condition', 'hp_low', 'HP Low'), '生命值较低');
  setLocale('zh-TW', { notify: false });
  assert.equal(t('menu.start'), '開始模擬');
  assert.equal(t('combat.temperature'), '核心溫度');
  assert.equal(t('report.unavailable'), '目前不可用');
  assert.equal(entity('action', 'shield', 'Shield'), '護盾');
  assert.equal(entity('action', 'basic_attack', 'Basic Attack'), '基礎攻擊');
  assert.equal(t('editor.prio'), '優先級');
  assert.equal(t('menu.difficulty'), '難度');
  assert.match(entity('action', 'shield', 'Shield', 'description'), /短時間/);
  assert.equal(entity('condition', 'projectile_nearby', 'Projectile Nearby'), '來襲彈體接近');
  assert.equal(entity('action', 'sidestep', 'Evasive Sidestep'), '規避側閃');
  assert.equal(entity('battle', 'battle_4', 'Swarm'), '蟲群');
  assert.equal(entity('battle', 'battle_1', 'System Calibration'), '系統校準');
  assert.equal(entity('battle', 'battle_6', 'Iron Tide'), '鋼鐵浪潮');
  assert.equal(entity('condition', 'battle_time_above', 'Battle Time Above'), '戰鬥時間已達');
  assert.equal(entity('action', 'interrupt_shot', 'Interrupt Shot'), '打斷射擊');
  assert.equal(t('editor.duplicate'), '複製規則');
  assert.equal(t('menu.config.modeStandard'), '自由路線與隨機獎勵');
  setLocale('en', { notify: false });
  assert.equal(t('report.unavailable'), 'Unavailable');
  assert.equal(t('combat.hitPoints'), 'Hit points');
}

function verifyRuleTelemetryContracts() {
  const tracker = new CombatStatsTracker();
  tracker.setRuleSnapshot([{ id: 'r1' }, { id: 'r2', enabled: false }]);
  tracker.recordDiagnostics({ r1: 'condition_false', r2: 'disabled' });
  tracker.recordDiagnostics({ r1: 'energy' });
  tracker.recordAction('basic_attack', 'r1');
  tracker.tick(1);
  tracker.recordDamageTaken(6, 'crawler');
  tracker.recordEnemyDeath('crawler');
  tracker.recordEnemyDeath('crawler');
  tracker.recordWave(2, 3);
  const report = tracker.toReport();
  assert.deepEqual(report.active_rule_ids, ['r1']);
  assert.equal(report.rule_usage.r1, 1);
  assert.equal(report.rule_diagnostics.r1.condition_false, 1);
  assert.equal(report.rule_diagnostics.r1.energy, 1);
  assert.equal(report.timeline.some(event => event.kind === 'action'), true);
  assert.equal(report.timeline.some(event => event.kind === 'damage'), true);
  assert.equal(report.timeline.some(event => event.kind === 'wave'), true);
  assert.equal(report.enemy_kills.crawler, 2, 'combat reports should preserve enemy kill distribution');
}

function verifySynergyContracts() {
  const build = {
    stats: {
      reflective_plating: 0.5,
      shield_dur: 3,
      heavy_impact: 1,
      emergency_recall: 1,
      nanite_repair: 2.5,
      superconductors: 1,
      thermal_recycle: 1,
    },
    unlockedActionIds: ['dash_through'],
  };
  assert.deepEqual(
    [...activeSynergyIds(build)].sort(),
    ['bastion_loop', 'kinetic_breach', 'phoenix_mesh', 'thermal_grid'],
  );
  const incomplete = synergyState({ stats: { reflective_plating: 0.5 }, unlockedActionIds: [] });
  assert.equal(incomplete.find(item => item.id === 'bastion_loop').progress, 1);
  assert.equal(incomplete.find(item => item.id === 'bastion_loop').active, false);
}

function verifyRunHistoryContracts() {
  clearHistory();
  resetProfile();
  clearChallenges();
  clearRunArchive();
  localStorage.setItem('overlogic_run_history', JSON.stringify([{ battleId: '<script>', difficulty: 'admin', won: 'yes', battleTime: 'NaN' }]));
  const sanitized = recentBattles(1)[0];
  assert.equal(sanitized.battleId, 'unknown');
  assert.equal(sanitized.difficulty, 'standard');
  assert.equal(sanitized.won, false);
  assert.equal(sanitized.battleTime, 0);
  clearHistory();
  assert.equal(recordBattle({ _sandbox: true, _battleId: 'sandbox_boss', _won: true }), null, 'sandbox reports must not award progression');
  assert.equal(recentBattles().length, 0);
  const challengeStart = challengeSnapshot();
  recordChallengeBattle({ won: true, damageDealt: 200, battleId: 'battle_1' });
  recordChallengeBattle({ won: true, damageDealt: 200, battleId: 'battle_1' });
  const challengeProgress = challengeSnapshot();
  assert.equal(challengeProgress.objectives.daily_wins.progress, 2);
  assert.equal(challengeProgress.objectives.daily_damage.progress, Math.min(challengeStart.objectives.daily_damage.target, 400));
  for (let index = 0; index < 6; index += 1) {
    if (Object.values(challengeSnapshot().objectives).every((item) => item.completed)) break;
    recordChallengeBattle({ won: true, damageDealt: 1000, battleId: 'battle_9' });
  }
  const challengeComplete = challengeSnapshot();
  assert.equal(challengeComplete.objectives.daily_wins.completed, true);
  assert.equal(challengeComplete.objectives.daily_damage.completed, true);
  assert.equal(challengeComplete.objectives.daily_boss.completed, true);
  const challengeBackup = GameState.exportSaveData();
  clearChallenges();
  const dayOne = new Date('2026-08-10T12:00:00Z');
  const dayTwo = new Date('2026-08-11T12:00:00Z');
  const dayFour = new Date('2026-08-13T12:00:00Z');
  for (let index = 0; index < 8; index += 1) recordChallengeBattle({ won: true, damageDealt: 5000, battleId: 'battle_9' }, dayOne);
  assert.equal(challengeSnapshot(dayOne).streak, 1, 'first completed challenge day should start a streak');
  for (let index = 0; index < 8; index += 1) recordChallengeBattle({ won: true, damageDealt: 5000, battleId: 'battle_9' }, dayTwo);
  assert.equal(challengeSnapshot(dayTwo).streak, 2, 'consecutive completed days should extend a streak');
  for (let index = 0; index < 8; index += 1) recordChallengeBattle({ won: true, damageDealt: 5000, battleId: 'battle_9' }, dayFour);
  assert.equal(challengeSnapshot(dayFour).streak, 1, 'missing a day should reset a streak');
  assert(challengeSnapshot(dayFour).completedDays.includes('2026-08-10'), 'challenge history should retain completed days');
  clearChallenges();
  const originalSetItem = localStorage.setItem;
  localStorage.setItem = () => { throw new Error('quota'); };
  const failedPersistence = recordChallengeBattle({ won: true, damageDealt: 5000, battleId: 'battle_9' });
  localStorage.setItem = originalSetItem;
  assert.equal(failedPersistence.persisted, false, 'storage failures must be observable');
  assert.equal(failedPersistence.bonusXp, 0, 'storage failures must not award daily XP');
  assert(runtimeDiagnosticsSnapshot().errors.some((entry) => entry.context === 'storage:daily-challenges'),
    'storage failures should be captured in the bounded support diagnostics');
  clearChallenges();
  assert.equal(GameState.importSaveData(challengeBackup), true, 'full backups must include daily challenge state');
  assert.equal(challengeSnapshot().objectives.daily_boss.completed, true);
  clearRunArchive();
  const firstRun = recordCompletedRun({
    id: 'run_test_first', completedAt: '2026-08-10T12:00:00Z', mode: 'standard', difficulty: 'standard',
    seed: 101, battlesWon: 7, totalDamageDealt: 2400, totalBattleTime: 140.5, finalHp: 22, rulesCount: 8, upgrades: 6,
  });
  assert.equal(firstRun.isNew, true);
  assert.equal(runRecords().completions, 1);
  assert.equal(runRecords().bestTime, 140.5);
  assert.equal(recordCompletedRun({ id: 'run_test_first', totalBattleTime: 1 }).isNew, false, 'run ids must prevent duplicate completion records');
  recordCompletedRun({
    id: 'run_test_fast', completedAt: '2026-08-11T12:00:00Z', mode: 'daily', difficulty: 'veteran',
    seed: 102, battlesWon: 7, totalDamageDealt: 2600, totalBattleTime: 119.25, finalHp: 31, rulesCount: 9, upgrades: 6,
  });
  assert.deepEqual({ completions: runRecords().completions, daily: runRecords().dailyCompletions, veteran: runRecords().veteranCompletions },
    { completions: 2, daily: 1, veteran: 1 });
  assert.equal(runRecords().bestRun.id, 'run_test_fast');
  GameState.currentMapColumn = GameState.mapNodes.length;
  GameState.runConfig = { mode: 'standard', difficulty: 'casual', seed: 103 };
  GameState.runStats = {
    runId: 'run_integration', completionRecorded: false, battlesWon: 7,
    totalDamageDealt: 2200, totalBattleTime: 130, rewardsChosen: ['pu_max_hp'],
  };
  GameState.lastReport = { _endHp: 44 };
  assert.equal(GameState.recordRunCompletion()?.persisted, true, 'cleared campaigns should archive through GameState');
  assert.equal(GameState.runStats.completionRecorded, true);
  assert.equal(GameState.recordRunCompletion(), null, 'a completed run must only settle once');
  const archiveBackup = GameState.exportSaveData();
  clearRunArchive();
  assert.equal(GameState.importSaveData(archiveBackup), true, 'full backups must include completed run records');
  assert.equal(runArchiveSnapshot().entries.length, 3);
  recordBattle({
    _battleId: 'battle_4', _runSeed: 20260816, _runMode: 'daily', _difficulty: 'veteran',
    _won: true, battle_time: 12.34, _endHp: 77, total_damage_dealt: 248,
    damage_by_source: { crawler: 10, shooter: 4 },
  });
  recordBattle({
    _battleId: 'battle_4', _runSeed: 20260816, _runMode: 'daily', _difficulty: 'veteran',
    _won: false, battle_time: 9.1, death_hp: 0, total_damage_dealt: 30,
    damage_by_source: { crawler: 22 },
  });
  const recent = recentBattles(4);
  assert.equal(recent.length, 2);
  assert.equal(recent[0].won, false, 'history should put the newest battle first');
  assert.equal(recent[1].seed, 20260816);
  assert.deepEqual(historySummary(), { battles: 2, wins: 1, losses: 1, damageDealt: 278 });
  const profile = profileSnapshot();
  assert.equal(profile.totalBattles, 2);
  assert.equal(profile.wins, 1);
  assert.equal(profile.losses, 1);
  assert.equal(profile.achievements.first_battle !== undefined, true);
  assert.equal(profile.achievements.debugger !== undefined, true);
  assert.equal(profileRank(profile.xp).level >= 1, true);
  const fullExport = GameState.exportSaveData();
  clearHistory();
  resetProfile();
  assert.equal(recentBattles().length, 0);
  assert.equal(GameState.importSaveData(fullExport), true, 'full backups must include local history and profile');
  assert.equal(recentBattles().length, 2);
  assert.equal(profileSnapshot().wins, 1);
  GameState.settings.language = 'en';
  GameState.saveSettings();
  localStorage.setItem('overlogic_loadout_slot_2', JSON.stringify([{ baseline: true }]));
  const baselinePrimary = localStorage.getItem('overlogic_run_save');
  const baselineBackup = localStorage.getItem('overlogic_run_save_backup');
  const transactionalPayload = JSON.parse(GameState.exportSaveData());
  transactionalPayload.settings.language = 'zh-TW';
  transactionalPayload.run.currentBattleIndex = 2;
  transactionalPayload.loadouts[2] = [];
  const transactionalSetItem = localStorage.setItem;
  localStorage.setItem = function setItemWithArchiveFailure(key, value) {
    if (key === 'overlogic_run_archive') throw new Error('archive quota');
    return transactionalSetItem.call(localStorage, key, value);
  };
  assert.equal(GameState.importSaveData(JSON.stringify(transactionalPayload)), false, 'partial imports must roll back atomically');
  localStorage.setItem = transactionalSetItem;
  assert.equal(GameState.settings.language, 'en', 'failed imports must restore settings');
  assert.equal(localStorage.getItem('overlogic_loadout_slot_2'), JSON.stringify([{ baseline: true }]), 'failed imports must restore loadouts');
  assert.equal(localStorage.getItem('overlogic_run_save'), baselinePrimary, 'failed imports must restore the prior run');
  assert.equal(localStorage.getItem('overlogic_run_save_backup'), baselineBackup, 'failed imports must restore the prior recovery point');
  localStorage.setItem('overlogic_loadout_slot_1', JSON.stringify(GameState.rules));
  const transactionalRemoveItem = localStorage.removeItem;
  localStorage.removeItem = function removeItemWithOneFailure(key) {
    if (key === 'overlogic_run_save_backup') throw new Error('backup clear denied');
    return transactionalRemoveItem.call(localStorage, key);
  };
  assert.equal(GameState.clearStorage(), false, 'partial reset failures must be reported to the UI');
  localStorage.removeItem = transactionalRemoveItem;
  assert.equal(localStorage.getItem('overlogic_loadout_slot_1'), null,
    'a failed key must not prevent independent reset targets from clearing');
  assert.equal(GameState.clearStorage(), true, 'reset should report success once all stores are writable');
  assert.equal(recentBattles().length, 0, 'reset progress should clear battle history');
  assert.equal(profileSnapshot().totalBattles, 0, 'reset progress should clear profile progression');
  assert.equal(runArchiveSnapshot().entries.length, 0, 'reset progress should clear completed run records');
  assert.equal(localStorage.getItem('overlogic_loadout_slot_1'), null, 'reset progress should clear saved loadouts');
  assert.equal(challengeSnapshot().streak, 0, 'reset progress should clear daily progression');
}

function verifySimulation() {
  GameState.clearStorage();
  GameState.normalizeAfterDatabaseLoad();
  GameState.runConfig = { mode: 'standard', difficulty: 'standard', seed: 20260725 };
  for (let index = 0; index < 3; index += 1) {
    const result = simulateBattle(GameDatabase.getBattle(index), { maxTime: 60 });
    assert.equal(result.won, true, `default rules should clear ${result.battleName}`);
    assert(result.damageDealt > 0, 'simulation should record player damage');
    assert(result.timelineEvents > 0, 'simulation should expose combat telemetry');
    const expectedWaves = new Set((GameDatabase.getBattle(index).enemySpawns || []).map((spawn) => spawn.wave || 1)).size;
    assert.equal(result.wavesRecorded, expectedWaves, 'simulation should record every deployed wave');
  }

  // A realistic upgraded starter build must be able to finish the standard
  // boss without depending on a specific action-unlock reward.
  GameState.stats.max_hp = 125;
  GameState.stats.basic_dmg = 15.625;
  GameState.stats.armor_piercing = 3;
  GameState.stats.superconductors = 1;
  GameState.persistentHp = 125;
  GameState._advanceTeachRulesTo(4);
  const shieldRule = GameState.rules.find(rule => rule.actionId === 'shield');
  shieldRule.conditionValue = 0.6;
  shieldRule.priority = 95;
  const attackRule = GameState.rules.find(rule => rule.actionId === 'basic_attack');
  attackRule.targetPriority = 'boss';
  const boss = withSeededRandom(20260725, () =>
    simulateBattle(GameDatabase.getBattle(8), { maxTime: 120 })
  );
  assert.equal(boss.won, true, 'standard boss should remain beatable with an upgraded starter kit');
}

verifySyntax();
await verifyImportGraph();
verifyDataContracts();
await verifyGameplayContracts();
verifyReportContracts();
verifySaveMigration();
verifyTranslationContracts();
verifyRuntimeDiagnosticsContracts();
verifyUiSafetyContracts();
verifyRuleTelemetryContracts();
verifySynergyContracts();
verifyRunHistoryContracts();
verifySimulation();

console.log('VERIFY_OK');
