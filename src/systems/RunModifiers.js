const MODIFIERS = {
  casual: { enemyHp: 0.84, enemyDamage: 0.82 },
  standard: { enemyHp: 1, enemyDamage: 1 },
  veteran: { enemyHp: 1.22, enemyDamage: 1.15 },
};

// Daily protocols are deliberately small, legible trade-offs rather than
// hidden difficulty spikes. The seed selects one protocol for the entire day,
// so players can share builds and compare solutions against the same ruleset.
const DAILY_PROTOCOLS = Object.freeze([
  Object.freeze({
    id: 'signal_surge',
    titleKey: 'dailyProtocol.signalSurge.title',
    descriptionKey: 'dailyProtocol.signalSurge.description',
    enemyHp: 1,
    enemyDamage: 1.08,
    enemySpeed: 1.08,
    robotEnergyRegen: 1.12,
  }),
  Object.freeze({
    id: 'glass_circuit',
    titleKey: 'dailyProtocol.glassCircuit.title',
    descriptionKey: 'dailyProtocol.glassCircuit.description',
    enemyHp: 0.9,
    enemyDamage: 1.16,
    enemySpeed: 1,
    robotMoveSpeed: 1.08,
    robotEnergyRegen: 1,
  }),
  Object.freeze({
    id: 'fortified_relay',
    titleKey: 'dailyProtocol.fortifiedRelay.title',
    descriptionKey: 'dailyProtocol.fortifiedRelay.description',
    enemyHp: 1.12,
    enemyDamage: 0.96,
    enemySpeed: 0.96,
    robotEnergyRegen: 1.2,
  }),
]);

// Weekly protocols are broader campaign-level trade-offs. They rotate on the
// UTC ISO week and deliberately remain deterministic so players can compare
// builds without a server deciding hidden combat values.
const WEEKLY_PROTOCOLS = Object.freeze([
  Object.freeze({
    id: 'pursuit_matrix',
    titleKey: 'weeklyProtocol.pursuitMatrix.title',
    descriptionKey: 'weeklyProtocol.pursuitMatrix.description',
    enemyHp: 1.06,
    enemyDamage: 1.1,
    enemySpeed: 1.12,
    robotMoveSpeed: 1.1,
    robotEnergyRegen: 1.08,
  }),
  Object.freeze({
    id: 'siege_relay',
    titleKey: 'weeklyProtocol.siegeRelay.title',
    descriptionKey: 'weeklyProtocol.siegeRelay.description',
    enemyHp: 1.18,
    enemyDamage: 0.96,
    enemySpeed: 0.94,
    robotMoveSpeed: 1,
    robotEnergyRegen: 1.22,
  }),
  Object.freeze({
    id: 'volatile_mesh',
    titleKey: 'weeklyProtocol.volatileMesh.title',
    descriptionKey: 'weeklyProtocol.volatileMesh.description',
    enemyHp: 0.88,
    enemyDamage: 1.2,
    enemySpeed: 1.06,
    robotMoveSpeed: 1.08,
    robotEnergyRegen: 1.12,
  }),
]);

export function difficultyModifiers(difficulty = 'standard') {
  return MODIFIERS[difficulty] || MODIFIERS.standard;
}

export function dailyProtocol(seed) {
  const numericSeed = Number(seed);
  if (!Number.isSafeInteger(numericSeed) || numericSeed <= 0) return null;
  return DAILY_PROTOCOLS[numericSeed % DAILY_PROTOCOLS.length];
}

export function weeklyProtocol(seed) {
  const numericSeed = Number(seed);
  if (!Number.isSafeInteger(numericSeed) || numericSeed <= 0) return null;
  return WEEKLY_PROTOCOLS[numericSeed % WEEKLY_PROTOCOLS.length];
}

export function runModifiers({ difficulty = 'standard', mode = 'standard', seed = null } = {}) {
  const difficultyModifier = difficultyModifiers(difficulty);
  const protocol = mode === 'daily'
    ? dailyProtocol(seed)
    : (mode === 'weekly' ? weeklyProtocol(seed) : null);
  return {
    enemyHp: difficultyModifier.enemyHp * (protocol?.enemyHp ?? 1),
    enemyDamage: difficultyModifier.enemyDamage * (protocol?.enemyDamage ?? 1),
    enemySpeed: protocol?.enemySpeed ?? 1,
    robotMoveSpeed: protocol?.robotMoveSpeed ?? 1,
    robotEnergyRegen: protocol?.robotEnergyRegen ?? 1,
    protocol,
  };
}

export function dailyProtocolCatalog() {
  return DAILY_PROTOCOLS.map((protocol) => ({ ...protocol }));
}

export function weeklyProtocolCatalog() {
  return WEEKLY_PROTOCOLS.map((protocol) => ({ ...protocol }));
}
