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
const { entity, setLocale, t } = await import('../src/i18n/I18n.js?v=20260725-4');
const { difficultyModifiers } = await import('../src/systems/RunModifiers.js?v=20260725-4');
const { activeSynergyIds, synergyState } = await import('../src/systems/ProtocolSynergies.js?v=20260725-4');

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
  for (const file of [...collectJsFiles('src'), ...collectJsFiles('scripts')]) {
    execFileSync('node', ['--check', file], { stdio: 'pipe' });
  }
}

function verifyDataContracts() {
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

function verifyGameplayContracts() {
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
  GameState.configureRun('standard', 'standard');

  assert(GameDatabase.getCondition('projectile_nearby'), 'projectile warning condition must exist');
  assert(GameDatabase.getAction('sidestep'), 'evasive sidestep action must exist');
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
  localStorage.setItem('overlogic_loadout_slot_1', JSON.stringify([
    { id: 'bad', conditionId: 'missing_condition', actionId: 'missing_action' },
  ]));
  assert.equal(GameState.loadLoadout(1), false, 'invalid loadouts must be rejected without clearing rules');
  assert.equal(JSON.stringify(GameState.rules), rulesBeforeInvalidLoadout);
}

function verifyUiSafetyContracts() {
  assert.equal(escapeHtml('<img src=x onerror=alert(1)>'), '&lt;img src=x onerror=alert(1)&gt;');
  assert.equal(escapeHtml(`"quoted" & 'single'`), '&quot;quoted&quot; &amp; &#39;single&#39;');
  const html = fs.readFileSync('index.html', 'utf8');
  const editorUi = fs.readFileSync('src/ui/LogicEditorUI.js', 'utf8');
  assert(html.includes('id="mission-briefing"'), 'editor should expose launch readiness');
  assert(html.includes('id="setting-reduce-motion"'), 'settings should expose reduced motion');
  assert(html.includes('for="setting-volume"'), 'volume control must be associated with its label');
  assert(html.includes('for="setting-mute"'), 'mute control must be associated with its label');
  assert(html.includes('for="setting-shake"'), 'camera shake control must be associated with its label');
  assert(html.includes('aria-live="assertive"'), 'critical combat status should be announced');
  assert(html.includes('role="progressbar"'), 'combat meters should expose progress semantics');
  assert(html.includes('id="btn-pause"') && html.includes('aria-pressed="false"'), 'pause control should expose its state');
  assert(html.includes('aria-keyshortcuts="S"'), 'speed control should expose its keyboard shortcut');
  assert(html.includes('id="locale-switcher"'), 'menu should expose a locale switcher');
  assert(html.includes('id="run-mode"'), 'menu should expose run modes');
  assert(html.includes('id="btn-new-run"'), 'menu should distinguish continuing from starting a new run');
  assert(html.includes('class="editor-mobile-tabs"'), 'mobile editor should expose panel navigation');
  assert(html.includes('id="btn-export-rules"'), 'editor should expose build sharing');
  assert(html.includes('id="synergy-list"'), 'editor should expose build synergies');
  assert(html.includes('id="rep-timeline"'), 'failure report should expose a critical timeline');
  assert(editorUi.includes("t('brief.countermeasure')"), 'launch readiness must show the countermeasure check it scores');
  assert(editorUi.includes("t('brief.launchChecks')"), 'dynamic readiness checks must have a localized accessible label');
  const workflow = fs.readFileSync('.github/workflows/verify.yml', 'utf8');
  assert(workflow.includes('needs: verify'), 'Pages deployment must be gated by verification');
  assert(workflow.includes('npm run balance'), 'CI must gate deployment on balance simulation');
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
  tracker.recordWave(2, 3);
  const report = tracker.toReport();
  assert.deepEqual(report.active_rule_ids, ['r1']);
  assert.equal(report.rule_usage.r1, 1);
  assert.equal(report.rule_diagnostics.r1.condition_false, 1);
  assert.equal(report.rule_diagnostics.r1.energy, 1);
  assert.equal(report.timeline.some(event => event.kind === 'action'), true);
  assert.equal(report.timeline.some(event => event.kind === 'damage'), true);
  assert.equal(report.timeline.some(event => event.kind === 'wave'), true);
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

function verifySimulation() {
  GameState.clearStorage();
  GameState.normalizeAfterDatabaseLoad();
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
verifyDataContracts();
verifyGameplayContracts();
verifyReportContracts();
verifySaveMigration();
verifyUiSafetyContracts();
verifyRuleTelemetryContracts();
verifySynergyContracts();
verifySimulation();

console.log('VERIFY_OK');
