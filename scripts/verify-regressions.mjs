import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { beforeEach, test } from 'node:test';
import vm from 'node:vm';
import { installBrowserShims } from './test-env.mjs';

installBrowserShims();
globalThis.requestAnimationFrame = () => 0;
globalThis.cancelAnimationFrame = () => {};
window.dispatchEvent = () => {};

const { GameDatabase } = await import('../src/core/GameDatabase.js?v=20260725-4');
await GameDatabase.loadAll();
const { GameState } = await import('../src/core/GameState.js?v=20260725-4');
const { GameManager } = await import('../src/core/GameManager.js?v=20260725-4');
const { CombatArena, SIMULATION_STEP_SECONDS } = await import('../src/core/CombatArena.js?v=20260725-4');
const { buildUpgradeOptions } = await import('../src/systems/RewardManager.js?v=20260725-4');
const { buildReport } = await import('../src/systems/PostBattleReportBuilder.js?v=20260725-4');
const { ARCHIVE_KEY, runArchiveSnapshot } = await import('../src/systems/RunArchive.js?v=20260725-4');
const { allBattles } = await import('../src/systems/RunHistory.js?v=20260725-4');
const { loadOperationsConfig, resetOperationsConfigForTests } = await import('../src/systems/OperationsConfig.js?v=20260725-4');
const { BattleHUD } = await import('../src/ui/BattleHUD.js?v=20260725-4');
const { LogicEditorUI } = await import('../src/ui/LogicEditorUI.js?v=20260725-4');
const { setLocale } = await import('../src/i18n/I18n.js?v=20260725-4');

const PRIMARY = 'overlogic_run_save';
const BACKUP = 'overlogic_run_save_backup';
const noop = () => {};
const hud = new Proxy({}, { get: () => noop });
const gradient = { addColorStop: noop };
const graphics = new Proxy({}, {
  get(target, name) {
    if (name in target) return target[name];
    if (String(name).startsWith('create')) return () => gradient;
    if (name === 'measureText') return () => ({ width: 20 });
    return noop;
  },
});
const makeCanvas = () => ({ width: 720, height: 720, getContext: () => graphics });
const createElement = document.createElement;
document.createElement = (tag) => tag === 'canvas' ? makeCanvas() : createElement(tag);

beforeEach(() => {
  resetOperationsConfigForTests();
  localStorage.clear();
  GameState.loadFromStorage();
  GameState.settings.runMode = 'standard';
  GameState.settings.difficulty = 'standard';
  GameState.settings.screenShake = true;
  GameState.settings.reduceMotion = false;
  GameState.resetRun();
  setLocale('en', { notify: false });
});

function startArena(battle) {
  const arena = new CombatArena(makeCanvas(), hud);
  arena.start(battle);
  return arena;
}

function activeColumn(column, nodeId) {
  GameState.currentMapColumn = column;
  GameState.selectedNodeId = nodeId;
  GameState.saveToStorage();
}

function stageWin() {
  GameState.lastReport = {
    _battleId: GameState.getActiveBattle().id,
    _won: true,
    _endHp: 89,
    battle_time: 4,
    total_damage_dealt: 72,
  };
  assert.equal(GameState.saveToStorage(), true);
}

function withWriteFailure(key, callback) {
  const setItem = localStorage.setItem;
  localStorage.setItem = function (name, value) {
    if (name === key) throw new Error(`Simulated failure writing ${key}`);
    return setItem.call(this, name, value);
  };
  try {
    callback();
  } finally {
    localStorage.setItem = setItem;
  }
}

function rawStores() {
  return Object.fromEntries(Array.from({ length: localStorage.length }, (_, index) => {
    const key = localStorage.key(index);
    return [key, localStorage.getItem(key)];
  }));
}

