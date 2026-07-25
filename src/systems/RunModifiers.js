const MODIFIERS = {
  casual: { enemyHp: 0.84, enemyDamage: 0.82 },
  standard: { enemyHp: 1, enemyDamage: 1 },
  veteran: { enemyHp: 1.22, enemyDamage: 1.15 },
};

export function difficultyModifiers(difficulty = 'standard') {
  return MODIFIERS[difficulty] || MODIFIERS.standard;
}
