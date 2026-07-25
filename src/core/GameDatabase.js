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
  }

  async loadAll() {
    if (this._loaded) return;
    const [c, a, e, b, r] = await Promise.all([
      fetch('data/conditions.json?v=20260725-3').then(r => r.json()),
      fetch('data/actions.json?v=20260725-3').then(r => r.json()),
      fetch('data/enemies.json?v=20260725-3').then(r => r.json()),
      fetch('data/battles.json?v=20260725-3').then(r => r.json()),
      fetch('data/rewards.json?v=20260725-3').then(r => r.json()),
    ]);
    for (const x of c.conditions) this.conditions.set(x.id, x);
    for (const x of a.actions) this.actions.set(x.id, x);
    for (const x of e.enemies) this.enemies.set(x.id, x);
    this.battles = b.battles;
    for (const x of r.rewards) this.rewards.set(x.id, x);
    this._loaded = true;
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
