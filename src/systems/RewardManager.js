// RewardManager.js — builds 3 reward options for the just-won battle.
// Mirrors scripts/systems/RewardManager.gd.

import { GameDatabase } from '../core/GameDatabase.js';
import { GameState } from '../core/GameState.js';
import { entity, t } from '../i18n/I18n.js';

export function buildRewardOptions(battle) {
  const random = GameState.randomFor(`reward:${battle?.id || 'unknown'}:${GameState.currentMapColumn}`);
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
    const j = Math.floor(random() * (i + 1));
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
  const random = GameState.randomFor(`upgrade:${GameState.currentMapColumn}`);
  const passives = GameDatabase.allRewards()
    .filter(r => r.rewardType === 'passive')
    .map(r => r.id);
  for (let i = passives.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [passives[i], passives[j]] = [passives[j], passives[i]];
  }
  return passives.slice(0, Math.min(3, passives.length));
}

// Reward display description helper.
export function rewardDescription(reward) {
  if (reward.rewardType === 'passive') {
    return t(`rewardDesc.${reward.targetId}`, { target: reward.targetId });
  }
  switch (reward.rewardType) {
    case 'new_action': return t('rewardDesc.newAction', { name: entity('action', reward.targetId, reward.targetId) });
    case 'new_condition': return t('rewardDesc.newCondition', { name: entity('condition', reward.targetId, reward.targetId) });
    default: return '';
  }
}

export function rewardDisplayName(reward) {
  if (reward.rewardType === 'passive') return t(`rewardName.${reward.targetId}`);
  if (reward.rewardType === 'new_action') {
    return t('rewardName.newAction', { name: entity('action', reward.targetId, reward.targetId) });
  }
  if (reward.rewardType === 'new_condition') {
    return t('rewardName.newCondition', { name: entity('condition', reward.targetId, reward.targetId) });
  }
  return reward.displayName;
}
