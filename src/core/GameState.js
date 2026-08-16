// GameState.js — persistent run state: rules, stats, progress, unlocks.
// Mirrors scripts/core/GameState.gd. Singleton instance exported.

import { GameDatabase } from './GameDatabase.js?v=20260725-4';
import { AudioManager } from '../systems/AudioManager.js?v=20260725-4';
import { allBattles, clearHistory, replaceHistory } from '../systems/RunHistory.js?v=20260725-4';
import { profileSnapshot, replaceProfile, resetProfile } from '../systems/ProfileProgression.js?v=20260725-4';
import { challengeSnapshot, clearChallenges, replaceChallenges } from '../systems/LiveChallenges.js?v=20260725-4';
import { clearRunArchive, recordCompletedRun, replaceRunArchive, runArchiveSnapshot } from '../systems/RunArchive.js?v=20260725-4';
import { recordStorageError, runtimeDiagnosticsSnapshot } from '../systems/RuntimeDiagnostics.js?v=20260725-4';
import { ruleTemplateById } from '../logic/RuleTemplates.js?v=20260725-4';
import { featureEnabled, operationsSnapshot } from '../systems/OperationsConfig.js?v=20260725-4';
import { clearProductMetrics, productMetricsSnapshot, recordProductEvent } from '../systems/ProductTelemetry.js?v=20260725-4';
import { combineReplayDigests, MAX_REPLAY_EVENTS } from '../systems/RunReplay.js?v=20260725-4';
import { markStorageWriteConflict, resetStorageWriteGate, storageWritesAllowed } from '../systems/StorageWriteGate.js?v=20260725-4';
import { CURRENT_SAVE_VERSION, migrateRunSave } from '../systems/SaveMigrations.js?v=20260725-4';

const SAVE_VERSION = CURRENT_SAVE_VERSION;
const RUN_SAVE_KEY = 'overlogic_run_save';
const RUN_BACKUP_KEY = 'overlogic_run_save_backup';
const RUN_TEMP_KEY = 'overlogic_run_save_pending';
const RUN_MODES = new Set(['standard', 'daily', 'weekly']);
const DIFFICULTIES = new Set(['casual', 'standard', 'veteran']);
const LANGUAGES = new Set(['en', 'zh-CN', 'zh-TW']);
const TARGET_PRIORITIES = new Set(['nearest', 'lowest_hp', 'caster', 'support', 'boss']);
const MAX_RULES = 40;
const LOADOUT_SLOTS = 3;
const RUN_CODE_PREFIX = 'OLR1';
const MIN_TEACH_NODE = 1;
const MAX_TEACH_NODE = 4;
const STAT_LIMITS = Object.freeze({
  max_hp: [1, 1_000_000], max_energy: [1, 1_000_000], energy_regen: [0, 1_000_000],
  move_speed: [0.1, 1_000], basic_dmg: [0, 1_000_000], basic_cd: [0.01, 1_000],
  dash_distance: [0.1, 100], dash_cd: [0.01, 1_000], shield_dur: [0, 1_000],
  shield_reduce: [0, 0.99], shield_cd: [0.01, 1_000], interrupt_cd: [0.01, 1_000],
  overdrive_cd: [0.01, 1_000], overdrive_dur: [0, 1_000], reflective_plating: [0, 1],
  nanite_repair: [0, 1_000], superconductors: [0, 1], emergency_recall: [0, 1],
  heavy_impact: [0, 1], thermal_recycle: [0, 1], armor_piercing: [0, 1_000],
});

function validLoadoutSlot(slotIndex) {
  return Number.isInteger(slotIndex) && slotIndex >= 1 && slotIndex <= LOADOUT_SLOTS;
}
const MAP_NODE_IDS = [
  ['0_start'],
  ['1_a', '1_b'],
  ['2_a', '2_b'],
  ['3_a', '3_b'],
  ['4_a', '4_b'],
  ['5_upgrade'],
  ['6_boss', '6_apex'],
  ['7_relay', '7_null'],
  ['8_singularity'],
];

// Base stats from DESIGN.md §7.1 + extended upgrades
function baseStats() {
  return {
    max_hp: 100, max_energy: 100, energy_regen: 8,
    move_speed: 4, basic_dmg: 8, basic_cd: 0.4,
    dash_distance: 3, dash_cd: 3,
    shield_dur: 2, shield_reduce: 0.70, shield_cd: 8,
    interrupt_cd: 5, overdrive_cd: 15, overdrive_dur: 5,
    reflective_plating: 0, nanite_repair: 0, superconductors: 0,
    emergency_recall: 0, heavy_impact: 0, thermal_recycle: 0,
    armor_piercing: 0,
  };
}

