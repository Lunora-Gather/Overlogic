// OperationsConfig.js — versioned, content-safe live-operations manifest.
//
// This is intentionally a small, deterministic boundary between shipped
// content and future remote operations services. The static manifest can be
// changed through the normal reviewed release path today; a backend can later
// provide the same shape without making gameplay trust unvalidated input.

import { recordRuntimeError } from './RuntimeDiagnostics.js?v=20260725-4';

const MANIFEST_URL = 'data/operations.json?v=20260725-4';
const FEATURE_KEYS = Object.freeze([
  'dailyChallenges', 'weeklyGauntlet', 'sandbox', 'ruleTemplates', 'shieldRelay',
]);

function freezeDeep(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) freezeDeep(child);
  return Object.freeze(value);
}

function safeId(value, fallback) {
  return /^[a-z0-9_]{2,48}$/.test(String(value || '')) ? String(value) : fallback;
}

function boundedInt(value, fallback, min, max) {
  const numeric = Number(value);
  if (!Number.isSafeInteger(numeric)) return fallback;
  return Math.max(min, Math.min(max, numeric));
}

const DEFAULT_OPERATIONS = freezeDeep({
  schemaVersion: 1,
  source: 'default',
  season: { id: 'foundry_protocol', labelKey: 'ops.seasonFoundry' },
  features: {
    dailyChallenges: true,
    weeklyGauntlet: true,
    sandbox: true,
    ruleTemplates: true,
    shieldRelay: true,
  },
  maintenance: { enabled: false },
  limits: { recentBattles: 4, archiveEntries: 60, supportErrors: 20 },
});

let activeConfig = DEFAULT_OPERATIONS;
let loaded = false;

export function normalizeOperationsConfig(raw, source = 'manifest') {
  const input = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const features = {};
  for (const key of FEATURE_KEYS) features[key] = input.features?.[key] !== false;
  return freezeDeep({
    schemaVersion: 1,
    source: source === 'manifest' ? 'manifest' : 'default',
    season: {
      id: safeId(input.season?.id, DEFAULT_OPERATIONS.season.id),
      labelKey: input.season?.labelKey === 'ops.seasonFoundry'
        ? input.season.labelKey : DEFAULT_OPERATIONS.season.labelKey,
    },
    features,
    maintenance: { enabled: input.maintenance?.enabled === true },
    limits: {
      recentBattles: boundedInt(input.limits?.recentBattles, 4, 1, 12),
      archiveEntries: boundedInt(input.limits?.archiveEntries, 60, 12, 240),
      supportErrors: boundedInt(input.limits?.supportErrors, 20, 5, 50),
    },
  });
}

export async function loadOperationsConfig({ fetcher = globalThis.fetch } = {}) {
  if (loaded) return activeConfig;
  loaded = true;
  if (typeof fetcher !== 'function') return activeConfig;
  try {
    const response = await fetcher(MANIFEST_URL, { cache: 'no-store' });
    if (response?.ok === false) throw new Error(`HTTP ${response.status} while loading operations manifest`);
    activeConfig = normalizeOperationsConfig(await response.json(), 'manifest');
  } catch (error) {
    activeConfig = DEFAULT_OPERATIONS;
    recordRuntimeError(error, 'operations-config');
  }
  return activeConfig;
}

export function operationsConfig() { return activeConfig; }

export function featureEnabled(feature) {
  return activeConfig.features[feature] === true;
}

export function operationLimit(name, fallback = 0) {
  const value = activeConfig.limits?.[name];
  return Number.isSafeInteger(value) && value >= 0 ? value : fallback;
}

export function operationsSnapshot() {
  return JSON.parse(JSON.stringify(activeConfig));
}

// Test-only reset keeps the production surface deterministic while allowing
// contract tests to exercise a second manifest load in the same Node process.
export function resetOperationsConfigForTests() {
  activeConfig = DEFAULT_OPERATIONS;
  loaded = false;
}
