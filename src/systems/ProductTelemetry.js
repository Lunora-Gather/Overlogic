// ProductTelemetry.js — explicit-consent, local-only product metrics.
//
// Events are stored only in this browser and are never transmitted. The
// bounded, whitelisted shape can later feed an authenticated analytics adapter
// without exposing rule codes, challenge seeds, file paths, or user identity.

import { recordStorageError } from './RuntimeDiagnostics.js?v=20260725-4';

const METRICS_KEY = 'overlogic_product_metrics';
const METRICS_VERSION = 1;
const MAX_RECENT = 40;
const EVENT_NAMES = new Set([
  'app_boot', 'run_started', 'battle_started', 'battle_finished',
  'sandbox_started', 'rule_template_applied', 'run_completed',
]);
const PROPERTY_KEYS = new Set([
  'mode', 'difficulty', 'battleId', 'won', 'sandbox', 'added', 'source', 'durationBucket',
]);

let enabled = false;

function emptyState() {
  return { version: METRICS_VERSION, counts: {}, recent: [] };
}

function safeText(value) {
  const text = String(value || '').slice(0, 48);
  return /^[A-Za-z0-9_.:-]*$/.test(text) ? text : '';
}

function sanitizeProperties(properties) {
  const safe = {};
  if (!properties || typeof properties !== 'object' || Array.isArray(properties)) return safe;
  for (const [key, value] of Object.entries(properties)) {
    if (!PROPERTY_KEYS.has(key)) continue;
    if (typeof value === 'boolean') safe[key] = value;
    else if (typeof value === 'number' && Number.isFinite(value)) safe[key] = Math.max(0, Math.min(100, Math.round(value)));
    else if (typeof value === 'string') {
      const text = safeText(value);
      if (text) safe[key] = text;
    }
  }
  return safe;
}

function normalizeState(raw) {
  const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const counts = {};
  for (const [name, value] of Object.entries(source.counts || {})) {
    if (!EVENT_NAMES.has(name)) continue;
    const count = Number(value);
    if (Number.isFinite(count)) counts[name] = Math.max(0, Math.min(1_000_000, Math.floor(count)));
  }
  const recent = Array.isArray(source.recent) ? source.recent
    .filter((entry) => entry && EVENT_NAMES.has(entry.name) && typeof entry.at === 'string')
    .slice(0, MAX_RECENT)
    .map((entry) => ({
      name: entry.name,
      at: entry.at.slice(0, 32),
      properties: sanitizeProperties(entry.properties),
    })) : [];
  return { version: METRICS_VERSION, counts, recent };
}

function readState() {
  try {
    const raw = localStorage.getItem(METRICS_KEY);
    return normalizeState(raw ? JSON.parse(raw) : null);
  } catch (error) {
    recordStorageError(error, 'product-metrics-read');
    return emptyState();
  }
}

function writeState(state) {
  try {
    localStorage.setItem(METRICS_KEY, JSON.stringify(normalizeState(state)));
    return true;
  } catch (error) {
    recordStorageError(error, 'product-metrics');
    return false;
  }
}

export function configureProductMetrics(nextEnabled) {
  enabled = nextEnabled === true;
  if (!enabled) clearProductMetrics();
  return enabled;
}

export function recordProductEvent(name, properties = {}) {
  if (!enabled || !EVENT_NAMES.has(name)) return false;
  const state = readState();
  state.counts[name] = Math.min(1_000_000, (state.counts[name] || 0) + 1);
  state.recent.unshift({
    name,
    at: new Date().toISOString(),
    properties: sanitizeProperties(properties),
  });
  state.recent = state.recent.slice(0, MAX_RECENT);
  return writeState(state);
}

export function productMetricsSnapshot() {
  const state = enabled ? readState() : emptyState();
  return { enabled, ...state };
}

export function clearProductMetrics() {
  try {
    localStorage.removeItem(METRICS_KEY);
    return true;
  } catch (error) {
    recordStorageError(error, 'product-metrics-clear');
    return false;
  }
}

export function durationBucket(seconds) {
  const value = Math.max(0, Number(seconds) || 0);
  if (value < 10) return 'under_10';
  if (value < 30) return '10_29';
  if (value < 60) return '30_59';
  return '60_plus';
}