function createRunId() {
  return `run_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function isoWeekIdentity(date = new Date()) {
  const input = new Date(date);
  const source = Number.isFinite(input.getTime()) ? input : new Date();
  const thursday = new Date(Date.UTC(source.getUTCFullYear(), source.getUTCMonth(), source.getUTCDate()));
  const weekday = thursday.getUTCDay() || 7;
  thursday.setUTCDate(thursday.getUTCDate() + 4 - weekday);
  const year = thursday.getUTCFullYear();
  const yearStart = new Date(Date.UTC(year, 0, 1));
  const week = Math.ceil((((thursday - yearStart) / 86_400_000) + 1) / 7);
  return {
    year,
    week,
    key: `${year}-W${String(week).padStart(2, '0')}`,
    seed: Number(`${year}${String(week).padStart(2, '0')}`),
  };
}

function defaultRunStats() {
  return {
    runId: createRunId(),
    completionRecorded: false,
    battlesWon: 0,
    totalDamageDealt: 0,
    totalBattleTime: 0,
    rewardsChosen: [],
    replayDigests: [],
  };
}

class GameStateClass {
  constructor() {
    this.currentBattleIndex = 0;
    this.currentMapColumn = 0;
    this.selectedNodeId = '0_start';
    this.mapNodes = [];
    this.onUpgradeNodeTriggered = null;
    this.teachNode = 1;
    this.stats = baseStats();
    this.persistentHp = null;         // HP carry-over between battles (null = full)
    this.unlockedConditionIds = [];   // extra conditions from rewards
    this.unlockedActionIds = [];      // extra actions from rewards
    this.rules = [];
    this._undoStack = [];
    this._redoStack = [];
    this.lastReport = {};
    this.runStats = defaultRunStats();
    this.runConfig = { mode: 'standard', difficulty: 'standard', seed: createRunSeed() };
    this.tutorialProgress = { editedRule: false, sandboxRun: false };
    this._ruleCounter = 0;
    this.settings = {
      volume: 0.8,
      mute: false,
      screenShake: true,
      reduceMotion: window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false,
      highContrast: false,
      productMetrics: false,
      language: 'en',
      runMode: 'standard',
      difficulty: 'standard',
    };
    // simple pub/sub for UI re-render
    this.storageStatus = { available: true, restoredFromBackup: false, conflict: false, lastError: null };
    this._lastPersistedSerialized = null;
    this._listeners = { rules: [], stats: [], progress: [], storage: [] };
    this.loadSettings();
    if (!this.loadFromStorage()) {
      this.resetRun();
    }
  }

  on(evt, fn) { this._listeners[evt].push(fn); }
  _emit(evt) { for (const fn of this._listeners[evt]) fn(); }

  loadSettings() {
    try {
      const raw = localStorage.getItem('overlogic_settings');
      if (raw) {
        const parsed = JSON.parse(raw);
        const volume = Number(parsed.volume);
        this.settings.volume = Number.isFinite(volume) ? Math.max(0, Math.min(1, volume)) : 0.8;
        this.settings.mute = parsed.mute === true;
        this.settings.screenShake = parsed.screenShake !== false;
        this.settings.reduceMotion = typeof parsed.reduceMotion === 'boolean'
          ? parsed.reduceMotion
          : (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false);
        this.settings.highContrast = parsed.highContrast === true;
        this.settings.productMetrics = parsed.productMetrics === true;
        this.settings.language = LANGUAGES.has(parsed.language) ? parsed.language : 'en';
        this.settings.runMode = RUN_MODES.has(parsed.runMode) ? parsed.runMode : 'standard';
        this.settings.difficulty = DIFFICULTIES.has(parsed.difficulty) ? parsed.difficulty : 'standard';
      }
      // Apply to AudioManager
      AudioManager.volumeVal = this.settings.volume;
      AudioManager.muted = this.settings.mute;
    } catch (e) {
      recordStorageError(e, 'settings');
      console.error('Failed to load settings', e);
    }
  }

  saveSettings() {
    if (!storageWritesAllowed()) return false;
    try {
      const volume = Number(this.settings.volume);
      this.settings.volume = Number.isFinite(volume) ? Math.max(0, Math.min(1, volume)) : 0.8;
      this.settings.mute = this.settings.mute === true;
      this.settings.screenShake = this.settings.screenShake !== false;
      this.settings.reduceMotion = this.settings.reduceMotion === true;
      this.settings.highContrast = this.settings.highContrast === true;
      this.settings.productMetrics = this.settings.productMetrics === true;
      if (!LANGUAGES.has(this.settings.language)) this.settings.language = 'en';
      if (!RUN_MODES.has(this.settings.runMode)) this.settings.runMode = 'standard';
      if (!DIFFICULTIES.has(this.settings.difficulty)) this.settings.difficulty = 'standard';
      localStorage.setItem('overlogic_settings', JSON.stringify(this.settings));
      // Apply to AudioManager
      AudioManager.setVolume(this.settings.volume);
      AudioManager.setMute(this.settings.mute);
      return true;
    } catch (e) {
      recordStorageError(e, 'settings');
      console.error('Failed to save settings', e);
      return false;
    }
  }

  resetRun() {
    // A new run must not inherit editing history or rule IDs from a previous
    // run. Keeping either would let Ctrl+Z resurrect another run's build and
    // would make fresh share codes/debug logs needlessly non-deterministic.
    this._undoStack = [];
    this._redoStack = [];
    this._ruleCounter = 0;
    this.currentBattleIndex = 0;
    this.currentMapColumn = 0;
    this.selectedNodeId = '0_start';
    this._initMap();
    this.teachNode = 1;
    this.stats = baseStats();
    this.persistentHp = null;
    this.unlockedConditionIds = [];
    this.unlockedActionIds = [];
    this.lastReport = {};
    this.runStats = defaultRunStats();
    this.runConfig = {
      mode: RUN_MODES.has(this.settings.runMode) ? this.settings.runMode : 'standard',
      difficulty: DIFFICULTIES.has(this.settings.difficulty) ? this.settings.difficulty : 'standard',
      seed: this.periodSeed(this.settings.runMode) || createRunSeed(),
    };
    this.tutorialProgress = { editedRule: false, sandboxRun: false };
    this._initDefaultRules();
    this.saveToStorage();
    this._emit('rules'); this._emit('stats'); this._emit('progress');
  }

  _newRule(condId, condVal, actId, prio, condId2 = null, condVal2 = null, operator = null, targetPriority = 'nearest', negateCondition1 = false, negateCondition2 = false) {
    return {
      id: this._nextRuleId(),
      conditionId: condId,
      conditionValue: this._normalizeConditionValue(condId, condVal),
      conditionId2: condId2,
      conditionValue2: condId2 ? this._normalizeConditionValue(condId2, condVal2) : null,
      operator: operator,
      actionId: actId,
      priority: prio,
      targetPriority: TARGET_PRIORITIES.has(targetPriority) ? targetPriority : 'nearest',
      negateCondition1: negateCondition1 === true,
      negateCondition2: negateCondition2 === true,
      enabled: true,
    };
  }

  _nextRuleId() {
    this._ruleCounter += 1;
    return `rule_${this._ruleCounter}`;
  }

  _initDefaultRules() {
    this.rules = [];
    // DESIGN.md §5.3 default rules
    this.rules.push(this._newRule('hp_low', 0.30, 'shield', 100));
    this.rules.push(this._newRule('enemy_nearby', 2.5, 'dash_away', 70));
    this.rules.push(this._newRule('enemy_nearby', 8.0, 'basic_attack', 10));
    this._advanceTeachRulesTo(1);
  }

  _hasRule(condId, actId) {
    return this.rules.some(r => r.conditionId === condId && r.actionId === actId);
  }

  _advanceTeachRulesTo(node) {
    if (node >= 2 && !this._hasRule('projectile_nearby', 'sidestep'))
      this.rules.push(this._newRule('projectile_nearby', 2.4, 'sidestep', 80));
    if (node >= 2 && !this._hasRule('enemy_far', 'dash_toward'))
      this.rules.push(this._newRule('enemy_far', 5.0, 'dash_toward', 50));
    if (node >= 3 && !this._hasRule('enemy_casting', 'interrupt_shot'))
      this.rules.push(this._newRule('enemy_casting', null, 'interrupt_shot', 90));
    if (node >= 4 && !this._hasRule('energy_high', 'overdrive'))
      this.rules.push(this._newRule('energy_high', 0.80, 'overdrive', 60));
    this.saveToStorage();
    this._emit('rules');
  }

  advanceTeachNode() {
    if (this.teachNode < 4) {
      this.teachNode += 1;
      this._advanceTeachRulesTo(this.teachNode);
      this._emit('progress');
    }
  }

  // Called when a battle is won. reward_id may be '' for final boss skip.
  // persistentHp: carry the robot's ending HP into the next battle (no full heal).
  onBattleWon(rewardId, endHp = null) {
    // A victory report is persisted before the reward screen opens. If the
    // page is refreshed, the same report can be resumed exactly once instead
    // of replaying the battle or incrementing progression twice.
    if (this.lastReport?._resolutionApplied === true) return false;
    this.runStats.battlesWon += 1;
    this.runStats.totalDamageDealt += Number(this.lastReport?.total_damage_dealt) || 0;
    this.runStats.totalBattleTime += Number(this.lastReport?.battle_time) || 0;
    if (this.lastReport?._replayDigest) {
      this.runStats.replayDigests = [...(this.runStats.replayDigests || []), this.lastReport._replayDigest].slice(-12);
    }
    if (rewardId) this.runStats.rewardsChosen.push(rewardId);

    // Persist HP before applying rewards so Max HP upgrades can also grant
    // the newly-installed hull capacity as usable HP for the next battle.
    if (endHp !== null && typeof endHp === 'number' && endHp > 0) {
      this.persistentHp = Math.min(endHp, this.stats.max_hp);
    } else {
      this.persistentHp = null; // full heal fallback
    }

    if (rewardId !== '') {
      const reward = GameDatabase.getReward(rewardId);
      if (reward) this._applyReward(reward);
      else console.error('GameState: unknown reward', rewardId);
    }

    const colNodes = this.mapNodes[this.currentMapColumn];
    if (colNodes) {
      const node = colNodes.find(n => n.id === this.selectedNodeId);
      if (node) {
        node.completed = true;
        if (node.type === 'combat') {
          this.currentBattleIndex = node.battleIndex;
        }
      }
    }

    const battle = GameDatabase.getBattle(this.currentBattleIndex);
    const tua = battle && battle.teachUnlockAfter;
    if (typeof tua === 'number') {
      this.teachNode = Math.max(1, Math.min(4, tua));
      this._advanceTeachRulesTo(this.teachNode);
    }

    this.currentMapColumn += 1;
    if (this.currentMapColumn < this.mapNodes.length) {
      const nextCol = this.mapNodes[this.currentMapColumn];
      this.selectedNodeId = nextCol[0].id;
    }

    this.lastReport = { ...this.lastReport, _resolutionApplied: true };

    this.saveToStorage();
    this._emit('progress');
    return true;
  }

  recordRunCompletion() {
    if (!this.isDemoCleared() || this.runStats?.completionRecorded === true) return null;
    const result = recordCompletedRun({
      id: this.runStats.runId,
      mode: this.runConfig?.mode,
      difficulty: this.runConfig?.difficulty,
      seed: this.runConfig?.seed,
      battlesWon: this.runStats.battlesWon,
      totalDamageDealt: this.runStats.totalDamageDealt,
      totalBattleTime: this.runStats.totalBattleTime,
      finalHp: Number(this.lastReport?._endHp) || 0,
      rulesCount: this.rules.length,
      upgrades: Array.isArray(this.runStats.rewardsChosen) ? this.runStats.rewardsChosen.length : 0,
      simulationVersion: this.lastReport?._simulationVersion,
      simulationStep: this.lastReport?._simulationStep,
      replayDigest: combineReplayDigests(this.runStats.replayDigests),
    });
    if (result.persisted) {
      this.runStats.completionRecorded = true;
      this.saveToStorage();
      recordProductEvent('run_completed', {
        mode: this.runConfig?.mode || 'standard',
        difficulty: this.runConfig?.difficulty || 'standard',
      });
    }
    return result;
  }

  // Called when an upgrade node reward is chosen.
  onUpgradeNodeChosen(rewardId) {
    if (rewardId !== '') {
      const reward = GameDatabase.getReward(rewardId);
      if (reward) this._applyReward(reward);
      else console.error('GameState: unknown reward', rewardId);
      this.runStats.rewardsChosen.push(rewardId);
    }
    this.saveToStorage();
    this._emit('progress');
  }

  _applyReward(reward) {
    switch (reward.rewardType) {
      case 'passive': this._applyPassive(reward.targetId, reward.value); break;
      case 'new_action':
        if (!this.unlockedActionIds.includes(reward.targetId))
          this.unlockedActionIds.push(reward.targetId);
        break;
      case 'new_condition':
        if (!this.unlockedConditionIds.includes(reward.targetId))
          this.unlockedConditionIds.push(reward.targetId);
        break;
    }
    this._emit('stats'); this._emit('rules');
  }

  _applyPassive(target, value) {
    switch (target) {
      case 'max_hp':
        this.stats.max_hp += value;
        if (this.persistentHp !== null) {
          this.persistentHp = Math.min(this.stats.max_hp, this.persistentHp + value);
        }
        break;
      case 'max_energy':    this.stats.max_energy += value; break;
      case 'move_speed':    this.stats.move_speed += value; break;
      case 'energy_regen':  this.stats.energy_regen *= value; break;
      case 'basic_dmg':     this.stats.basic_dmg *= value; break;
      case 'dash_cd':       this.stats.dash_cd *= value; break;
      case 'shield_cd':     this.stats.shield_cd *= value; break;
      case 'shield_dur':    this.stats.shield_dur += value; break;
      case 'overdrive_dur': this.stats.overdrive_dur += value; break;
      case 'interrupt_cd':  this.stats.interrupt_cd *= value; break;
      case 'reflective_plating': this.stats.reflective_plating += value; break;
      case 'nanite_repair':      this.stats.nanite_repair += value; break;
      case 'superconductors':    this.stats.superconductors += value; break;
      case 'emergency_recall':   this.stats.emergency_recall += value; break;
      case 'heavy_impact':       this.stats.heavy_impact += value; break;
      case 'thermal_recycle':    this.stats.thermal_recycle += value; break;
      case 'armor_piercing':     this.stats.armor_piercing += value; break;
      default: console.warn('GameState: unknown passive target', target);
    }
  }

  // ---- Rule editing API (used by LogicEditorUI) ----
  _pushState() {
    this._undoStack = this._undoStack || [];
    this._redoStack = this._redoStack || [];
    if (this._undoStack.length >= 50) this._undoStack.shift();
    this._undoStack.push(JSON.stringify(this.rules));
    this._redoStack = [];
    if (!this.tutorialProgress?.editedRule) {
      this.tutorialProgress = { ...this.tutorialProgress, editedRule: true };
      this._emit('progress');
    }
  }

  _normalizeConditionValue(conditionId, value) {
    const condition = GameDatabase.getCondition(conditionId);
    if (!condition || condition.parameterType === 'none') return null;
    if (condition.parameterType === 'vec2') {
      const fallback = Array.isArray(condition.defaultValue) ? condition.defaultValue : [1, 1];
      const incoming = Array.isArray(value) ? value : fallback;
      return incoming.slice(0, 2).map((part, index) => {
        const numeric = Number(part);
        const safe = Number.isFinite(numeric) ? numeric : Number(fallback[index]) || 0;
        const min = Number(condition.minValue?.[index]);
        const max = Number(condition.maxValue?.[index]);
        const clamped = Math.max(Number.isFinite(min) ? min : -Infinity, Math.min(Number.isFinite(max) ? max : Infinity, safe));
        return index === 1 ? Math.round(clamped) : clamped;
      });
    }
    const numeric = Number(value);
    const fallback = Number(condition.defaultValue);
    const safe = Number.isFinite(numeric) ? numeric : (Number.isFinite(fallback) ? fallback : 0);
    const min = Number(condition.minValue);
    const max = Number(condition.maxValue);
    const clamped = Math.max(Number.isFinite(min) ? min : -Infinity, Math.min(Number.isFinite(max) ? max : Infinity, safe));
    return condition.parameterType === 'int' ? Math.round(clamped) : clamped;
  }

  markSandboxRun() {
    if (this.tutorialProgress?.sandboxRun) return;
    this.tutorialProgress = { ...this.tutorialProgress, sandboxRun: true };
    this.saveToStorage();
    this._emit('progress');
  }

  dailySeed(date = new Date()) {
    const year = date.getUTCFullYear();
    const month = String(date.getUTCMonth() + 1).padStart(2, '0');
    const day = String(date.getUTCDate()).padStart(2, '0');
    return Number(`${year}${month}${day}`);
  }

  dailyIdentityFromSeed(seed) {
    const numeric = Number(seed);
    const text = String(Math.floor(numeric));
    if (!Number.isSafeInteger(numeric) || !/^\d{8}$/.test(text)) return null;
    const year = Number(text.slice(0, 4));
    const month = Number(text.slice(4, 6));
    const day = Number(text.slice(6, 8));
    const parsed = new Date(Date.UTC(year, month - 1, day));
    if (parsed.getUTCFullYear() !== year || parsed.getUTCMonth() !== month - 1 || parsed.getUTCDate() !== day) return null;
    return { year, month, day, key: `${text.slice(0, 4)}-${text.slice(4, 6)}-${text.slice(6, 8)}`, seed: numeric };
  }

  weeklyIdentity(date = new Date()) {
    return { ...isoWeekIdentity(date) };
  }

  weeklyIdentityFromSeed(seed) {
    const numeric = Number(seed);
    const text = String(Math.floor(numeric));
    if (!Number.isSafeInteger(numeric) || !/^\d{6}$/.test(text)) return null;
    const year = Number(text.slice(0, 4));
    const week = Number(text.slice(4));
    const lastIsoWeek = isoWeekIdentity(new Date(Date.UTC(year, 11, 28))).week;
    if (year < 1970 || week < 1 || week > lastIsoWeek) return null;
    return { year, week, key: `${year}-W${String(week).padStart(2, '0')}`, seed: numeric };
  }

  weeklySeed(date = new Date()) {
    return isoWeekIdentity(date).seed;
  }

  periodSeed(mode, date = new Date()) {
    if (mode === 'daily') return this.dailySeed(date);
    if (mode === 'weekly') return this.weeklySeed(date);
    return null;
  }

  hasRunProgress() {
    return this.currentMapColumn > 0 || this.runStats.battlesWon > 0;
  }

  hasPendingBattleResolution() {
    if (this.lastReport?._won !== true || this.lastReport?._resolutionApplied === true) return false;
    const activeBattle = this.getActiveBattle();
    return Boolean(activeBattle && this.lastReport?._battleId === activeBattle.id);
  }

  isPendingFinalBattle() {
    return this.hasPendingBattleResolution() && this.currentMapColumn >= this.mapNodes.length - 1;
  }

  canConfigureRun() {
    return !this.hasRunProgress() && !this.isDemoCleared();
  }

  configureRun(mode, difficulty, requestedSeed = null) {
    const previousMode = this.runConfig?.mode;
    const requestedMode = RUN_MODES.has(mode) ? mode : 'standard';
    const allowedMode = (requestedMode === 'daily' && !featureEnabled('dailyChallenges')) ||
      (requestedMode === 'weekly' && !featureEnabled('weeklyGauntlet'))
      ? 'standard' : requestedMode;
    this.settings.runMode = allowedMode;
    this.settings.difficulty = DIFFICULTIES.has(difficulty) ? difficulty : 'standard';
    const parsedSeed = normalizeRunSeed(requestedSeed);
    this.saveSettings();
    if (this.currentMapColumn === 0 && this.runStats.battlesWon === 0) {
      this.runConfig = {
        mode: this.settings.runMode,
        difficulty: this.settings.difficulty,
        seed: this.periodSeed(this.settings.runMode)
          ? (parsedSeed || this.periodSeed(this.settings.runMode))
          : (parsedSeed || (previousMode === 'standard' && Number.isSafeInteger(Number(this.runConfig?.seed))
              ? Number(this.runConfig.seed)
              : createRunSeed())),
      };
      this.saveToStorage();
      this._emit('progress');
    }
  }

  randomFor(salt = '') {
    const seed = Number(this.runConfig?.seed) || this.periodSeed(this.runConfig?.mode) || this.dailySeed();
    let state = hashString(`${seed}:${salt}`) || 0x6d2b79f5;
    return () => {
      state |= 0;
      state = state + 0x6d2b79f5 | 0;
      let out = Math.imul(state ^ state >>> 15, 1 | state);
      out = out + Math.imul(out ^ out >>> 7, 61 | out) ^ out;
      return ((out ^ out >>> 14) >>> 0) / 4294967296;
    };
  }

  exportRunCode() {
    const mode = RUN_MODES.has(this.runConfig?.mode) ? this.runConfig.mode : 'standard';
    const difficulty = DIFFICULTIES.has(this.runConfig?.difficulty) ? this.runConfig.difficulty : 'standard';
    const seed = normalizeRunSeed(this.runConfig?.seed) || this.periodSeed(mode) || createRunSeed();
    return `${RUN_CODE_PREFIX}-${mode.toUpperCase()}-${difficulty.toUpperCase()}-${seed.toString(36).toUpperCase()}`;
  }

  parseRunCode(code) {
    const parts = String(code || '').trim().toUpperCase().split('-');
    if (parts.length !== 4 || parts[0] !== RUN_CODE_PREFIX) return null;
    const mode = parts[1].toLowerCase();
    const difficulty = parts[2].toLowerCase();
    if (!RUN_MODES.has(mode) || !DIFFICULTIES.has(difficulty)) return null;
    if (!/^[0-9A-Z]+$/.test(parts[3])) return null;
    const seed = Number.parseInt(parts[3], 36);
    if (!Number.isSafeInteger(seed) || seed <= 0 || seed > 0xffffffff) return null;
    return { mode, difficulty, seed };
  }
  pushUndoState() {
    this._pushState();
  }
  undo() {
    this._undoStack = this._undoStack || [];
    this._redoStack = this._redoStack || [];
    if (this._undoStack.length === 0) return false;
    this._redoStack.push(JSON.stringify(this.rules));
    const raw = this._undoStack.pop();
    this.rules = JSON.parse(raw);
    this.saveToStorage();
    this._emit('rules');
    return true;
  }
  redo() {
    this._undoStack = this._undoStack || [];
    this._redoStack = this._redoStack || [];
    if (this._redoStack.length === 0) return false;
    this._undoStack.push(JSON.stringify(this.rules));
    const raw = this._redoStack.pop();
    this.rules = JSON.parse(raw);
    this.saveToStorage();
    this._emit('rules');
    return true;
  }

  addRule(condId, condVal, actId, prio, condId2 = null, condVal2 = null, operator = null, targetPriority = 'nearest') {
    if (this.rules.length >= MAX_RULES) return false;
    if (!this.availableConditionIds().includes(condId) || !this.availableActionIds().includes(actId)) return false;
    if ((operator === 'and' || operator === 'or') && !this.availableConditionIds().includes(condId2)) return false;
    this._pushState();
    this.rules.push(this._newRule(condId, condVal, actId, prio, condId2, condVal2, operator, targetPriority));
    this.saveToStorage();
    this._emit('rules');
    return true;
  }
  applyRuleTemplate(templateId) {
    if (!featureEnabled('ruleTemplates')) return { added: 0, skipped: 0, locked: 0, unavailable: true };
    const template = ruleTemplateById(templateId);
    if (!template) return { added: 0, skipped: 0, locked: 0 };
    const availableConditions = new Set(this.availableConditionIds());
    const availableActions = new Set(this.availableActionIds());
    const candidates = template.rules.filter((rule) => {
      const valid = availableConditions.has(rule.conditionId) && availableActions.has(rule.actionId);
      if (!valid) return false;
      return !this.rules.some((existing) => existing.conditionId === rule.conditionId &&
        existing.actionId === rule.actionId &&
        existing.operator === (rule.operator || null) &&
        existing.targetPriority === (rule.targetPriority || 'nearest') &&
        JSON.stringify(existing.conditionValue) === JSON.stringify(rule.conditionValue));
    });
    const locked = template.rules.length - template.rules.filter((rule) =>
      availableConditions.has(rule.conditionId) && availableActions.has(rule.actionId)).length;
    const capacity = Math.max(0, MAX_RULES - this.rules.length);
    const additions = candidates.slice(0, capacity);
    if (additions.length === 0) {
      return { added: 0, skipped: candidates.length, locked };
    }
    this._pushState();
    this.rules.push(...additions.map((rule) => this._newRule(
      rule.conditionId,
      rule.conditionValue,
      rule.actionId,
      rule.priority,
      rule.conditionId2 || null,
      rule.conditionValue2 ?? null,
      rule.operator || null,
      rule.targetPriority || 'nearest',
      rule.negateCondition1 === true,
      rule.negateCondition2 === true,
    )));
    this.saveToStorage();
    this._emit('rules');
    return { added: additions.length, skipped: candidates.length - additions.length, locked };
  }
  setRuleTargetPriority(ruleId, priority) {
    const r = this.rules.find(r => r.id === ruleId);
    const normalized = TARGET_PRIORITIES.has(priority) ? priority : 'nearest';
    if (r && r.targetPriority !== normalized) {
      this._pushState();
      r.targetPriority = normalized;
      this.saveToStorage();
      this._emit('rules');
      return true;
    }
    return false;
  }
  removeRule(ruleId) {
    if (!this.rules.some(rule => rule.id === ruleId)) return false;
    this._pushState();
    this.rules = this.rules.filter(r => r.id !== ruleId);
    this.saveToStorage();
    this._emit('rules');
    return true;
  }
  setRulePriority(ruleId, prio) {
    const r = this.rules.find(r => r.id === ruleId);
    if (r && r.priority !== (prio|0)) {
      this._pushState();
      r.priority = Math.max(0, Math.min(100, prio|0));
      this.saveToStorage();
      this._emit('rules');
    }
  }
  setRuleConditionValue(ruleId, value) {
    const r = this.rules.find(r => r.id === ruleId);
    const normalized = r ? this._normalizeConditionValue(r.conditionId, value) : value;
    if (r && JSON.stringify(r.conditionValue) !== JSON.stringify(normalized)) {
      this._pushState();
      r.conditionValue = normalized;
      this.saveToStorage();
      this._emit('rules');
    }
  }
  setRuleConditionValue2(ruleId, value) {
    const r = this.rules.find(r => r.id === ruleId);
    const normalized = r && r.conditionId2
      ? this._normalizeConditionValue(r.conditionId2, value)
      : value;
    if (r && JSON.stringify(r.conditionValue2) !== JSON.stringify(normalized)) {
      this._pushState();
      r.conditionValue2 = normalized;
      this.saveToStorage();
      this._emit('rules');
    }
  }
  setRuleAction(ruleId, actId) {
    const r = this.rules.find(r => r.id === ruleId);
    if (r && r.actionId !== actId) {
      this._pushState();
      r.actionId = actId;
      this.saveToStorage();
      this._emit('rules');
    }
  }
  setRuleCondition(ruleId, condId) {
    const r = this.rules.find(r => r.id === ruleId);
    if (r && r.conditionId !== condId) {
      this._pushState();
      r.conditionId = condId;
      const cd = GameDatabase.getCondition(condId);
      r.conditionValue = cd ? this._normalizeConditionValue(condId, cd.defaultValue) : null;
      this.saveToStorage();
      this._emit('rules');
    }
  }
  setRuleCondition2(ruleId, condId2) {
    const r = this.rules.find(r => r.id === ruleId);
    if (r && r.conditionId2 !== condId2) {
      this._pushState();
      r.conditionId2 = condId2;
      const cd = GameDatabase.getCondition(condId2);
      r.conditionValue2 = cd ? this._normalizeConditionValue(condId2, cd.defaultValue) : null;
      this.saveToStorage();
      this._emit('rules');
    }
  }
  setRuleOperator(ruleId, op) {
    const r = this.rules.find(r => r.id === ruleId);
    const normalizedOp = op === 'and' || op === 'or' ? op : null;
    if (r && r.operator !== normalizedOp) {
      this._pushState();
      r.operator = normalizedOp;
      if (!normalizedOp) {
        r.conditionId2 = null;
        r.conditionValue2 = null;
      } else if (!r.conditionId2) {
        const avail = this.availableConditionIds();
        r.conditionId2 = avail[0] || 'hp_low';
        const cd = GameDatabase.getCondition(r.conditionId2);
        r.conditionValue2 = cd ? this._normalizeConditionValue(r.conditionId2, cd.defaultValue) : null;
      }
      this.saveToStorage();
      this._emit('rules');
    }
  }
  setRuleEnabled(ruleId, en) {
    const r = this.rules.find(r => r.id === ruleId);
    if (r && r.enabled !== en) {
      this._pushState();
      r.enabled = en;
      this.saveToStorage();
      this._emit('rules');
    }
  }

  toggleRuleNegation(ruleId, secondary = false) {
    const rule = this.rules.find(item => item.id === ruleId);
    if (!rule) return false;
    this._pushState();
    const key = secondary ? 'negateCondition2' : 'negateCondition1';
    rule[key] = !rule[key];
    this.saveToStorage();
    this._emit('rules');
    return true;
  }

  moveRule(ruleId, direction) {
    const ordered = [...this.rules].sort((a, b) => b.priority - a.priority);
    const index = ordered.findIndex(rule => rule.id === ruleId);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= ordered.length) return false;
    this._pushState();
    const currentPriority = ordered[index].priority;
    ordered[index].priority = ordered[target].priority;
    ordered[target].priority = currentPriority;
    if (ordered[index].priority === ordered[target].priority) {
      ordered[index].priority = Math.max(0, Math.min(100, ordered[index].priority - direction));
    }
    this.saveToStorage();
    this._emit('rules');
    return true;
  }

  exportRulesCode() {
    const json = JSON.stringify({ version: 1, rules: this.rules });
    const bytes = new TextEncoder().encode(json);
    let binary = '';
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return `OL1-${btoa(binary)}`;
  }

  importRulesCode(code) {
    try {
      const raw = String(code || '').trim();
      if (raw.length > 65536) return false;
      if (!raw.startsWith('OL1-')) return false;
      const binary = atob(raw.slice(4));
      const bytes = Uint8Array.from(binary, char => char.charCodeAt(0));
      const data = JSON.parse(new TextDecoder().decode(bytes));
      if (!Array.isArray(data.rules)) return false;
      const validConditions = new Set(this.availableConditionIds());
      const validActions = new Set(this.availableActionIds());
      const imported = data.rules.filter(rule => {
        const operator = rule.operator === 'and' || rule.operator === 'or' ? rule.operator : null;
        return validConditions.has(rule.conditionId) &&
          validActions.has(rule.actionId) &&
          (!operator || validConditions.has(rule.conditionId2));
      }).slice(0, 40).map(rule => {
        const operator = rule.operator === 'and' || rule.operator === 'or' ? rule.operator : null;
        const target = TARGET_PRIORITIES.has(rule.targetPriority)
          ? rule.targetPriority
          : 'nearest';
        return this._newRule(
          rule.conditionId,
          rule.conditionValue,
          rule.actionId,
          Math.max(0, Math.min(100, rule.priority | 0)),
          operator ? rule.conditionId2 : null,
          operator ? rule.conditionValue2 : null,
          operator,
          target,
          rule.negateCondition1,
          rule.negateCondition2,
        );
      });
      if (imported.length === 0) return false;
      this._pushState();
      this.rules = imported;
      this.saveToStorage();
      this._emit('rules');
      return true;
    } catch {
      return false;
    }
  }

  normalizeRulePriorities() {
    const ordered = [...this.rules].sort((a, b) => b.priority - a.priority);
    const next = ordered.map((rule, index) => Math.max(0, 100 - index * 10));
    if (ordered.every((rule, index) => rule.priority === next[index])) return false;
    this._pushState();
    ordered.forEach((rule, index) => { rule.priority = next[index]; });
    this.saveToStorage();
    this._emit('rules');
    return true;
  }

  _initMap() {
    this.mapNodes = [
      // Col 0
      [ { id: '0_start', type: 'combat', battleIndex: 0, label: 'Calibration', completed: false } ],
      // Col 1 — branch A: ranged, B: chargers
      [
        { id: '1_a', type: 'combat', battleIndex: 1, label: 'Distance Test', completed: false },
        { id: '1_b', type: 'combat', battleIndex: 2, label: 'Charge Warning', completed: false }
      ],
      // Col 2 — branch A: swarm, B: EMP drones
      [
        { id: '2_a', type: 'combat', battleIndex: 3, label: 'Swarm', completed: false },
        { id: '2_b', type: 'combat', battleIndex: 4, label: 'Shadow Grid', completed: false }
      ],
      // Col 3 — branch A: Iron Tide (elite chargers), B: Nano-Repair
      [
        { id: '3_a', type: 'combat', battleIndex: 5, label: 'Iron Tide', completed: false },
        { id: '3_b', type: 'repair', label: 'Nano-Repair (+25 Max HP)', completed: false }
      ],
      // Col 4 — branch A: mixed, B: Crucible (all enemies)
      [
        { id: '4_a', type: 'combat', battleIndex: 6, label: 'Mixed Protocol', completed: false },
        { id: '4_b', type: 'combat', battleIndex: 7, label: 'Crucible', completed: false }
      ],
      // Col 5 — Upgrade Vault
      [ { id: '5_upgrade', type: 'upgrade', label: 'Upgrade Vault (Pick Passive)', completed: false } ],
      // Col 6 — Final Boss choice: Warden or Apex Warden
      [
        { id: '6_boss', type: 'combat', battleIndex: 8, label: 'Protocol Warden', completed: false },
        { id: '6_apex', type: 'combat', battleIndex: 9, label: 'Apex Warden ★', completed: false }
      ],
      // Col 7 — Ascension branch after the first boss gate
      [
        { id: '7_relay', type: 'combat', battleIndex: 10, label: 'Relay Cataclysm', completed: false },
        { id: '7_null', type: 'combat', battleIndex: 11, label: 'Null Cathedral', completed: false }
      ],
      // Col 8 — Final Singularity Core
      [ { id: '8_singularity', type: 'combat', battleIndex: 12, label: 'Singularity Core', completed: false } ],
    ];
  }

  getActiveBattle() {
    if (this.currentMapColumn >= this.mapNodes.length) return null;
    const colNodes = this.mapNodes[this.currentMapColumn];
    if (!colNodes) return null;
    const node = colNodes.find(n => n.id === this.selectedNodeId);
    if (node && node.type === 'combat') {
      return GameDatabase.getBattle(node.battleIndex);
    }
    return GameDatabase.getBattle(this.currentBattleIndex);
  }

  selectMapNode(nodeId) {
    const nextCol = this.mapNodes[this.currentMapColumn];
    if (!nextCol) return;
    const node = nextCol.find(n => n.id === nodeId);
    if (!node) return;

    this.selectedNodeId = nodeId;

    if (node.type === 'repair') {
      node.completed = true;
      this.stats.max_hp += 25;
      this.persistentHp = this.stats.max_hp;
      this.currentMapColumn += 1;
      const nCol = this.mapNodes[this.currentMapColumn];
      this.selectedNodeId = nCol ? nCol[0].id : null;
      this._emit('stats');
      AudioManager.play('shield_on');
    } else if (node.type === 'upgrade') {
      node.completed = true;
      this.currentMapColumn += 1;
      const nCol = this.mapNodes[this.currentMapColumn];
      this.selectedNodeId = nCol ? nCol[0].id : null;
      this.saveToStorage();
      this._emit('progress');
      if (this.onUpgradeNodeTriggered) {
        this.onUpgradeNodeTriggered();
      }
    }

    this.saveToStorage();
    this._emit('progress');
  }

  _runSaveData() {
    return {
      currentBattleIndex: this.currentBattleIndex,
      currentMapColumn: this.currentMapColumn,
      selectedNodeId: this.selectedNodeId,
      mapNodes: this.mapNodes,
      teachNode: this.teachNode,
      stats: this.stats,
      persistentHp: this.persistentHp,
      unlockedConditionIds: this.unlockedConditionIds,
      unlockedActionIds: this.unlockedActionIds,
      rules: this.rules,
      lastReport: this.lastReport,
      runStats: this.runStats,
      runConfig: this.runConfig,
      tutorialProgress: this.tutorialProgress,
      _ruleCounter: this._ruleCounter,
      saveVersion: SAVE_VERSION,
    };
  }

  _setStorageStatus(patch) {
    this.storageStatus = { ...this.storageStatus, ...patch };
    this._emit('storage');
  }

  markStorageConflict() {
    markStorageWriteConflict();
    this._setStorageStatus({ conflict: true, available: true, lastError: 'Another tab changed persistent data' });
  }

  saveToStorage() {
    if (!storageWritesAllowed()) return false;
    try {
      const serialized = serializeRunSave(this._runSaveData());
      const current = localStorage.getItem(RUN_SAVE_KEY);
      if (current !== this._lastPersistedSerialized) {
        this.markStorageConflict();
        return false;
      }
      const previous = localStorage.getItem(RUN_SAVE_KEY);

      // Stage and verify the complete payload before replacing the primary
      // slot. The previous valid primary becomes a one-step recovery point.
      localStorage.setItem(RUN_TEMP_KEY, serialized);
      if (localStorage.getItem(RUN_TEMP_KEY) !== serialized) {
        throw new Error('Staged save verification failed');
      }
      if (previous && previous !== serialized && parseRunSave(previous)) {
        localStorage.setItem(RUN_BACKUP_KEY, previous);
      }
      localStorage.setItem(RUN_SAVE_KEY, serialized);
      // A second tab can still win the tiny interval between the initial
      // compare and this replacement. Verify the committed value as a final
      // best-effort race detector before advancing our in-memory marker.
      if (localStorage.getItem(RUN_SAVE_KEY) !== serialized) {
        this.markStorageConflict();
        return false;
      }
      localStorage.removeItem(RUN_TEMP_KEY);
      this._lastPersistedSerialized = serialized;
      this._setStorageStatus({ available: true, conflict: false, lastError: null });
      return true;
    } catch (e) {
      recordStorageError(e, 'run-save');
      try { localStorage.removeItem(RUN_TEMP_KEY); } catch {}
      this._setStorageStatus({ available: false, lastError: String(e?.message || e) });
      console.error('Failed to save to localStorage', e);
      return false;
    }
  }

  loadFromStorage() {
    let primaryError = null;
    try {
      const primaryRaw = localStorage.getItem(RUN_SAVE_KEY);
      const backupRaw = localStorage.getItem(RUN_BACKUP_KEY);
      let data = null;
      let restoredFromBackup = false;
      if (primaryRaw) {
        try { data = parseRunSave(primaryRaw); } catch (error) { primaryError = error; }
      }
      if (!data && backupRaw) {
        data = parseRunSave(backupRaw);
        restoredFromBackup = true;
        localStorage.setItem(RUN_SAVE_KEY, backupRaw);
      }
      if (!data) {
        if (primaryError) throw primaryError;
        this._lastPersistedSerialized = null;
        resetStorageWriteGate();
        this._setStorageStatus({ conflict: false });
        return false;
      }
      const migration = migrateRunSave(data);
      if (migration.unsupported) throw new Error(`Unsupported run save version ${migration.fromVersion}`);
      data = migration.data;
      this.currentBattleIndex = data.currentBattleIndex ?? 0;
      this.currentMapColumn = data.currentMapColumn ?? 0;
      this.selectedNodeId = data.selectedNodeId ?? '0_start';
      this.mapNodes = data.mapNodes;
      if (!this.mapNodes || this.mapNodes.length === 0) {
        this._initMap();
      }
      this.teachNode = data.teachNode ?? 1;
      this.stats = data.stats ?? baseStats();
      this.persistentHp = data.persistentHp ?? null;
      this.unlockedConditionIds = data.unlockedConditionIds ?? [];
      this.unlockedActionIds = data.unlockedActionIds ?? [];
      this.rules = data.rules ?? [];
      this.lastReport = data.lastReport && typeof data.lastReport === 'object' ? data.lastReport : {};
      this.runStats = data.runStats ?? defaultRunStats();
      this.runConfig = data.runConfig ?? {
        mode: this.settings.runMode,
        difficulty: this.settings.difficulty,
        seed: this.periodSeed(this.settings.runMode) || createRunSeed(),
      };
      this.tutorialProgress = data.tutorialProgress ?? { editedRule: false, sandboxRun: false };
      this._ruleCounter = data._ruleCounter ?? 0;
      this.saveVersion = data.saveVersion ?? 1;
      this._setStorageStatus({
        available: true,
        conflict: false,
        restoredFromBackup,
        lastError: restoredFromBackup ? String(primaryError?.message || 'Primary save was invalid') : null,
      });
      this._lastPersistedSerialized = restoredFromBackup ? backupRaw : primaryRaw;
      resetStorageWriteGate();
      return true;
    } catch (e) {
      recordStorageError(e, 'run-load');
      this._setStorageStatus({ available: true, restoredFromBackup: false, lastError: String(e?.message || e) });
      console.error('Failed to load from localStorage', e);
      return false;
    }
  }

  clearStorage() {
    if (!storageWritesAllowed()) return false;
    let cleared = true;
    const keys = [RUN_SAVE_KEY, RUN_BACKUP_KEY, RUN_TEMP_KEY];
    for (let slot = 1; slot <= LOADOUT_SLOTS; slot += 1) keys.push(`overlogic_loadout_slot_${slot}`);
    for (const key of keys) {
      try {
        localStorage.removeItem(key);
      } catch (error) {
        cleared = false;
        recordStorageError(error, `reset:${key}`);
      }
    }
    // A partial reset may still have removed the primary slot. Rebase the
    // compare-and-swap marker before resetRun() so a retry can repair the
    // local stores instead of being mistaken for a stale-tab overwrite.
    try { this._lastPersistedSerialized = localStorage.getItem(RUN_SAVE_KEY); } catch {}
    cleared = clearHistory() && cleared;
    cleared = resetProfile() && cleared;
    cleared = clearChallenges() && cleared;
    cleared = clearRunArchive() && cleared;
    cleared = clearProductMetrics() && cleared;
    this.resetRun();
    return cleared && this.storageStatus.available !== false;
  }

  restoreBackup() {
    if (!storageWritesAllowed()) return false;
    try {
      const raw = localStorage.getItem(RUN_BACKUP_KEY);
      if (!raw || !parseRunSave(raw)) return false;
      localStorage.setItem(RUN_SAVE_KEY, raw);
      const restored = this.loadFromStorage();
      if (restored) {
        this.normalizeAfterDatabaseLoad();
        this._emit('rules'); this._emit('stats'); this._emit('progress');
      }
      return restored;
    } catch (error) {
      recordStorageError(error, 'backup-restore');
      this._setStorageStatus({ lastError: String(error?.message || error) });
      return false;
    }
  }

  hasBackup() {
    try { return Boolean(localStorage.getItem(RUN_BACKUP_KEY)); } catch (error) {
      recordStorageError(error, 'backup-read');
      return false;
    }
  }

  exportSaveData() {
    const loadouts = {};
    for (let slot = 1; slot <= 3; slot += 1) {
      try {
        const raw = localStorage.getItem(`overlogic_loadout_slot_${slot}`);
        if (raw) loadouts[slot] = JSON.parse(raw);
      } catch (error) { recordStorageError(error, `loadout-${slot}-export`); }
    }
    const payload = {
      product: 'overlogic',
      exportVersion: 1,
      exportedAt: new Date().toISOString(),
      run: this._runSaveData(),
      settings: this.settings,
      loadouts,
      battleHistory: allBattles(),
      profile: profileSnapshot(),
      challenges: challengeSnapshot(),
      runArchive: runArchiveSnapshot(),
    };
    payload.integrity = {
      algorithm: 'fnv1a32',
      digest: portableSaveIntegrity(payload),
    };
    return JSON.stringify(payload, null, 2);
  }

  exportSupportBundle() {
    const release = globalThis.__OVERLOGIC_RELEASE__ || 'dev';
    return JSON.stringify({
      product: 'overlogic',
      supportVersion: 1,
      exportedAt: new Date().toISOString(),
      release,
      operations: operationsSnapshot(),
      productMetrics: productMetricsSnapshot(),
      storageStatus: this.storageStatus,
      settings: {
        language: this.settings.language,
        reduceMotion: this.settings.reduceMotion,
        highContrast: this.settings.highContrast,
        productMetrics: this.settings.productMetrics,
        screenShake: this.settings.screenShake,
      },
      run: {
        mode: this.runConfig?.mode,
        difficulty: this.runConfig?.difficulty,
        seed: this.runConfig?.seed,
        currentBattleIndex: this.currentBattleIndex,
        currentMapColumn: this.currentMapColumn,
        battlesWon: this.runStats?.battlesWon || 0,
      },
      lastReport: this.lastReport,
      battleHistory: allBattles().slice(0, 12),
      profile: profileSnapshot(),
      challenges: challengeSnapshot(),
      runArchive: runArchiveSnapshot(),
      runtimeDiagnostics: runtimeDiagnosticsSnapshot(),
    }, null, 2);
  }

  importSaveData(raw) {
    if (!storageWritesAllowed()) return false;
    if (typeof raw !== 'string' || raw.length === 0 || raw.length > 1_000_000) return false;
    let previousPrimary;
    let previousBackup;
    let previousSettings;
    const previousLoadouts = {};
    let previousHistory = null;
    let previousProfile = null;
    let previousChallenges = null;
    let previousRunArchive = null;
    try {
      const payload = JSON.parse(raw);
      if (payload?.product !== 'overlogic' || payload?.exportVersion !== 1) return false;
      if (payload.integrity !== undefined && (
        payload.integrity?.algorithm !== 'fnv1a32' ||
        !/^SAV1-[0-9A-F]{8}$/.test(String(payload.integrity?.digest || '')) ||
        payload.integrity.digest !== portableSaveIntegrity(payload)
      )) return false;
      if (!payload.run || typeof payload.run !== 'object' || Array.isArray(payload.run)) return false;
      if (!Array.isArray(payload.run.rules) || payload.run.rules.length > MAX_RULES) return false;
      if (payload.battleHistory !== undefined &&
        (!Array.isArray(payload.battleHistory) || payload.battleHistory.length > 60)) return false;
      if (payload.profile !== undefined &&
        (!payload.profile || typeof payload.profile !== 'object' || Array.isArray(payload.profile))) return false;
      if (payload.challenges !== undefined &&
        (!payload.challenges || typeof payload.challenges !== 'object' || Array.isArray(payload.challenges))) return false;
      if (payload.runArchive !== undefined &&
        (!payload.runArchive || typeof payload.runArchive !== 'object' || Array.isArray(payload.runArchive) ||
          !Array.isArray(payload.runArchive.entries) || payload.runArchive.entries.length > 40)) return false;
      previousPrimary = localStorage.getItem(RUN_SAVE_KEY);
      previousBackup = localStorage.getItem(RUN_BACKUP_KEY);
      previousSettings = localStorage.getItem('overlogic_settings');
      for (let slot = 1; slot <= 3; slot += 1) {
        previousLoadouts[slot] = localStorage.getItem(`overlogic_loadout_slot_${slot}`);
      }
      previousHistory = allBattles();
      previousProfile = profileSnapshot();
      previousChallenges = challengeSnapshot();
      previousRunArchive = runArchiveSnapshot();
      if (previousPrimary && parseRunSave(previousPrimary)) {
        localStorage.setItem(RUN_BACKUP_KEY, previousPrimary);
      }
      localStorage.setItem(RUN_SAVE_KEY, serializeRunSave(payload.run));
      if (payload.settings && typeof payload.settings === 'object' && !Array.isArray(payload.settings)) {
        localStorage.setItem('overlogic_settings', JSON.stringify(payload.settings));
        this.loadSettings();
      }
      for (let slot = 1; slot <= 3; slot += 1) {
        const rules = payload.loadouts?.[slot];
        if (Array.isArray(rules) && rules.length <= MAX_RULES) {
          localStorage.setItem(`overlogic_loadout_slot_${slot}`, JSON.stringify(rules));
        } else if (payload.loadouts !== undefined) {
          localStorage.removeItem(`overlogic_loadout_slot_${slot}`);
        }
      }
      if (payload.battleHistory !== undefined && !replaceHistory(payload.battleHistory)) throw new Error('History import failed');
      if (payload.profile !== undefined && !replaceProfile(payload.profile)) throw new Error('Profile import failed');
      if (payload.challenges !== undefined && !replaceChallenges(payload.challenges)) throw new Error('Challenge import failed');
      if (payload.runArchive !== undefined && !replaceRunArchive(payload.runArchive)) throw new Error('Run archive import failed');
      if (!this.loadFromStorage()) throw new Error('Imported save could not be loaded');
      this.normalizeAfterDatabaseLoad();
      this.saveToStorage();
      this._emit('rules'); this._emit('stats'); this._emit('progress');
      return true;
    } catch (error) {
      if (previousPrimary !== undefined) {
        try {
          if (previousPrimary === null) localStorage.removeItem(RUN_SAVE_KEY);
          else localStorage.setItem(RUN_SAVE_KEY, previousPrimary);
        } catch {}
      }
      if (previousBackup !== undefined) {
        try {
          if (previousBackup === null) localStorage.removeItem(RUN_BACKUP_KEY);
          else localStorage.setItem(RUN_BACKUP_KEY, previousBackup);
        } catch {}
      }
      if (previousSettings !== undefined) {
        try {
          if (previousSettings === null) localStorage.removeItem('overlogic_settings');
          else localStorage.setItem('overlogic_settings', previousSettings);
          this.loadSettings();
        } catch {}
      }
      for (let slot = 1; slot <= 3; slot += 1) {
        if (!(slot in previousLoadouts)) continue;
        try {
          const previous = previousLoadouts[slot];
          if (previous === null) localStorage.removeItem(`overlogic_loadout_slot_${slot}`);
          else localStorage.setItem(`overlogic_loadout_slot_${slot}`, previous);
        } catch {}
      }
      if (previousHistory) replaceHistory(previousHistory);
      if (previousProfile) replaceProfile(previousProfile);
      if (previousChallenges) replaceChallenges(previousChallenges);
      if (previousRunArchive) replaceRunArchive(previousRunArchive);
      try {
        if (typeof previousPrimary === 'string') {
          this.loadFromStorage();
          this.normalizeAfterDatabaseLoad();
        } else if (previousPrimary === null) {
          this.resetRun();
        }
      } catch {}
      this._setStorageStatus({ lastError: String(error?.message || error) });
      return false;
    }
  }

  saveLoadout(slotIndex) {
    if (!validLoadoutSlot(slotIndex)) return false;
    if (!storageWritesAllowed()) return false;
    try {
      localStorage.setItem(`overlogic_loadout_slot_${slotIndex}`, JSON.stringify(this.rules));
      return true;
    } catch (e) {
      recordStorageError(e, `loadout-${slotIndex}`);
      console.error(`Failed to save loadout for slot ${slotIndex}`, e);
      return false;
    }
  }

  loadLoadout(slotIndex) {
    if (!validLoadoutSlot(slotIndex)) return false;
    try {
      const raw = localStorage.getItem(`overlogic_loadout_slot_${slotIndex}`);
      if (!raw) return false;
      const loadedRules = JSON.parse(raw);
      if (!Array.isArray(loadedRules)) return false;
      const availConds = this.availableConditionIds();
      const availActs = this.availableActionIds();
      const prevLength = loadedRules.length;
      const normalizedRuleIds = new Set();
      const normalizedRules = loadedRules.filter(r => {
        const operator = r.operator === 'and' || r.operator === 'or' ? r.operator : null;
        const condOk = availConds.includes(r.conditionId);
        const cond2Ok = !operator || availConds.includes(r.conditionId2);
        const actOk = availActs.includes(r.actionId);
        return condOk && cond2Ok && actOk;
      }).slice(0, 40).map(r => {
        // Loadouts can outlive the current run or come from a shared file.
        // Keep stable IDs when possible, but repair duplicates and advance the
        // counter so a subsequent addRule() cannot create the same ID.
        const rawId = String(r.id || '');
        const idMatch = /^rule_(\d+)$/.exec(rawId);
        const numericId = idMatch ? Number(idMatch[1]) : 0;
        if (Number.isSafeInteger(numericId)) this._ruleCounter = Math.max(this._ruleCounter, numericId);
        const id = rawId && !normalizedRuleIds.has(rawId) ? rawId : this._nextRuleId();
        normalizedRuleIds.add(id);
        const operator = r.operator === 'and' || r.operator === 'or' ? r.operator : null;
        return {
          ...r,
          id,
          operator,
          conditionId2: operator ? r.conditionId2 : null,
          conditionValue: this._normalizeConditionValue(r.conditionId, r.conditionValue),
          conditionValue2: operator && r.conditionId2
            ? this._normalizeConditionValue(r.conditionId2, r.conditionValue2)
            : null,
          priority: Math.max(0, Math.min(100, r.priority | 0)),
          targetPriority: TARGET_PRIORITIES.has(r.targetPriority) ? r.targetPriority : 'nearest',
          negateCondition1: r.negateCondition1 === true,
          negateCondition2: r.negateCondition2 === true,
          enabled: r.enabled !== false,
        };
      });
      if (normalizedRules.length === 0) return false;
      this._pushState();
      this.rules = normalizedRules;
      this.saveToStorage();
      this._emit('rules');
      return { ok: true, filtered: this.rules.length < prevLength };
    } catch (e) {
      recordStorageError(e, `loadout-${slotIndex}`);
      console.error(`Failed to load loadout for slot ${slotIndex}`, e);
      return false;
    }
  }

  hasLoadout(slotIndex) {
    if (!validLoadoutSlot(slotIndex)) return false;
    try {
      return localStorage.getItem(`overlogic_loadout_slot_${slotIndex}`) !== null;
    } catch (e) {
      recordStorageError(e, `loadout-${slotIndex}`);
      return false;
    }
  }

  availableConditionIds() {
    const out = GameDatabase.conditionsUnlockedByTeach(this.teachNode);
    // Unlock hp_above at teach 2+ alongside enemy_far
    if (this.teachNode >= 2 && !out.includes('hp_above')) out.push('hp_above');
    for (const id of this.unlockedConditionIds) if (!out.includes(id)) out.push(id);
    return out;
  }
  availableActionIds() {
    const out = GameDatabase.actionsUnlockedByTeach(this.teachNode);
    for (const id of this.unlockedActionIds) if (!out.includes(id)) out.push(id);
    return out;
  }

  normalizeAfterDatabaseLoad() {
    let changed = false;
    if (!Array.isArray(this.mapNodes) || !this._mapShapeLooksCurrent()) {
      const loadedMap = Array.isArray(this.mapNodes) ? this.mapNodes : [];
      const wasLegacyCompleted = loadedMap.length === 7 && this.currentMapColumn >= loadedMap.length;
      this._initMap();
      this._mergeMapCompletion(loadedMap);
      if (wasLegacyCompleted) {
        for (const column of this.mapNodes) {
          for (const node of column) node.completed = true;
        }
        this.currentMapColumn = this.mapNodes.length;
        this.selectedNodeId = null;
      }
      changed = true;
    }
    // `mapNodes.length` is a deliberate sentinel for a completed run. Clamp
    // against it rather than the last playable column, otherwise a victory
    // is silently downgraded to the final boss node after a page refresh.
    const maxColumn = Math.max(0, this.mapNodes.length);
    const rawColumn = this.currentMapColumn | 0;
    // Only the exact sentinel represents a legitimate completed run; larger
    // corrupt values fall back to the final playable column instead of
    // granting a malformed save a false victory.
    const clampedColumn = rawColumn === maxColumn
      ? maxColumn
      : Math.max(0, Math.min(Math.max(0, maxColumn - 1), rawColumn));
    if (clampedColumn !== this.currentMapColumn) {
      this.currentMapColumn = clampedColumn;
      changed = true;
    }
    if (this.currentMapColumn >= this.mapNodes.length) {
      if (this.selectedNodeId !== null) {
        this.selectedNodeId = null;
        changed = true;
      }
    } else {
      const activeCol = this.mapNodes[this.currentMapColumn] || [];
      if (!activeCol.some(node => node.id === this.selectedNodeId)) {
        this.selectedNodeId = activeCol[0]?.id || '0_start';
        changed = true;
      }
    }
    const clampedTeach = Math.max(MIN_TEACH_NODE, Math.min(MAX_TEACH_NODE, this.teachNode | 0));
    if (clampedTeach !== this.teachNode) {
      this.teachNode = clampedTeach;
      changed = true;
    }
    const maxBattleIndex = Math.max(0, GameDatabase.getBattleCount() - 1);
    const clampedBattleIndex = Math.max(0, Math.min(maxBattleIndex, this.currentBattleIndex | 0));
    if (clampedBattleIndex !== this.currentBattleIndex) {
      this.currentBattleIndex = clampedBattleIndex;
      changed = true;
    }
    const defaultStats = baseStats();
    const mergedStats = { ...defaultStats, ...(this.stats || {}) };
    for (const [key, [min, max]] of Object.entries(STAT_LIMITS)) {
      const numeric = Number(mergedStats[key]);
      const normalized = Number.isFinite(numeric)
        ? Math.max(min, Math.min(max, numeric))
        : defaultStats[key];
      if (normalized !== mergedStats[key]) mergedStats[key] = normalized;
    }
    if (JSON.stringify(mergedStats) !== JSON.stringify(this.stats)) {
      this.stats = mergedStats;
      changed = true;
    }
    const normalizedRunStats = {
      runId: /^run_[A-Za-z0-9_]{6,80}$/.test(String(this.runStats?.runId || ''))
        ? String(this.runStats.runId)
        : createRunId(),
      completionRecorded: this.runStats?.completionRecorded === true,
      battlesWon: Math.max(0, Number(this.runStats?.battlesWon) || 0),
      totalDamageDealt: Math.max(0, Number(this.runStats?.totalDamageDealt) || 0),
      totalBattleTime: Math.max(0, Number(this.runStats?.totalBattleTime) || 0),
      rewardsChosen: Array.isArray(this.runStats?.rewardsChosen)
        ? this.runStats.rewardsChosen.filter(id => GameDatabase.getReward(id))
        : [],
      replayDigests: Array.isArray(this.runStats?.replayDigests)
        ? this.runStats.replayDigests.filter((digest) => /^RPL\d+-[0-9A-F]{8}$/.test(String(digest))).slice(-12)
        : [],
    };
    if (JSON.stringify(normalizedRunStats) !== JSON.stringify(this.runStats)) {
      this.runStats = normalizedRunStats;
      changed = true;
    }
    if (!this.lastReport || typeof this.lastReport !== 'object' || Array.isArray(this.lastReport)) {
      this.lastReport = {};
      changed = true;
    } else if (Array.isArray(this.lastReport.timeline) && this.lastReport.timeline.length > 100) {
      this.lastReport = { ...this.lastReport, timeline: this.lastReport.timeline.slice(-100) };
      changed = true;
    }
    if (Array.isArray(this.lastReport.replay_events) && this.lastReport.replay_events.length > MAX_REPLAY_EVENTS) {
      this.lastReport = { ...this.lastReport, replay_events: this.lastReport.replay_events.slice(-MAX_REPLAY_EVENTS) };
      changed = true;
    } else if (this.lastReport.replay_events !== undefined && !Array.isArray(this.lastReport.replay_events)) {
      this.lastReport = { ...this.lastReport, replay_events: [] };
      changed = true;
    }
    const requestedMode = RUN_MODES.has(this.runConfig?.mode) ? this.runConfig.mode : 'standard';
    const normalizedMode = (requestedMode === 'daily' && !featureEnabled('dailyChallenges')) ||
      (requestedMode === 'weekly' && !featureEnabled('weeklyGauntlet'))
      ? 'standard' : requestedMode;
    const normalizedDifficulty = DIFFICULTIES.has(this.runConfig?.difficulty)
      ? this.runConfig.difficulty
      : 'standard';
    const normalizedRunConfig = {
      mode: normalizedMode,
      difficulty: normalizedDifficulty,
      seed: Number.isSafeInteger(Number(this.runConfig?.seed)) && Number(this.runConfig.seed) > 0
        ? Number(this.runConfig.seed)
        : (this.periodSeed(normalizedMode) || createRunSeed()),
    };
    if (JSON.stringify(normalizedRunConfig) !== JSON.stringify(this.runConfig)) {
      this.runConfig = normalizedRunConfig;
      changed = true;
    }
    const normalizedTutorial = {
      editedRule: this.tutorialProgress?.editedRule === true,
      sandboxRun: this.tutorialProgress?.sandboxRun === true,
    };
    if (JSON.stringify(normalizedTutorial) !== JSON.stringify(this.tutorialProgress)) {
      this.tutorialProgress = normalizedTutorial;
      changed = true;
    }
    if (this.persistentHp !== null) {
      const hp = Number(this.persistentHp);
      const normalizedHp = Number.isFinite(hp) && hp > 0 ? Math.min(hp, this.stats.max_hp) : null;
      if (normalizedHp !== this.persistentHp) {
        this.persistentHp = normalizedHp;
        changed = true;
      }
    }
    const validConds = new Set(GameDatabase.conditions.keys());
    const validActs = new Set(GameDatabase.actions.keys());
    const normalizedUnlockedConditions = [...new Set(this.unlockedConditionIds || [])].filter(id => validConds.has(id));
    const normalizedUnlockedActions = [...new Set(this.unlockedActionIds || [])].filter(id => validActs.has(id));
    if (JSON.stringify(normalizedUnlockedConditions) !== JSON.stringify(this.unlockedConditionIds)) {
      this.unlockedConditionIds = normalizedUnlockedConditions;
      changed = true;
    }
    if (JSON.stringify(normalizedUnlockedActions) !== JSON.stringify(this.unlockedActionIds)) {
      this.unlockedActionIds = normalizedUnlockedActions;
      changed = true;
    }
    const beforeRulesJson = JSON.stringify(this.rules || []);
    for (const rule of this.rules || []) {
      const match = /^rule_(\d+)$/.exec(String(rule.id || ''));
      const numericId = match ? Number(match[1]) : 0;
      if (Number.isSafeInteger(numericId)) this._ruleCounter = Math.max(this._ruleCounter, numericId);
    }
    const usedRuleIds = new Set();
    this.rules = (this.rules || []).filter(rule => {
      if (!validConds.has(rule.conditionId) || !validActs.has(rule.actionId)) return false;
      if (rule.operator && !validConds.has(rule.conditionId2)) return false;
      return true;
    }).slice(0, MAX_RULES).map(rule => {
      let id = String(rule.id || '');
      if (!id || usedRuleIds.has(id)) id = this._nextRuleId();
      usedRuleIds.add(id);
      const operator = rule.operator === 'and' || rule.operator === 'or' ? rule.operator : null;
      return {
        id,
        conditionId: rule.conditionId,
        conditionValue: this._normalizeConditionValue(rule.conditionId, rule.conditionValue),
        conditionId2: operator ? rule.conditionId2 : null,
        conditionValue2: operator ? this._normalizeConditionValue(rule.conditionId2, rule.conditionValue2) : null,
        operator,
        actionId: rule.actionId,
        priority: Math.max(0, Math.min(100, rule.priority | 0)),
        targetPriority: TARGET_PRIORITIES.has(rule.targetPriority) ? rule.targetPriority : 'nearest',
        negateCondition1: rule.negateCondition1 === true,
        negateCondition2: rule.negateCondition2 === true,
        enabled: rule.enabled !== false,
      };
    });
    if (JSON.stringify(this.rules) !== beforeRulesJson) changed = true;
    if (this.rules.length === 0) {
      this._initDefaultRules();
      changed = true;
    }
    if (this.saveVersion !== SAVE_VERSION) {
      this.saveVersion = SAVE_VERSION;
      changed = true;
    }
    if (changed) {
      this.saveToStorage();
      this._emit('rules'); this._emit('stats'); this._emit('progress');
    }
    return changed;
  }

  _mapShapeLooksCurrent() {
    if (!Array.isArray(this.mapNodes) || this.mapNodes.length !== MAP_NODE_IDS.length) return false;
    return MAP_NODE_IDS.every((ids, colIndex) => {
      const col = this.mapNodes[colIndex];
      return Array.isArray(col) && ids.every(id => col.some(node => node && node.id === id));
    });
  }

  _mergeMapCompletion(loadedMap) {
    const byId = new Map();
    for (const col of loadedMap) {
      for (const node of col || []) byId.set(node.id, node);
    }
    for (const col of this.mapNodes) {
      for (const node of col) {
        const old = byId.get(node.id);
        if (old && old.completed) node.completed = true;
      }
    }
  }

  isDemoCleared() {
    return this.currentMapColumn >= this.mapNodes.length;
  }
}

function hashString(value) {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function portableSaveIntegrity(payload) {
  const unsigned = { ...payload };
  delete unsigned.integrity;
  return `SAV1-${hashString(JSON.stringify(unsigned)).toString(16).padStart(8, '0').toUpperCase()}`;
}

function createRunSeed() {
  try {
    const values = new Uint32Array(1);
    globalThis.crypto?.getRandomValues?.(values);
    if (values[0]) return values[0];
  } catch {}
  return (hashString(`${Date.now()}:${Math.random()}`) || 1) >>> 0;
}

function normalizeRunSeed(value) {
  const numeric = typeof value === 'string' && /^[0-9]+$/.test(value.trim())
    ? Number(value.trim())
    : Number(value);
  return Number.isSafeInteger(numeric) && numeric > 0 && numeric <= 0xffffffff ? numeric : null;
}

function serializeRunSave(data) {
  const payload = JSON.stringify(data);
  return JSON.stringify({
    ...data,
    _integrity: hashString(payload).toString(36),
  });
}

function parseRunSave(raw) {
  const data = JSON.parse(raw);
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error('Run save must be an object');
  }
  if (data._integrity !== undefined) {
    const expected = String(data._integrity);
    const payload = { ...data };
    delete payload._integrity;
    const actual = hashString(JSON.stringify(payload)).toString(36);
    if (actual !== expected) throw new Error('Run save integrity check failed');
    return payload;
  }
  // Versions 1–5 predate checksums and remain migratable.
  return data;
}

export const GameState = new GameStateClass();