test('the real arena produces identical results across render schedules and shake settings', () => {
  for (const [index, seed, hp] of [[2, 12345, 100], [7, 12, 82], [12, 12345, 150]]) {
    const battle = GameDatabase.getBattle(index);
    const results = [];
    for (const [frameInterval, shake] of [[0, true], [1, true], [2, true], [1, false]]) {
      GameState.resetRun();
      GameState.configureRun('standard', 'standard', seed);
      GameState.stats.max_hp = Math.max(100, hp);
      GameState.persistentHp = hp;
      GameState.settings.screenShake = shake;
      const arena = startArena(battle);
      for (let step = 1; step <= 5400 && !arena._finished; step += 1) {
        arena._update(SIMULATION_STEP_SECONDS);
        if (frameInterval && step % frameInterval === 0) arena._render();
      }
      assert.equal(arena._finished, true, battle.id);
      const report = GameState.lastReport;
      results.push([report._won, arena.robot.hp, report.battle_time, report._replayDigest, report._simulationVersion]);
    }
    for (const result of results) assert.deepEqual(result, results[0], battle.id);
    assert.equal(results[0][4], 3);
  }
});

test('stale arenas cannot publish a report or record progression after import or restore', () => {
  for (const method of ['import', 'restore']) {
    GameState.resetRun();
    const originalRunId = GameState.runStats.runId;
    const portable = GameState.exportSaveData();
    localStorage.setItem(BACKUP, localStorage.getItem(PRIMARY));
    const arena = startArena(GameState.getActiveBattle());
    let ended = false;
    arena.onFinished = () => { ended = true; };
    const loaded = method === 'import' ? GameState.importSaveData(portable) : GameState.restoreBackup();
    assert.equal(loaded, true);
    assert.equal(GameState.runStats.runId, originalRunId, 'the save can even be from the same run');
    const previous = localStorage.getItem(PRIMARY);
    arena._finish(true);
    assert.equal(ended, false);
    assert.equal(localStorage.getItem(PRIMARY), previous);
    assert.equal(GameState.lastReport._won, undefined);
    assert.equal(allBattles().length, 0);
  }
});

test('Upgrade Vault persists the same choices and advances only after one claim', () => {
  activeColumn(5, '5_upgrade');
  GameState.currentBattleIndex = 6;
  assert.equal(GameState.getActiveBattle(), null);
  GameState.selectMapNode('5_upgrade');
  assert.equal(GameState.currentMapColumn, 5);
  assert.equal(GameState.mapNodes[5][0].completed, false);
  const options = buildUpgradeOptions();
  assert.equal(GameState.loadFromStorage(), true);
  GameState.normalizeAfterDatabaseLoad();
  assert.equal(GameState.hasPendingUpgradeReward(), true);
  assert.deepEqual(buildUpgradeOptions(), options);
  assert.equal(GameManager.resumePendingBattle(), true);
  assert.equal(GameManager.state, 'reward');
  GameManager.onRewardChosen(options[0]);
  GameManager.onRewardChosen(options[0]);
  assert.deepEqual(GameState.runStats.rewardsChosen, [options[0]]);
  assert.equal(GameState.currentMapColumn, 6);
  assert.equal(GameState.mapNodes[5][0].completed, true);
  assert.equal(GameState.hasPendingUpgradeReward(), false);
});

test('a failed primary write cannot persist partial victory rewards or teaching unlocks', () => {
  stageWin();
  const before = localStorage.getItem(PRIMARY);
  const setItem = localStorage.setItem;
  let writes = 0;
  localStorage.setItem = function (key, value) {
    if (key === PRIMARY) {
      writes += 1;
      if (JSON.parse(value).lastReport._resolutionApplied) throw new Error('Final victory write failed');
    }
    return setItem.call(this, key, value);
  };
  const log = console.error;
  console.error = noop;
  try {
    GameState.onBattleWon('pu_max_hp', 89);
  } finally {
    localStorage.setItem = setItem;
    console.error = log;
  }
  assert.equal(writes, 1);
  assert.equal(localStorage.getItem(PRIMARY), before);
  assert(GameState.loadFromStorage());
  assert.equal(GameState.hasPendingBattleResolution(), true);
  assert.equal(GameState.stats.max_hp, 100);
  assert.equal(GameState.teachNode, 1);
  assert.equal(GameState.onBattleWon('pu_max_hp', 89), true);
  assert.equal(GameState.onBattleWon('pu_max_hp', 89), false);
  assert.equal(GameState.runStats.battlesWon, 1);
  assert.equal(GameState.stats.max_hp, 120);
});

