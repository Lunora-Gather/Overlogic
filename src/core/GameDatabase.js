// GameDatabase.js — loads all JSON data tables once, exposes typed access.
// Mirrors scripts/core/GameDatabase.gd. ES6 module, singleton instance exported.

class GameDatabaseClass {
  constructor() {
    this.conditions = new Map();   // id -> condition data
    this.actions = new Map();      // id -> action data
    this.enemies = new Map();      // id -> enemy data
    this.battles = [];             // ordered list
    this.rewards = new Map();      // id -> reward data
    this._loaded = false;
    this._loading = null;
  }

  async loadAll() {
    if (this._loaded) return;
    if (this._loading) return this._loading;
    this._loading = (async () => {
      const [c, a, e, b, r] = await Promise.all([
        this._fetchJson('data/conditions.json?v=20260725-4'),
        this._fetchJson('data/actions.json?v=20260725-4'),
        this._fetchJson('data/enemies.json?v=20260725-4'),
        this._fetchJson('data/battles.json?v=20260725-4'),
        this._fetchJson('data/rewards.json?v=20260725-4'),
      ]);
      if (!Array.isArray(c.conditions) || !Array.isArray(a.actions) ||
          !Array.isArray(e.enemies) || !Array.isArray(b.battles) || !Array.isArray(r.rewards)) {
        throw new Error('Simulation data has an invalid shape');
      }
      const contractErrors = validateDataTables({
        conditions: c.conditions,
        actions: a.actions,
        enemies: e.enemies,
        battles: b.battles,
        rewards: r.rewards,
      });
      if (contractErrors.length > 0) {
        throw new Error(`Simulation data contract failed: ${contractErrors.slice(0, 4).join('; ')}`);
      }
      for (const x of c.conditions) this.conditions.set(x.id, x);
      for (const x of a.actions) this.actions.set(x.id, x);
      for (const x of e.enemies) this.enemies.set(x.id, x);
      this.battles = b.battles;
      for (const x of r.rewards) this.rewards.set(x.id, x);
      this._loaded = true;
    })();
    try {
      await this._loading;
    } finally {
      this._loading = null;
    }
  }

  async _fetchJson(url, { timeoutMs = 12000, retries = 1 } = {}) {
    let lastError = null;
    for (let attempt = 0; attempt <= retries; attempt += 1) {
      const controller = typeof AbortController === 'function' ? new AbortController() : null;
      const timeout = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
      try {
        const response = await fetch(url, controller ? { signal: controller.signal } : undefined);
        if (response?.ok === false) throw new Error(`HTTP ${response.status} while loading ${url}`);
        const data = await response.json();
        if (!data || typeof data !== 'object') throw new Error(`Invalid JSON payload for ${url}`);
        return data;
      } catch (error) {
        lastError = error;
        if (attempt < retries) await new Promise((resolve) => setTimeout(resolve, 180 * (attempt + 1)));
      } finally {
        if (timeout) clearTimeout(timeout);
      }
    }
    throw lastError || new Error(`Unable to load ${url}`);
  }

  getCondition(id) { return this.conditions.get(id) || null; }
  getAction(id)    { return this.actions.get(id)    || null; }
  getEnemy(id)     { return this.enemies.get(id)    || null; }
  getBattle(i)     { return (i >= 0 && i < this.battles.length) ? this.battles[i] : null; }
  getBattleCount() { return this.battles.length; }
  getReward(id)    { return this.rewards.get(id)    || null; }
  allRewards()     { return [...this.rewards.values()]; }

  validateContracts() {
    return validateDataTables({
      conditions: [...this.conditions.values()],
      actions: [...this.actions.values()],
      enemies: [...this.enemies.values()],
      battles: this.battles,
      rewards: [...this.rewards.values()],
    });
  }

  // Modules unlocked by teaching node (1..4). teach_node <= unlock threshold.
  conditionsUnlockedByTeach(teachNode) {
    const out = [];
    for (const [id, c] of this.conditions) {
      const tu = c.teachUnlock;
      if (typeof tu === 'number' && tu <= teachNode) out.push(id);
    }
    return out;
  }
  actionsUnlockedByTeach(teachNode) {
    const out = [];
    for (const [id, a] of this.actions) {
      const tu = a.teachUnlock;
      if (typeof tu === 'number' && tu <= teachNode) out.push(id);
    }
    return out;
  }
}

const CONDITION_TYPES = new Set(['none', 'float', 'int', 'percent', 'actionId', 'vec2']);
const REWARD_TYPES = new Set(['passive', 'new_action', 'new_condition']);
const PASSIVE_TARGETS = new Set([
  'max_hp', 'max_energy', 'energy_regen', 'basic_dmg', 'move_speed', 'dash_cd', 'shield_cd',
  'shield_dur', 'overdrive_dur', 'interrupt_cd', 'reflective_plating', 'nanite_repair',
  'superconductors', 'emergency_recall', 'heavy_impact', 'thermal_recycle', 'armor_piercing',
]);

