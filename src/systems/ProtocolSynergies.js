// ProtocolSynergies.js — pure build-composition rules.
// Keeping synergy discovery here makes UI previews and combat effects agree.

export const PROTOCOL_SYNERGIES = Object.freeze([
  {
    id: 'bastion_loop',
    requires: [
      { kind: 'stat', id: 'reflective_plating', min: 0.01 },
      { kind: 'stat', id: 'shield_dur', min: 3 },
    ],
  },
  {
    id: 'kinetic_breach',
    requires: [
      { kind: 'stat', id: 'heavy_impact', min: 0.01 },
      { kind: 'action', id: 'dash_through' },
    ],
  },
  {
    id: 'phoenix_mesh',
    requires: [
      { kind: 'stat', id: 'emergency_recall', min: 0.01 },
      { kind: 'stat', id: 'nanite_repair', min: 0.01 },
    ],
  },
  {
    id: 'thermal_grid',
    requires: [
      { kind: 'stat', id: 'superconductors', min: 0.01 },
      { kind: 'stat', id: 'thermal_recycle', min: 0.01 },
    ],
  },
]);

function requirementMet(requirement, build) {
  if (requirement.kind === 'action') {
    return (build.unlockedActionIds || []).includes(requirement.id);
  }
  return Number(build.stats?.[requirement.id] || 0) >= requirement.min;
}

export function synergyState(build) {
  return PROTOCOL_SYNERGIES.map((synergy) => {
    const met = synergy.requires.filter((requirement) => requirementMet(requirement, build));
    return {
      ...synergy,
      active: met.length === synergy.requires.length,
      progress: met.length,
      missing: synergy.requires.filter((requirement) => !requirementMet(requirement, build)),
    };
  });
}

export function activeSynergyIds(build) {
  return new Set(synergyState(build).filter((synergy) => synergy.active).map((synergy) => synergy.id));
}

export function hasSynergy(build, id) {
  return activeSynergyIds(build).has(id);
}
