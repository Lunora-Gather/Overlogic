export const CAMPAIGN_SEED = 136;

export function campaignRoute(difficulty) {
  // Shared by the engine and Safari tests so both use the same real offers.
  return [
    ['0_start', 'battle_1', 'pu_basic_dmg'],
    ['1_a', 'battle_2', 'new_action_repair'],
    ['2_a', 'battle_4', 'pu_heavy_impact'],
    ['3_b'],
    ['4_a', 'battle_7', 'pu_emergency_recall'],
    ['5_upgrade', null, 'pu_basic_dmg'],
    ['6_boss', 'battle_9', 'pu_max_hp'],
    difficulty === 'standard'
      ? ['7_null', 'battle_12', 'pu_basic_dmg']
      : ['7_relay', 'battle_11', 'pu_armor_piercing'],
    ['8_singularity', 'battle_13'],
  ];
}
