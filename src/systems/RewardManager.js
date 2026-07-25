// RewardManager.js — builds 3 reward options for the just-won battle.
// Mirrors scripts/systems/RewardManager.gd.

import { GameDatabase } from '../core/GameDatabase.js';
import { GameState } from '../core/GameState.js';

export function buildRewardOptions(battle) {
  const pool = battle?.rewardPool || [];
  const available = [];
  for (const rid of pool) {
    const r = GameDatabase.getReward(rid);
    if (!r) continue;
    if (r.rewardType === 'new_action' && GameState.unlockedActionIds.includes(r.targetId)) continue;
    if (r.rewardType === 'new_condition' && GameState.unlockedConditionIds.includes(r.targetId)) continue;
    available.push(rid);
  }
  // Ensure at least 1 passive
  let hasPassive = available.some(rid => GameDatabase.getReward(rid).rewardType === 'passive');
  if (!hasPassive) {
    for (const r of GameDatabase.allRewards()) {
      if (r.rewardType === 'passive' && !available.includes(r.id)) {
        available.push(r.id);
        break;
      }
    }
  }
  // Shuffle + take 3, while preserving the design promise that every choice
  // includes at least one broadly useful passive upgrade.
  for (let i = available.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [available[i], available[j]] = [available[j], available[i]];
  }
  const selected = available.slice(0, Math.min(3, available.length));
  if (hasPassive && !selected.some(rid => GameDatabase.getReward(rid)?.rewardType === 'passive')) {
    const guaranteedPassive = available.find(rid => GameDatabase.getReward(rid)?.rewardType === 'passive');
    if (guaranteedPassive) selected[selected.length - 1] = guaranteedPassive;
  }
  return [...new Set(selected)];
}

export function buildUpgradeOptions() {
  const passives = GameDatabase.allRewards()
    .filter(r => r.rewardType === 'passive')
    .map(r => r.id);
  for (let i = passives.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [passives[i], passives[j]] = [passives[j], passives[i]];
  }
  return passives.slice(0, Math.min(3, passives.length));
}

// Reward display description helper.
export function rewardDescription(reward) {
  if (reward.rewardType === 'passive') {
    switch (reward.targetId) {
      case 'max_hp': return `Increase Maximum Hull HP by +20.`;
      case 'max_energy': return `Increase Maximum Energy capacity by +30.`;
      case 'energy_regen': return `Boost Energy Regeneration speed by +20%.`;
      case 'basic_dmg': return `Increase basic laser cannon damage by +25%.`;
      case 'move_speed': return `Increase movement speed by +0.5 m/s.`;
      case 'dash_cd': return `Reduce Dash cooldown by -20%.`;
      case 'shield_cd': return `Reduce Shield cooldown by -20%.`;
      case 'shield_dur': return `Extend Shield forcefield duration by +1.0s.`;
      case 'overdrive_dur': return `Extend Overdrive matrix duration by +2.0s.`;
      case 'interrupt_cd': return `Reduce Interrupt Shot cooldown by -25%.`;
      case 'reflective_plating': return `Reflect 50% of damage back to enemies when Shield is active.`;
      case 'nanite_repair': return `Self-repair hull at a rate of 2.5 HP per second in combat.`;
      case 'superconductors': return `Double Energy Regeneration speed when CPU temperature is above 50°C.`;
      case 'emergency_recall': return `Survive fatal hits with 30 HP and auto-dash away once per run.`;
      case 'heavy_impact': return `Basic attacks have a 25% chance to stun enemy targets for 0.8s.`;
      case 'thermal_recycle': return `Executing logic rules during core Meltdown cools down CPU by -10°C.`;
      case 'armor_piercing': return `Ignore 3 points of enemy flat armor mitigation with all attacks.`;
      default: return `Permanent stat upgrade (${reward.targetId})`;
    }
  }
  switch (reward.rewardType) {
    case 'new_action': return `Unlock new action module: ${reward.targetId}`;
    case 'new_condition': return `Unlock new condition module: ${reward.targetId}`;
    default: return '';
  }
}
