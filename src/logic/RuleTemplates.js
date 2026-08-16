// RuleTemplates.js — curated rule patterns for onboarding and rapid iteration.
// Templates only add missing rules; they never erase a player's current build.

export const RULE_TEMPLATES = Object.freeze([
  Object.freeze({
    id: 'defensive_core',
    nameKey: 'template.defensive.name',
    descriptionKey: 'template.defensive.description',
    rules: Object.freeze([
      Object.freeze({ conditionId: 'hp_low', conditionValue: 0.30, actionId: 'shield', priority: 100 }),
      Object.freeze({ conditionId: 'enemy_nearby', conditionValue: 2.5, actionId: 'dash_away', priority: 70 }),
      Object.freeze({ conditionId: 'enemy_nearby', conditionValue: 8, actionId: 'basic_attack', priority: 10 }),
    ]),
  }),
  Object.freeze({
    id: 'ranged_control',
    nameKey: 'template.ranged.name',
    descriptionKey: 'template.ranged.description',
    rules: Object.freeze([
      Object.freeze({ conditionId: 'projectile_nearby', conditionValue: 2.4, actionId: 'sidestep', priority: 82 }),
      Object.freeze({ conditionId: 'enemy_far', conditionValue: 5, actionId: 'dash_toward', priority: 50 }),
      Object.freeze({ conditionId: 'enemy_nearby', conditionValue: 8, actionId: 'basic_attack', priority: 10 }),
    ]),
  }),
  Object.freeze({
    id: 'interrupt_protocol',
    nameKey: 'template.interrupt.name',
    descriptionKey: 'template.interrupt.description',
    rules: Object.freeze([
      Object.freeze({ conditionId: 'enemy_casting', conditionValue: null, actionId: 'interrupt_shot', priority: 94, targetPriority: 'caster' }),
      Object.freeze({ conditionId: 'hp_low', conditionValue: 0.35, actionId: 'shield', priority: 100 }),
      Object.freeze({ conditionId: 'enemy_nearby', conditionValue: 8, actionId: 'basic_attack', priority: 10 }),
    ]),
  }),
  Object.freeze({
    id: 'overdrive_burst',
    nameKey: 'template.burst.name',
    descriptionKey: 'template.burst.description',
    rules: Object.freeze([
      Object.freeze({ conditionId: 'energy_high', conditionValue: 0.8, actionId: 'overdrive', priority: 78 }),
      Object.freeze({ conditionId: 'enemy_hp_low', conditionValue: 0.25, actionId: 'dash_through', priority: 64, targetPriority: 'lowest_hp' }),
      Object.freeze({ conditionId: 'enemy_nearby', conditionValue: 8, actionId: 'basic_attack', priority: 10 }),
    ]),
  }),
]);

export function ruleTemplateById(id) {
  return RULE_TEMPLATES.find((template) => template.id === id) || null;
}
