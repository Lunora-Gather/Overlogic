// RunVerification.js — deterministic client-side run receipt.
//
// The receipt is a shareable integrity hint, not an anti-cheat boundary. A
// future server can recompute the same canonical facts after validating a
// replay or signed event stream.

const RECEIPT_VERSION = 1;

function cleanText(value, fallback = '') {
  const text = String(value ?? fallback);
  return /^[A-Za-z0-9_-]{0,32}$/.test(text) ? text : fallback;
}

function cleanNumber(value, min = 0, max = 1_000_000_000) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return min;
  return Math.max(min, Math.min(max, numeric));
}

function fnv1a(input) {
  let hash = 2166136261;
  for (const char of input) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function canonicalRunFacts(entry = {}) {
  return [
    `v${RECEIPT_VERSION}`,
    cleanText(entry.mode, 'standard'),
    cleanText(entry.difficulty, 'standard'),
    Math.floor(cleanNumber(entry.seed, 1, 0xffffffff)),
    Math.floor(cleanNumber(entry.battlesWon, 0, 99)),
    Math.round(cleanNumber(entry.totalDamageDealt)),
    Math.round(cleanNumber(entry.totalBattleTime, 0, 86_400) * 100) / 100,
    Math.round(cleanNumber(entry.finalHp, 0, 1_000_000) * 10) / 10,
    Math.floor(cleanNumber(entry.rulesCount, 0, 40)),
    Math.floor(cleanNumber(entry.upgrades, 0, 99)),
  ].join('|');
}

export function runReceipt(entry = {}) {
  const hash = fnv1a(canonicalRunFacts(entry));
  return `OLR${RECEIPT_VERSION}-${hash.toString(16).padStart(8, '0').toUpperCase()}`;
}