test('first-battle rewards lock mode, difficulty, and seed', () => {
  GameState.configureRun('standard', 'standard', 12345);
  stageWin();
  assert(GameState.loadFromStorage());
  assert.equal(GameState.canConfigureRun(), false);
  const preset = GameState.parseLaunchPreset('?mode=weekly&difficulty=veteran&seed=202648');
  GameState.configureRun(preset.mode, preset.difficulty, preset.seed);
  assert.deepEqual(GameState.runConfig, { mode: 'standard', difficulty: 'standard', seed: 12345 });
  assert.equal(GameState.hasPendingBattleResolution(), true);
});

test('corrupt primary and backup stay intact and an explicit import can recover them', () => {
  const portable = GameState.exportSaveData();
  localStorage.setItem(PRIMARY, '{damaged primary');
  localStorage.setItem(BACKUP, '{damaged secondary');
  assert.equal(GameState.loadFromStorage(), false);
  GameState.resetRun();
  assert.equal(GameState.storageStatus.conflict, false);
  assert.equal(GameState.storageStatus.requiresRecovery, true);
  assert.equal(localStorage.getItem(PRIMARY), '{damaged primary');
  assert.equal(GameState.hasBackup(), false);
  assert.equal(GameState.importSaveData(portable), true);
  assert.equal(GameState.storageStatus.requiresRecovery, false);
  assert.equal(JSON.parse(localStorage.getItem(PRIMARY)).saveVersion, 8);
});

test('failed imports restore exact bytes including records above current retention limits', () => {
  const entries = Array.from({ length: 65 }, (_, index) => ({
    id: `legacy-${index}`, completedAt: new Date(1700000000000 + index * 1000).toISOString(), seed: index + 1,
  }));
  localStorage.setItem(ARCHIVE_KEY, JSON.stringify({ version: 1, entries }));
  const portable = GameState.exportSaveData();
  const original = rawStores();
  const future = JSON.parse(portable);
  delete future.integrity;
  future.run.saveVersion = 99;
  assert.equal(GameState.importSaveData(JSON.stringify(future)), false);
  assert.deepEqual(rawStores(), original);
  withWriteFailure(PRIMARY, () => assert.equal(GameState.importSaveData(portable), false));
  assert.deepEqual(rawStores(), original);
});

test('returning to the menu retries a failed final archive write exactly once', () => {
  activeColumn(8, '8_singularity');
  stageWin();
  const id = GameState.runStats.runId;
  withWriteFailure(ARCHIVE_KEY, () => GameManager.onBattleFinished(true));
  assert.equal(GameState.isDemoCleared(), true);
  assert.equal(GameState.runStats.completionRecorded, false);
  assert(GameState.loadFromStorage());
  GameManager.goMainMenu();
  GameManager.goMainMenu();
  assert.equal(GameState.runStats.completionRecorded, true);
  assert.equal(runArchiveSnapshot().entries.filter((entry) => entry.id === id).length, 1);
});

