// CombatStatsTracker.js — per-battle statistics for the post-battle report.
// Mirrors scripts/systems/CombatStatsTracker.gd. Pure class.

export class CombatStatsTracker {
  constructor() {
    this.damageBySource = new Map();   // sourceKind -> float
    this.damageDealtByKind = new Map();
    this.totalDamageDealt = 0;
    this.actionUsage = new Map();      // actionId -> int
    this.ruleUsage = new Map();
    this.ruleDiagnostics = new Map();
    this.activeRuleIds = [];
    this.actionLastUsedTime = new Map();
    this.interruptSuccesses = 0;
    this.castingEventsSeen = 0;
    this.castingEventsInterrupted = 0;
    this.shieldActivatedAtHp = -1;
    this.energyOverflowTime = 0;
    this.battleTime = 0;
    this.deathHp = 0;
    this.deathEnergy = 0;
    this.deathNearbyEnemyCount = 0;
    this.lowHpKills = 0;
    this.enemyKills = new Map();
    this.enemyRepairs = new Map();
    this.enemyShields = new Map();
    this.enemyShieldMitigation = new Map();
    this.timeline = [];
    this._lastDamageEventAt = -Infinity;
  }

  recordDamageTaken(amount, source) {
    this.damageBySource.set(source, (this.damageBySource.get(source) || 0) + amount);
    // Coalesce rapid damage ticks so the report remains readable.
    const latest = this.timeline[this.timeline.length - 1];
    if (latest?.kind === 'damage' && latest.source === source && this.battleTime - this._lastDamageEventAt < 0.65) {
      latest.value += amount;
      latest.time = this.battleTime;
    } else {
      this._pushTimeline({ kind: 'damage', source, value: amount });
    }
    this._lastDamageEventAt = this.battleTime;
  }
  recordDamageDealt(amount, kind) {
    this.totalDamageDealt += amount;
    this.damageDealtByKind.set(kind, (this.damageDealtByKind.get(kind) || 0) + amount);
  }
  setRuleSnapshot(rules) {
    this.activeRuleIds = (rules || []).filter(rule => rule.enabled !== false).map(rule => rule.id);
  }
  recordAction(actionId, ruleId = null) {
    this.actionUsage.set(actionId, (this.actionUsage.get(actionId) || 0) + 1);
    this.actionLastUsedTime.set(actionId, this.battleTime);
    if (ruleId) this.ruleUsage.set(ruleId, (this.ruleUsage.get(ruleId) || 0) + 1);
    this._pushTimeline({ kind: 'action', actionId, ruleId });
  }
  recordDiagnostics(diagnostics) {
    if (!diagnostics) return;
    for (const [ruleId, state] of Object.entries(diagnostics)) {
      if (!this.ruleDiagnostics.has(ruleId)) this.ruleDiagnostics.set(ruleId, {});
      const counts = this.ruleDiagnostics.get(ruleId);
      counts[state] = (counts[state] || 0) + 1;
    }
  }
  recordEnergyOverflow(dt) { this.energyOverflowTime += dt; }
  recordInterruptSuccess() {
    this.interruptSuccesses += 1;
    this.castingEventsInterrupted += 1;
    this._pushTimeline({ kind: 'interrupt' });
  }
  recordCastingSeen() { this.castingEventsSeen += 1; }
  recordShieldActivated(hpPct) { this.shieldActivatedAtHp = hpPct; }   // latest activation wins
  recordLowHpKill() { this.lowHpKills += 1; }
  recordEnemyDeath(enemyId) {
    if (!enemyId) return;
    this.enemyKills.set(enemyId, (this.enemyKills.get(enemyId) || 0) + 1);
  }
  recordEnemyRepair(enemyId, amount) {
    if (!enemyId || !Number.isFinite(amount) || amount <= 0) return;
    this.enemyRepairs.set(enemyId, (this.enemyRepairs.get(enemyId) || 0) + amount);
    this._pushTimeline({ kind: 'enemy_repair', source: enemyId, value: amount });
  }
  recordEnemyShield(enemyId, duration) {
    if (!enemyId || !Number.isFinite(duration) || duration <= 0) return;
    const current = this.enemyShields.get(enemyId) || { casts: 0, duration: 0 };
    current.casts += 1;
    current.duration += duration;
    this.enemyShields.set(enemyId, current);
    this._pushTimeline({ kind: 'enemy_shield', source: enemyId, value: duration });
  }
  recordEnemyShieldMitigation(enemyId, amount) {
    if (!enemyId || !Number.isFinite(amount) || amount <= 0) return;
    this.enemyShieldMitigation.set(enemyId, (this.enemyShieldMitigation.get(enemyId) || 0) + amount);
  }
  recordWave(wave, total) { this._pushTimeline({ kind: 'wave', wave, total }); }
  recordRecall() { this._pushTimeline({ kind: 'recall' }); }
  _pushTimeline(event) {
    this.timeline.push({ time: this.battleTime, ...event });
    if (this.timeline.length > 40) this.timeline.shift();
  }
  tick(dt) { this.battleTime += dt; }
  snapshotDeath(hp, energy, nearby) {
    this.deathHp = hp; this.deathEnergy = energy; this.deathNearbyEnemyCount = nearby;
  }

  toReport() {
    return {
      damage_by_source: Object.fromEntries(this.damageBySource),
      damage_dealt_by_kind: Object.fromEntries(this.damageDealtByKind),
      total_damage_dealt: this.totalDamageDealt,
      action_usage: Object.fromEntries(this.actionUsage),
      rule_usage: Object.fromEntries(this.ruleUsage),
      rule_diagnostics: Object.fromEntries(this.ruleDiagnostics),
      active_rule_ids: this.activeRuleIds,
      action_last_used_time: Object.fromEntries(this.actionLastUsedTime),
      interrupt_successes: this.interruptSuccesses,
      interrupt_misses: Math.max(0, this.castingEventsSeen - this.castingEventsInterrupted),
      shield_activated_at_hp: this.shieldActivatedAtHp,
      energy_overflow_time: this.energyOverflowTime,
      battle_time: this.battleTime,
      death_hp: this.deathHp,
      death_energy: this.deathEnergy,
      death_nearby_enemy_count: this.deathNearbyEnemyCount,
      low_hp_kills: this.lowHpKills,
      enemy_kills: Object.fromEntries(this.enemyKills),
      enemy_repairs: Object.fromEntries(this.enemyRepairs),
      enemy_shields: Object.fromEntries(this.enemyShields),
      enemy_shield_mitigation: Object.fromEntries(this.enemyShieldMitigation),
      timeline: this.timeline,
    };
  }
}
