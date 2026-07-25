import assert from 'node:assert/strict';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { installBrowserShims, withSeededRandom } from './test-env.mjs';
import { simulateBattle } from './simulate-balance.mjs';

installBrowserShims();

const { GameDatabase } = await import('../src/core/GameDatabase.js');
await GameDatabase.loadAll();
const { GameState } = await import('../src/core/GameState.js');
const { buildReport } = await import('../src/systems/PostBattleReportBuilder.js');
const { buildRewardOptions, buildUpgradeOptions, rewardDescription } = await import('../src/systems/RewardManager.js');
const { GameManager } = await import('../src/core/GameManager.js');
const { CombatArena, isBossEnemyId } = await import('../src/core/CombatArena.js');
const { BattleContext } = await import('../src/core/BattleContext.js');
const { CombatStatsTracker } = await import('../src/systems/CombatStatsTracker.js');
const { escapeHtml } = await import('../src/ui/safeHtml.js');

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
      { id: 'r1', conditionId: 'hp_low', conditionValue: 0.3, actionId: 'shield', priority: 100, enabled: true },
      { id: 'r2', conditionId: 'missing_condition', actionId: 'missing_action', priority: 1, enabled: true },
    ],
    _ruleCounter: 2,
  }));
  GameState.loadFromStorage();
  const changed = GameState.normalizeAfterDatabaseLoad();
  assert.equal(changed, true);
  assert.equal(GameState.currentMapColumn < GameState.mapNodes.length, true);
  assert.equal(GameState.teachNode <= 4, true);
  assert.equal(GameState.persistentHp <= GameState.stats.max_hp, true);
  assert.deepEqual(GameState.unlockedConditionIds, ['surrounded']);
  assert.deepEqual(GameState.unlockedActionIds, ['repair']);
  assert.equal(GameState.rules.length, 1);
}

function verifyUiSafetyContracts() {
  assert.equal(escapeHtml('<img src=x onerror=alert(1)>'), '&lt;img src=x onerror=alert(1)&gt;');
  assert.equal(escapeHtml(`"quoted" & 'single'`), '&quot;quoted&quot; &amp; &#39;single&#39;');
  const html = fs.readFileSync('index.html', 'utf8');
  assert(html.includes('id="mission-briefing"'), 'editor should expose launch readiness');
  assert(html.includes('id="setting-reduce-motion"'), 'settings should expose reduced motion');
  assert(html.includes('aria-live="assertive"'), 'critical combat status should be announced');
}

function verifyRuleTelemetryContracts() {
  const tracker = new CombatStatsTracker();
  tracker.setRuleSnapshot([{ id: 'r1' }, { id: 'r2', enabled: false }]);
  tracker.recordDiagnostics({ r1: 'condition_false', r2: 'disabled' });
  tracker.recordDiagnostics({ r1: 'energy' });
  tracker.recordAction('basic_attack', 'r1');
  const report = tracker.toReport();
  assert.deepEqual(report.active_rule_ids, ['r1']);
  assert.equal(report.rule_usage.r1, 1);
  assert.equal(report.rule_diagnostics.r1.condition_false, 1);
  assert.equal(report.rule_diagnostics.r1.energy, 1);
}

function verifySimulation() {
  GameState.clearStorage();
  GameState.normalizeAfterDatabaseLoad();
  for (let index = 0; index < 3; index += 1) {
    const result = simulateBattle(GameDatabase.getBattle(index), { maxTime: 60 });
    assert.equal(result.won, true, `default rules should clear ${result.battleName}`);
    assert(result.damageDealt > 0, 'simulation should record player damage');
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
verifySimulation();

console.log('VERIFY_OK');
