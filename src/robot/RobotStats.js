// RobotStats.js — reads base stats from GameState.stats, exposes computed per-action
// cooldowns/effect values so passive upgrades + overdrive + overlogic apply uniformly.
// Mirrors scripts/robot/RobotStats.gd.

import { GameDatabase } from '../core/GameDatabase.js?v=20260725-4';

export class RobotStats {
  constructor() { this.base = {}; }
  loadFromGameState() {
    this.base = { ...GameState.stats };
    // Track persistent HP for carry-over
    this.startingHp = GameState.persistentHp; // null means full HP
  }
  stat(key, def = 0) { return this.base[key] !== undefined ? this.base[key] : def; }

  // Per-action effective cooldown (after passives + overdrive + overlogic).
  actionCooldown(actionId, robotRef) {
    const baseCd = this._baseCd(actionId);
    let mul = 1;
    if (robotRef) {
      mul *= robotRef.overdriveAtkSpeedMul();
      const ov = robotRef.ctx && robotRef.ctx.overlogic;
      if (ov) {
        if (actionId === 'basic_attack' || actionId === 'interrupt_shot') {
          mul *= 1 / ov.atkCdMul();
        } else {
          mul *= 1 / ov.skillCdMul();
        }
      }
    }
    if (mul < 0.01) mul = 0.01;
    return baseCd / mul;
  }

  _baseCd(actionId) {
    switch (actionId) {
      case 'basic_attack':    return this.base.basic_cd;
      case 'dash_toward':
      case 'dash_away':       return this.base.dash_cd;
      case 'sidestep':        return GameDatabase.getAction('sidestep')?.cooldown || 2.5;
      case 'shield':          return this.base.shield_cd;
      case 'interrupt_shot':  return this.base.interrupt_cd;
      case 'overdrive':       return this.base.overdrive_cd;
      case 'repair':          return GameDatabase.getAction('repair')?.cooldown || 12;
      case 'drop_mine':       return GameDatabase.getAction('drop_mine')?.cooldown || 6;
      case 'emp_burst':       return GameDatabase.getAction('emp_burst')?.cooldown || 12;
      case 'energy_transfer': return GameDatabase.getAction('energy_transfer')?.cooldown || 10;
      case 'dash_through':    return GameDatabase.getAction('dash_through')?.cooldown || 5;
      default: return 1;
    }
  }

  actionEnergyCost(actionId) { return GameDatabase.getAction(actionId)?.energyCost || 0; }
  actionRange(actionId)      { return GameDatabase.getAction(actionId)?.range || 0; }
  basicDamage()              { return this.base.basic_dmg; }
}

// Late import to avoid circular (GameState used only at loadFromGameState call time).
import { GameState } from '../core/GameState.js?v=20260725-4';
