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

export const GameDatabase = new GameDatabaseClass();