test('service worker serves coherent releases across failed updates and offline reloads', async () => {
  const scope = 'https://overlogic.test/game/';
  const files = ['./index.html', './src/main.js'];
  const savedCaches = new Map();
  let published = 'release-a';
  let failedAsset = false;
  let offline = false;
  const sri = (value) => 'sha256-' + createHash('sha256').update(value).digest('base64');
  const responseBody = (path, release) => `${path} ${release}`;
  const fetch = async (request) => {
    const path = './' + new URL(request.url).pathname.split('/game/')[1];
    if (offline || (failedAsset && path === files[1])) return new Response(null, { status: 503 });
    const body = responseBody(path, published);
    if (request.integrity && request.integrity !== sri(body)) throw new TypeError('Integrity mismatch');
    return new Response(body);
  };
  const caches = {
    keys: async () => [...savedCaches.keys()],
    delete: async (name) => savedCaches.delete(name),
    open: async (name) => ({
      async addAll(requests) {
        const records = await Promise.all(requests.map(async (request) => {
          const response = await fetch(request);
          if (!response.ok) throw new Error('Asset request failed');
          return [request.url, response];
        }));
        savedCaches.set(name, new Map(records));
      },
    }),
    match: async (url, { cacheName }) => savedCaches.get(cacheName)?.get(String(url))?.clone(),
  };
  const source = fs.readFileSync('sw.js', 'utf8');
  function worker(release) {
    const listeners = {};
    const self = {
      registration: { scope },
      addEventListener: (name, listener) => { listeners[name] = listener; },
      skipWaiting: async () => {},
      clients: { claim: async () => {} },
    };
    const integrity = Object.fromEntries(files.map((file) => [file, sri(responseBody(file, release))]));
    vm.runInNewContext(source.replaceAll('__RELEASE__', release)
      .replace('/*__PRECACHE_URLS__*/APP_SHELL', JSON.stringify(files))
      .replace('/*__PRECACHE_INTEGRITY__*/{}', JSON.stringify(integrity)),
    { self, URL, Request, Response, caches, fetch });
    return {
      lifecycle(event) {
        let done;
        listeners[event]({ waitUntil: (promise) => { done = promise; } });
        return done;
      },
      request(path, mode = 'cors') {
        let response;
        listeners.fetch({
          request: { url: new URL(path, scope).href, method: 'GET', mode },
          respondWith: (promise) => { response = promise; },
        });
        return response;
      },
    };
  }
  const old = worker('release-a');
  await old.lifecycle('install');
  await old.lifecycle('activate');
  published = 'release-b';
  failedAsset = true;
  const update = worker('release-b');
  await assert.rejects(update.lifecycle('install'), /Asset request failed/);
  assert.equal(await (await old.request('./?challenge=test', 'navigate')).text(), './index.html release-a');
  assert.equal(await (await old.request('./src/main.js?v=release-a')).text(), './src/main.js release-a');
  assert.equal((await old.request('./src/main.js?v=release-b')).status, 503);
  failedAsset = false;
  await assert.rejects(worker('stale-release').lifecycle('install'), /Integrity mismatch/);
  await update.lifecycle('install');
  await update.lifecycle('activate');
  offline = true;
  assert.equal(await (await update.request('./', 'navigate')).text(), './index.html release-b');
  assert.equal(await (await update.request('./src/main.js?v=release-b')).text(), './src/main.js release-b');
  assert.equal(await (await update.request('./src/main.js?v=release-a')).text(), './src/main.js release-a');
});

test('operations flags gate new challenges and preserve existing periodic runs', async () => {
  GameState.configureRun('weekly', 'veteran', 202648);
  activeColumn(1, '1_a');
  await loadOperationsConfig({
    fetcher: async () => ({ json: async () => ({ schemaVersion: 1, features: { weeklyGauntlet: false } }) }),
  });
  assert(GameState.loadFromStorage());
  GameState.normalizeAfterDatabaseLoad();
  assert.deepEqual(GameState.runConfig, { mode: 'weekly', difficulty: 'veteran', seed: 202648 });
  GameState.resetRun();
  assert.equal(GameState.runConfig.mode, 'standard');
  GameState.configureRun('weekly', 'veteran', 202648);
  assert.equal(GameState.runConfig.mode, 'standard');
});

test('Warden and Apex direct attacks scale with their enemy data and difficulty', () => {
  for (const [index, base] of [[8, 10], [9, 12]]) {
    for (const [difficulty, scale] of [['casual', 0.82], ['standard', 1], ['veteran', 1.15]]) {
      GameState.resetRun();
      GameState.configureRun('standard', difficulty, 12345);
      const arena = startArena(GameDatabase.getBattle(index));
      arena._deployNextWave();
      const boss = arena.ctx.boss;
      const strikes = [];
      const player = { x: boss.x + 1, y: boss.y, takeDamage: (damage) => strikes.push(damage) };
      arena.ctx.robot = player;
      boss.laserAngle = 0;
      boss._checkLaserHit(player);
      boss._phase1(1, player, 1, 0, 1);
      const expected = base * scale;
      assert.deepEqual(strikes, [expected * 3, expected * 1.5]);
      assert.equal(arena.ctx.projectiles[0].dmg, expected);
      boss._phase4(2, player);
      assert.equal(arena.ctx.projectiles.at(-1).dmg, expected * 0.6);
    }
  }
});

