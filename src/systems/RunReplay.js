// RunReplay.js — bounded deterministic event digests for future replay and
// server verification. The digest is an integrity hint, never a trust
// boundary: a client can still forge both events and the digest.

export const REPLAY_VERSION = 1;
export const MAX_REPLAY_EVENTS = 6000;

function fnv1a(input) {
  let hash = 2166136261;
  for (const char of input) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function safeText(value, fallback = '') {
  const text = String(value ?? fallback);
  return /^[A-Za-z0-9:_./-]{0,80}$/.test(text) ? text : fallback;
}

function safeNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.round(number * 1000) / 1000 : fallback;
}

function canonicalEvent(event = {}) {
  return [
    safeNumber(event.time),
    safeText(event.kind, 'unknown'),
    safeText(event.actionId),
    safeText(event.ruleId),
    safeText(event.source),
    safeText(event.enemyId),
    safeNumber(event.value),
    safeNumber(event.wave),
    safeNumber(event.total),
  ].join(':');
}

export function replayDigest(events = [], meta = {}) {
  const source = Array.isArray(events) ? events.slice(0, MAX_REPLAY_EVENTS) : [];
  const canonical = [
    `r${REPLAY_VERSION}`,
    safeText(meta.battleId, 'unknown'),
    safeNumber(meta.seed, 0),
    safeNumber(meta.simulationVersion, 1),
    safeNumber(meta.simulationStep, 1 / 60),
    ...source.map(canonicalEvent),
  ].join('|');
  return `RPL${REPLAY_VERSION}-${fnv1a(canonical).toString(16).padStart(8, '0').toUpperCase()}`;
}

export function combineReplayDigests(digests = []) {
  const source = Array.isArray(digests)
    ? digests.filter((digest) => /^RPL\d+-[0-9A-F]{8}$/.test(String(digest))).slice(-12)
    : [];
  return replayDigest(source.map((digest, index) => ({ kind: 'battle', ruleId: `${index}:${digest}` })));
}

