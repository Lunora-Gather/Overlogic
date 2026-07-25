// OverlogicSystem.js — tracks Overlogic value and active state.
// Mirrors scripts/systems/OverlogicSystem.gd. Pure class.

const THRESHOLD = 85;
const ACTIVE_OFF = 35;
const DECAY_RATE = 3;            // /s in combat
const DECAY_RATE_OOC = 10;      // /s out of combat
const ACTIVE_DECAY_RATE = 9;     // high-risk burst, then a predictable recovery window
const MAX_VAL = 100;

export class OverlogicSystem {
  constructor() {
    this.value = 0;
    this.active = false;
  }

  addEvent(kind, amount) {
    this.value = clamp(this.value + amount, 0, MAX_VAL);
    this._checkState();
  }

  addKillAtLowHp(killedAtHpPct) {
    if (killedAtHpPct < 0.20) this.addEvent('low_hp_kill', 12);
  }

  tick(dt, inCombat) {
    const rate = inCombat ? (this.active ? ACTIVE_DECAY_RATE : DECAY_RATE) : DECAY_RATE_OOC;
    this.value = clamp(this.value - rate * dt, 0, MAX_VAL);
    this._checkState();
  }

  _checkState() {
    if (!this.active && this.value >= THRESHOLD) this.active = true;
    else if (this.active && this.value <= ACTIVE_OFF) this.active = false;
  }

  atkCdMul()   { return this.active ? 0.5 : 1; }   // 0.5 means double speed (1/0.5 = 2x)
  skillCdMul() { return this.active ? 0.5 : 1; }
}

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