test('battle keyboard shortcuts cannot act behind the settings dialog', () => {
  let hidden = false;
  const listeners = [];
  const getElement = document.getElementById;
  const addListener = document.addEventListener;
  const calls = [];
  const button = (name) => ({ addEventListener: noop, click: () => calls.push(name) });
  const combatHud = Object.assign(Object.create(BattleHUD.prototype), {
    arena: { paused: true },
    btnPause: button('pause'), btnStep: button('step'), btnSpeed: button('speed'), btnQuit: button('quit'),
  });
  document.getElementById = (id) => ({ classList: { contains: () => id === 'settings-overlay' && hidden } });
  document.addEventListener = (event, handler) => { if (event === 'keydown') listeners.push(handler); };
  globalThis.HTMLInputElement = class {};
  globalThis.HTMLSelectElement = class {};
  globalThis.HTMLTextAreaElement = class {};
  try {
    combatHud._bind();
    const press = (key) => listeners[0]({ key, target: {}, preventDefault: noop });
    for (const key of ['p', '.', 's']) press(key);
    assert.deepEqual(calls, []);
    hidden = true;
    for (const key of ['p', '.', 's']) press(key);
    assert.deepEqual(calls, ['pause', 'step', 'speed']);
  } finally {
    document.getElementById = getElement;
    document.addEventListener = addListener;
    delete globalThis.HTMLInputElement;
    delete globalThis.HTMLSelectElement;
    delete globalThis.HTMLTextAreaElement;
  }
});

test('lethal overheat is attributed and translated in the defeat report', () => {
  const arena = startArena(GameState.getActiveBattle());
  arena.robot.hp = 5;
  arena.ctx.overlogic.active = true;
  arena.robot.tick(1);
  const report = GameState.lastReport;
  assert.equal(report._won, false);
  assert.deepEqual(report.damage_by_source, { overlogic_heat: 5 });
  assert.equal(report.timeline.at(-1).source, 'overlogic_heat');
  for (const [locale, label] of [['en', 'Overlogic heat'], ['zh-CN', 'Overlogic 过热'], ['zh-TW', 'Overlogic 過熱']]) {
    setLocale(locale, { notify: false });
    assert(buildReport(report, []).damage_lines.some((line) => line.includes(label)));
  }
});

test('rule warnings allow negated conditions and lower-priority fallback actions', () => {
  const [shield, dash, attack] = GameState.rules;
  Object.assign(shield, { conditionId: 'enemy_nearby', conditionValue: 8 });
  dash.enabled = false;
  const analyze = () => LogicEditorUI.prototype.analyzeRules.call({});
  assert.equal(analyze().has(attack.id), false);
  Object.assign(shield, { actionId: attack.actionId, negateCondition1: true });
  assert.equal(analyze().has(attack.id), false);
  shield.negateCondition1 = false;
  assert.match(analyze().get(attack.id)[0], /Redundant/);
});

test('cold boot keeps starter thresholds until the content tables are ready', () => {
  const conditions = GameDatabase.conditions;
  try {
    GameDatabase.conditions = new Map();
    GameState.resetRun();
  } finally {
    GameDatabase.conditions = conditions;
  }
  GameState.normalizeAfterDatabaseLoad();
  assert.deepEqual(GameState.rules.map(rule => rule.conditionValue), [0.3, 2.5, 8]);
  GameState.rules[0].conditionValue = null;
  GameState.rules[1].conditionValue = 1;
  GameState.normalizeAfterDatabaseLoad();
  assert.deepEqual(GameState.rules.map(rule => rule.conditionValue), [0.3, 1, 8]);
});

