// RunHistory.js — local, privacy-preserving run telemetry for replay and UX.
// This is intentionally local-only: it gives players a useful history without
// silently sending gameplay data anywhere. A future online service can consume
// the same normalized record shape behind explicit consent.

import { recordProfileBattle } from './ProfileProgression.js?v=20260725-4';
import { recordChallengeBattle } from './LiveChallenges.js?v=20260725-4';
import { recordStorageError } from './RuntimeDiagnostics.js?v=20260725-4';

const HISTORY_KEY = 'overlogic_run_history';
const MAX_ENTRIES = 60;

function cleanNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function readHistory() {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((entry) => entry && typeof entry === 'object' && !Array.isArray(entry))
      .slice(0, MAX_ENTRIES)
      .map(normalizeHistoryEntry);
  } catch (error) {
    recordStorageError(error, 'run-history-read');
    return [];
  }
}

function writeHistory(entries) {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(entries.slice(0, MAX_ENTRIES)));
    return true;
  } catch (error) {
    recordStorageError(error, 'run-history');
    return false;
  }
}

function normalizeHistoryEntry(entry = {}) {
  const safeId = /^[A-Za-z0-9_-]{1,80}$/.test(String(entry.id || ''))
    ? String(entry.id)
    : `${Date.now().toString(36)}-imported`;
  const timestamp = new Date(entry.timestamp);
  const safeTimestamp = Number.isNaN(timestamp.getTime()) ? new Date().toISOString() : timestamp.toISOString();
  const battleId = /^[A-Za-z0-9_-]{1,64}$/.test(String(entry.battleId || ''))
    ? String(entry.battleId)
    : 'unknown';
  const seed = cleanNumber(entry.seed, 0);
  return {
    id: safeId,
    timestamp: safeTimestamp,
    battleId,
    seed: Number.isSafeInteger(seed) && seed >= 0 && seed <= 0xffffffff ? seed : 0,
    mode: ['daily', 'weekly'].includes(entry.mode) ? entry.mode : 'standard',
    difficulty: ['casual', 'standard', 'veteran'].includes(entry.difficulty) ? entry.difficulty : 'standard',
    won: entry.won === true,
    battleTime: Math.max(0, Math.min(3600, Number(cleanNumber(entry.battleTime, 0).toFixed(2)))),
    finalHp: Math.max(0, Math.min(1_000_000, Number(cleanNumber(entry.finalHp, 0).toFixed(1)))),
    damageDealt: Math.max(0, Math.min(1_000_000_000, Math.round(cleanNumber(entry.damageDealt, 0)))),
    damageTaken: Math.max(0, Math.min(1_000_000_000, Math.round(cleanNumber(entry.damageTaken, 0)))),
  };
}

export function recordBattle(report = {}) {
  if (report._sandbox === true) return null;
  const entry = normalizeHistoryEntry({
    id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    timestamp: new Date().toISOString(),
    battleId: String(report._battleId || 'unknown').slice(0, 64),
    seed: cleanNumber(report._runSeed, 0),
    mode: ['daily', 'weekly'].includes(report._runMode) ? report._runMode : 'standard',
    difficulty: ['casual', 'standard', 'veteran'].includes(report._difficulty) ? report._difficulty : 'standard',
    won: report._won === true,
    battleTime: Math.max(0, Number(cleanNumber(report.battle_time, 0).toFixed(2))),
    finalHp: Math.max(0, Number(cleanNumber(report._endHp ?? report.death_hp, 0).toFixed(1))),
    damageDealt: Math.max(0, Math.round(cleanNumber(report.total_damage_dealt, 0))),
    damageTaken: Math.max(0, Math.round(Object.values(report.damage_by_source || {})
      .reduce((sum, value) => sum + cleanNumber(value, 0), 0))),
  });
  const history = readHistory();
  history.unshift(entry);
  writeHistory(history);
  const challenges = recordChallengeBattle(entry);
  return { ...entry, challenges, progression: recordProfileBattle(entry, challenges.bonusXp) };
}

export function recentBattles(limit = 4) {
  return readHistory().slice(0, Math.max(0, Math.min(12, limit | 0)));
}

export function allBattles() {
  return readHistory();
}

export function replaceHistory(entries) {
  if (!Array.isArray(entries) || entries.length > MAX_ENTRIES) return false;
  const safe = entries
    .filter((entry) => entry && typeof entry === 'object' && !Array.isArray(entry))
    .slice(0, MAX_ENTRIES)
    .map(normalizeHistoryEntry);
  return writeHistory(safe);
}

export function historySummary() {
  const history = readHistory();
  return {
    battles: history.length,
    wins: history.filter((entry) => entry.won).length,
    losses: history.filter((entry) => !entry.won).length,
    damageDealt: history.reduce((sum, entry) => sum + cleanNumber(entry.damageDealt), 0),
  };
}

export function clearHistory() {
  try {
    localStorage.removeItem(HISTORY_KEY);
    return true;
  } catch (error) {
    recordStorageError(error, 'run-history');
    return false;
  }
}
