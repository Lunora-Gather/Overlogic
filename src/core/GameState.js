// GameState.js — persistent run state: rules, stats, progress, unlocks.
// Mirrors scripts/core/GameState.gd. Singleton instance exported.

import { GameDatabase } from './GameDatabase.js';
import { AudioManager } from '../systems/AudioManager.js';

const SAVE_VERSION = 3;
const MIN_TEACH_NODE = 1;
const MAX_TEACH_NODE = 4;
const MAP_NODE_IDS = [
  ['0_start'],
  ['1_a', '1_b'],
  ['2_a', '2_b'],
  ['3_a', '3_b'],
  ['4_a', '4_b'],
  ['5_upgrade'],
  ['6_boss', '6_apex'],
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
    this.runStats = { battlesWon: 0, totalDamageDealt: 0, totalBattleTime: 0, rewardsChosen: [] };
    this._ruleCounter = 0;
    this.settings = {
      volume: 0.8,
      mute: false,
      screenShake: true,
      reduceMotion: window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false,
    };
    // simple pub/sub for UI re-render
    this._listeners = { rules: [], stats: [], progress: [] };
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
        this.settings.volume = parsed.volume ?? 0.8;
        this.settings.mute = parsed.mute ?? false;
        this.settings.screenShake = parsed.screenShake ?? true;
        this.settings.reduceMotion = parsed.reduceMotion ??
          (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false);
      }
      // Apply to AudioManager
      AudioManager.volumeVal = this.settings.volume;
      AudioManager.muted = this.settings.mute;
    } catch (e) {
      console.error('Failed to load settings', e);
    }
  }

  saveSettings() {
    try {
      localStorage.setItem('overlogic_settings', JSON.stringify(this.settings));
      // Apply to AudioManager
      AudioManager.setVolume(this.settings.volume);
      AudioManager.setMute(this.settings.mute);
    } catch (e) {
      console.error('Failed to save settings', e);
    }
  }

  resetRun() {
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
    this.runStats = { battlesWon: 0, totalDamageDealt: 0, totalBattleTime: 0, rewardsChosen: [] };
    this._initDefaultRules();
    this.saveToStorage();
    this._emit('rules'); this._emit('stats'); this._emit('progress');
  }

  _newRule(condId, condVal, actId, prio, condId2 = null, condVal2 = null, operator = null, targetPriority = 'nearest') {
    return {
      id: this._nextRuleId(),
      conditionId: condId,
      conditionValue: condVal,
      conditionId2: condId2,
      conditionValue2: condVal2,
      operator: operator,
      actionId: actId,
      priority: prio,
      targetPriority: targetPriority,
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
    this.runStats.battlesWon += 1;
    this.runStats.totalDamageDealt += Number(this.lastReport?.total_damage_dealt) || 0;
    this.runStats.totalBattleTime += Number(this.lastReport?.battle_time) || 0;
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

    this.saveToStorage();
    this._emit('progress');
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
    this._pushState();
    this.rules.push(this._newRule(condId, condVal, actId, prio, condId2, condVal2, operator, targetPriority));
    this.saveToStorage();
    this._emit('rules');
  }
  setRuleTargetPriority(ruleId, priority) {
    const r = this.rules.find(r => r.id === ruleId);
    if (r && r.targetPriority !== priority) {
      this._pushState();
      r.targetPriority = priority;
      this.saveToStorage();
      this._emit('rules');
    }
  }
  removeRule(ruleId) {
    this._pushState();
    this.rules = this.rules.filter(r => r.id !== ruleId);
    this.saveToStorage();
    this._emit('rules');
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
    if (r && r.conditionValue !== value) {
      this._pushState();
      r.conditionValue = value;
      this.saveToStorage();
      this._emit('rules');
    }
  }
  setRuleConditionValue2(ruleId, value) {
    const r = this.rules.find(r => r.id === ruleId);
    if (r && r.conditionValue2 !== value) {
      this._pushState();
      r.conditionValue2 = value;
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
      r.conditionValue = cd ? cd.defaultValue : null;
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
      r.conditionValue2 = cd ? cd.defaultValue : null;
      this.saveToStorage();
      this._emit('rules');
    }
  }
  setRuleOperator(ruleId, op) {
    const r = this.rules.find(r => r.id === ruleId);
    if (r && r.operator !== op) {
      this._pushState();
      r.operator = op || null;
      if (!op) {
        r.conditionId2 = null;
        r.conditionValue2 = null;
      } else if (!r.conditionId2) {
        const avail = this.availableConditionIds();
        r.conditionId2 = avail[0] || 'hp_low';
        const cd = GameDatabase.getCondition(r.conditionId2);
        r.conditionValue2 = cd ? cd.defaultValue : null;
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
      ]
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

  saveToStorage() {
    try {
      const data = {
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
        runStats: this.runStats,
        _ruleCounter: this._ruleCounter,
        saveVersion: SAVE_VERSION,
      };
      localStorage.setItem('overlogic_run_save', JSON.stringify(data));
    } catch (e) {
      console.error('Failed to save to localStorage', e);
    }
  }

  loadFromStorage() {
    try {
      const raw = localStorage.getItem('overlogic_run_save');
      if (!raw) return false;
      const data = JSON.parse(raw);
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
      this.runStats = data.runStats ?? {
        battlesWon: 0,
        totalDamageDealt: 0,
        totalBattleTime: 0,
        rewardsChosen: [],
      };
      this._ruleCounter = data._ruleCounter ?? 0;
      this.saveVersion = data.saveVersion ?? 1;
      return true;
    } catch (e) {
      console.error('Failed to load from localStorage', e);
      return false;
    }
  }

  clearStorage() {
    try {
      localStorage.removeItem('overlogic_run_save');
    } catch (e) {}
    this.resetRun();
  }

  saveLoadout(slotIndex) {
    try {
      localStorage.setItem(`overlogic_loadout_slot_${slotIndex}`, JSON.stringify(this.rules));
      return true;
    } catch (e) {
      console.error(`Failed to save loadout for slot ${slotIndex}`, e);
      return false;
    }
  }

  loadLoadout(slotIndex) {
    try {
      const raw = localStorage.getItem(`overlogic_loadout_slot_${slotIndex}`);
      if (!raw) return false;
      const loadedRules = JSON.parse(raw);
      if (!Array.isArray(loadedRules)) return false;
      this._pushState();
      const availConds = this.availableConditionIds();
      const availActs = this.availableActionIds();
      const prevLength = loadedRules.length;
      this.rules = loadedRules.filter(r => {
        const condOk = availConds.includes(r.conditionId);
        const cond2Ok = !r.operator || availConds.includes(r.conditionId2);
        const actOk = availActs.includes(r.actionId);
        return condOk && cond2Ok && actOk;
      });
      this.saveToStorage();
      this._emit('rules');
      return { ok: true, filtered: this.rules.length < prevLength };
    } catch (e) {
      console.error(`Failed to load loadout for slot ${slotIndex}`, e);
      return false;
    }
  }

  hasLoadout(slotIndex) {
    try {
      return localStorage.getItem(`overlogic_loadout_slot_${slotIndex}`) !== null;
    } catch (e) {
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
      this._initMap();
      this._mergeMapCompletion(loadedMap);
      changed = true;
    }
    const maxColumn = Math.max(0, this.mapNodes.length - 1);
    const clampedColumn = Math.max(0, Math.min(maxColumn, this.currentMapColumn | 0));
    if (clampedColumn !== this.currentMapColumn) {
      this.currentMapColumn = clampedColumn;
      changed = true;
    }
    const activeCol = this.mapNodes[this.currentMapColumn] || [];
    if (!activeCol.some(node => node.id === this.selectedNodeId)) {
      this.selectedNodeId = activeCol[0]?.id || '0_start';
      changed = true;
    }
    const clampedTeach = Math.max(MIN_TEACH_NODE, Math.min(MAX_TEACH_NODE, this.teachNode | 0));
    if (clampedTeach !== this.teachNode) {
      this.teachNode = clampedTeach;
      changed = true;
    }
    const mergedStats = { ...baseStats(), ...(this.stats || {}) };
    if (JSON.stringify(mergedStats) !== JSON.stringify(this.stats)) {
      this.stats = mergedStats;
      changed = true;
    }
    const normalizedRunStats = {
      battlesWon: Math.max(0, Number(this.runStats?.battlesWon) || 0),
      totalDamageDealt: Math.max(0, Number(this.runStats?.totalDamageDealt) || 0),
      totalBattleTime: Math.max(0, Number(this.runStats?.totalBattleTime) || 0),
      rewardsChosen: Array.isArray(this.runStats?.rewardsChosen)
        ? this.runStats.rewardsChosen.filter(id => GameDatabase.getReward(id))
        : [],
    };
    if (JSON.stringify(normalizedRunStats) !== JSON.stringify(this.runStats)) {
      this.runStats = normalizedRunStats;
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
      if (match) this._ruleCounter = Math.max(this._ruleCounter, Number(match[1]) || 0);
    }
    const usedRuleIds = new Set();
    this.rules = (this.rules || []).filter(rule => {
      if (!validConds.has(rule.conditionId) || !validActs.has(rule.actionId)) return false;
      if (rule.operator && !validConds.has(rule.conditionId2)) return false;
      return true;
    }).map(rule => {
      let id = String(rule.id || '');
      if (!id || usedRuleIds.has(id)) id = this._nextRuleId();
      usedRuleIds.add(id);
      const operator = rule.operator === 'and' || rule.operator === 'or' ? rule.operator : null;
      return {
        id,
        conditionId: rule.conditionId,
        conditionValue: rule.conditionValue ?? GameDatabase.getCondition(rule.conditionId)?.defaultValue ?? null,
        conditionId2: operator ? rule.conditionId2 : null,
        conditionValue2: operator ? (rule.conditionValue2 ?? GameDatabase.getCondition(rule.conditionId2)?.defaultValue ?? null) : null,
        operator,
        actionId: rule.actionId,
        priority: Math.max(0, Math.min(100, rule.priority | 0)),
        targetPriority: rule.targetPriority || 'nearest',
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

export const GameState = new GameStateClass();
