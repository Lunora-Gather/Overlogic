// SaveMigrations.js — explicit, pure run-save envelope migrations.
//
// Gameplay normalization still belongs to GameState because it depends on
// the current content database. This module owns only version-to-version
// shape changes, so future releases can add a migration without burying it
// inside the runtime validation path.

export const CURRENT_SAVE_VERSION = 7;

function ensureObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function ensureArray(value) {
  return Array.isArray(value) ? value : [];
}

export function migrateRunSave(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { data: input, fromVersion: null, changed: false, unsupported: true, steps: [] };
  }
  const rawVersion = Number(input.saveVersion);
  const fromVersion = Number.isSafeInteger(rawVersion) && rawVersion > 0 ? rawVersion : 1;
  if (fromVersion > CURRENT_SAVE_VERSION) {
    return { data: input, fromVersion, changed: false, unsupported: true, steps: [] };
  }

  let data = { ...input };
  let version = fromVersion;
  const steps = [];
  while (version < CURRENT_SAVE_VERSION) {
    switch (version) {
      case 1:
        data = {
          ...data,
          mapNodes: ensureArray(data.mapNodes),
          stats: ensureObject(data.stats),
          rules: ensureArray(data.rules),
        };
        break;
      case 2:
        data = {
          ...data,
          runConfig: ensureObject(data.runConfig),
          tutorialProgress: ensureObject(data.tutorialProgress),
        };
        break;
      case 3:
        data = { ...data, _ruleCounter: Number.isSafeInteger(data._ruleCounter) ? data._ruleCounter : 0 };
        break;
      case 4:
        data = {
          ...data,
          runStats: ensureObject(data.runStats),
          lastReport: ensureObject(data.lastReport),
        };
        break;
      case 5:
        data = {
          ...data,
          runConfig: { ...ensureObject(data.runConfig), seed: data.runConfig?.seed ?? null },
        };
        break;
      case 6:
        data = {
          ...data,
          runStats: { ...ensureObject(data.runStats), replayDigests: ensureArray(data.runStats?.replayDigests) },
          lastReport: { ...ensureObject(data.lastReport), replay_events: ensureArray(data.lastReport?.replay_events) },
        };
        break;
      default:
        break;
    }
    const nextVersion = version + 1;
    steps.push(`${version}->${nextVersion}`);
    version = nextVersion;
  }
  if (data.saveVersion !== CURRENT_SAVE_VERSION) data = { ...data, saveVersion: CURRENT_SAVE_VERSION };
  return { data, fromVersion, changed: steps.length > 0, unsupported: false, steps };
}