test('shield drill uses real activations at 40% HP and leaves campaign progress intact', () => {
  GameState.configureRun('standard', 'standard', 136);
  GameState.persistentHp = 85;
  const before = structuredClone(GameState.runStats);
  const battle = { ...GameState.getActiveBattle(), id: 'sandbox_calibration',
    enemySpawns: [{ enemyId: 'crawler', count: 2, wave: 1 }] };
  for (const threshold of [0.3, 0.5]) {
    GameState.setRuleConditionValue(GameState.rules[0].id, threshold);
    const arena = startArena(battle);
    assert.equal(arena.robot.hp, 40);
    for (let step = 0; step < 3600 && !arena._finished; step++) arena._update(SIMULATION_STEP_SECONDS);
    assert(arena._finished);
    assert.equal(Boolean(GameState.lastReport.action_usage.shield), threshold === 0.5);
    assert.equal(GameState.persistentHp, 85);
    assert.deepEqual(GameState.runStats, before);
    assert.equal(GameState.hasPendingBattleResolution(), false);
    assert.equal(allBattles().length, 0);
  }
});

test('copied and shared rules retain both negations, disabled state and zero priority', () => {
  const fields = ['conditionId', 'conditionValue', 'actionId', 'priority', 'conditionId2',
    'conditionValue2', 'operator', 'targetPriority', 'negateCondition1', 'negateCondition2', 'enabled'];
  const values = ['hp_low', 0.45, 'shield', 0, 'enemy_nearby', 3, 'or', 'nearest', true, true, false];
  assert(GameState.addRule(...values));
  const code = GameState.exportRulesCode();
  GameState.undo();
  assert.equal(GameState.rules.length, 3);
  GameState.redo();
  assert.deepEqual(fields.map(key => GameState.rules.at(-1)[key]), values);
  GameState.resetRun();
  assert(GameState.importRulesCode(code));
  assert.deepEqual(fields.map(key => GameState.rules.at(-1)[key]), values);
  for (let i = 0; i < 36; i++) assert(GameState.addRule('enemy_nearby', 8, 'basic_attack', 0));
  assert.equal(GameState.addRule(...values), false);
  assert(GameState.normalizeRulePriorities());
  assert.equal(new Set(GameState.rules.map(rule => rule.priority)).size, 40);
});

test('defeat summaries localize the largest damage source and use the equipped build for advice', () => {
  const report = { battle_time: 7.25, damage_by_source: { crawler: 35, overlogic_heat: 5 },
    equipped_actions: ['shield'], action_usage: {}, timeline: [{ kind: 'death', source: 'overlogic_heat' }] };
  const actions = ['shield', 'basic_attack'];
  const build = () => buildReport(report, actions, ['enemy_nearby']);
  for (const [locale, attack, shield] of [['en', 'basic attack', 'Shield'], ['zh-CN', '基础攻击', '护盾'], ['zh-TW', '基礎攻擊', '護盾']]) {
    setLocale(locale, { notify: false });
    const result = build();
    assert.match(result.outcome, /7\.3/);
    assert.match(result.outcome, /35/);
    assert(result.logic_lines[1].includes(shield));
    assert(result.suggestions[0].text.toLowerCase().includes(attack));
    assert.equal(result.suggestions[0].rule.actionId, 'basic_attack');
  }
  for (const snapshot of [undefined, {}, ['basic_attack']]) {
    report.equipped_actions = snapshot;
    assert(!build().suggestions.some(suggestion => suggestion.rule?.actionId === 'basic_attack'));
  }
});

test('moving tied priorities changes execution order without losing slots, including after undo and reload', () => {
  const [first, second, third] = GameState.rules;
  first.priority = second.priority = 100;
  third.priority = 0;
  const order = () => [...GameState.rules].sort((a, b) => b.priority - a.priority).map(rule => rule.id);
  assert.equal(GameState.moveRule(second.id, -1), true);
  assert.deepEqual(order(), [second.id, first.id, third.id]);
  assert.equal(GameState.moveRule(third.id, -2), true);
  assert.deepEqual(order(), [third.id, second.id, first.id]);
  assert.equal(GameState.moveRule(third.id, 0), false);
  GameState.undo();
  assert.deepEqual(order(), [second.id, first.id, third.id]);
  assert(GameState.loadFromStorage());
  assert.deepEqual(order(), [second.id, first.id, third.id]);
  assert.deepEqual(GameState.rules.map(rule => rule.priority), [100, 100, 0]);
});