function finite(value) { return typeof value === 'number' && Number.isFinite(value); }
function uniqueIds(items, label, errors) {
  const seen = new Set();
  for (const item of items) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      errors.push(`${label}: entry must be an object`);
      continue;
    }
    if (typeof item.id !== 'string' || !/^[a-z0-9_]+$/.test(item.id)) errors.push(`${label}: invalid id`);
    else if (seen.has(item.id)) errors.push(`${label}: duplicate id ${item.id}`);
    seen.add(item.id);
  }
  return seen;
}

function validateDataTables({ conditions, actions, enemies, battles, rewards }) {
  const errors = [];
  const conditionIds = uniqueIds(conditions, 'conditions', errors);
  const actionIds = uniqueIds(actions, 'actions', errors);
  const enemyIds = uniqueIds(enemies, 'enemies', errors);
  uniqueIds(battles, 'battles', errors);
  const rewardIds = uniqueIds(rewards, 'rewards', errors);

  for (const condition of conditions) {
    if (!condition || typeof condition !== 'object') continue;
    if (!CONDITION_TYPES.has(condition.parameterType)) errors.push(`condition ${condition.id}: invalid parameterType`);
    const type = condition.parameterType;
    if (type === 'none') {
      if (condition.defaultValue !== null || condition.minValue !== null || condition.maxValue !== null) {
        errors.push(`condition ${condition.id}: none parameter bounds must be null`);
      }
    } else if (type === 'actionId') {
      if (!actionIds.has(condition.defaultValue) || condition.minValue !== null || condition.maxValue !== null) {
        errors.push(`condition ${condition.id}: invalid actionId parameter`);
      }
    } else if (type === 'vec2') {
      for (const field of ['defaultValue', 'minValue', 'maxValue']) {
        if (!Array.isArray(condition[field]) || condition[field].length !== 2 || !condition[field].every(finite)) {
          errors.push(`condition ${condition.id}: ${field} must be a numeric vec2`);
        }
      }
    } else if (!finite(condition.defaultValue) || !finite(condition.minValue) || !finite(condition.maxValue) ||
      condition.minValue > condition.maxValue || condition.defaultValue < condition.minValue || condition.defaultValue > condition.maxValue) {
      errors.push(`condition ${condition.id}: invalid numeric bounds`);
    }
  }

  for (const action of actions) {
    if (!action || typeof action !== 'object') continue;
    if (typeof action.displayName !== 'string' || typeof action.description !== 'string') errors.push(`action ${action.id}: missing copy`);
    for (const field of ['cooldown', 'energyCost', 'range']) {
      if (!finite(action[field]) || action[field] < 0) errors.push(`action ${action.id}: invalid ${field}`);
    }
    if (!action.effectValue || typeof action.effectValue !== 'object') errors.push(`action ${action.id}: missing effectValue`);
  }

  for (const enemy of enemies) {
    if (!enemy || typeof enemy !== 'object') continue;
    if (typeof enemy.displayName !== 'string') errors.push(`enemy ${enemy.id}: missing displayName`);
    for (const field of ['maxHp', 'moveSpeed', 'damage', 'attackRange', 'attackCooldown', 'bodyRadius']) {
      if (!finite(enemy[field]) || enemy[field] < 0) errors.push(`enemy ${enemy.id}: invalid ${field}`);
    }
    if (!Array.isArray(enemy.color) || enemy.color.length !== 3 || !enemy.color.every((value) => finite(value) && value >= 0 && value <= 1)) {
      errors.push(`enemy ${enemy.id}: invalid color`);
    }
  }

  for (const battle of battles) {
    if (!battle || typeof battle !== 'object') continue;
    if (!Array.isArray(battle.enemySpawns) || battle.enemySpawns.length === 0) errors.push(`battle ${battle.id}: missing spawns`);
    for (const spawn of battle.enemySpawns || []) {
      if (!enemyIds.has(spawn.enemyId)) errors.push(`battle ${battle.id}: missing enemy ${spawn.enemyId}`);
      if (!Number.isInteger(spawn.count) || spawn.count < 1) errors.push(`battle ${battle.id}: invalid spawn count`);
      if (!Number.isInteger(spawn.wave) || spawn.wave < 1) errors.push(`battle ${battle.id}: invalid spawn wave`);
    }
    for (const rewardId of battle.rewardPool || []) if (!rewardIds.has(rewardId)) errors.push(`battle ${battle.id}: missing reward ${rewardId}`);
  }

  for (const reward of rewards) {
    if (!reward || typeof reward !== 'object') continue;
    if (!REWARD_TYPES.has(reward.rewardType)) errors.push(`reward ${reward.id}: invalid rewardType`);
    if (reward.rewardType === 'passive' && (!PASSIVE_TARGETS.has(reward.targetId) || !finite(reward.value))) {
      errors.push(`reward ${reward.id}: invalid passive target/value`);
    }
    if (reward.rewardType === 'new_action' && !actionIds.has(reward.targetId)) errors.push(`reward ${reward.id}: missing action ${reward.targetId}`);
    if (reward.rewardType === 'new_condition' && !conditionIds.has(reward.targetId)) errors.push(`reward ${reward.id}: missing condition ${reward.targetId}`);
  }
  return errors;
}

export const GameDatabase = new GameDatabaseClass();
