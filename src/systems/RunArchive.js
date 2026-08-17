// RunArchive.js — versioned local records for completed campaigns.
//
// The archive is deliberately compact and contains only normalized gameplay
// facts. A future opt-in leaderboard can reuse this shape without exposing
// rules, free-form text, or device identifiers.

import { recordStorageError } from './RuntimeDiagnostics.js?v=20260725-4';
import { runReceipt } from './RunVerification.js?v=20260725-4';
import { storageWritesAllowed } from './StorageWriteGate.js?v=20260725-4';
import { operationLimit } from './OperationsConfig.js?v=20260725-4';

const ARCHIVE_KEY = 'overlogic_run_archive';
const ARCHIVE_VERSION = 1;
const HARD_MAX_ENTRIES = 240;
const MODES = new Set(['standard', 'daily', 'weekly']);
const DIFFICULTIES = new Set(['casual', 'standard', 'veteran']);

function archiveLimit() {
  return Math.max(12, Math.min(HARD_MAX_ENTRIES, operationLimit('archiveEntries', 40)));
}

function finiteNumber(value, min = 0, max = 1_000_000_000) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.max(min, Math.min(max, numeric)) : min;
}

function normalizeTimestamp(value) {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : new Date(0).toISOString();
}

function normalizeEntry(raw = {}, index = 0) {
  const suppliedId = String(raw.id || '').slice(0, 96);
  const id = /^[A-Za-z0-9:_-]{6,96}$/.test(suppliedId)
    ? suppliedId
    : `imported-${index}-${Math.round(finiteNumber(raw.seed, 1, Number.MAX_SAFE_INTEGER))}`;
  const normalized = {
    id,
    completedAt: normalizeTimestamp(raw.completedAt),
    mode: MODES.has(raw.mode) ? raw.mode : 'standard',
    difficulty: DIFFICULTIES.has(raw.difficulty) ? raw.difficulty : 'standard',
    seed: Math.max(1, Math.floor(finiteNumber(raw.seed, 1, Number.MAX_SAFE_INTEGER))),
    battlesWon: Math.floor(finiteNumber(raw.battlesWon, 0, 99)),
    totalDamageDealt: finiteNumber(raw.totalDamageDealt),
    totalBattleTime: finiteNumber(raw.totalBattleTime, 0, 86_400),
    finalHp: finiteNumber(raw.finalHp, 0, 1_000_000),
    rulesCount: Math.floor(finiteNumber(raw.rulesCount, 0, 40)),
    upgrades: Math.floor(finiteNumber(raw.upgrades, 0, 99)),
    simulationVersion: Math.floor(finiteNumber(raw.simulationVersion, 1, 99)),
    simulationStep: finiteNumber(raw.simulationStep, 1 / 60, 0.5),
    replayDigest: /^RPL\d+-[0-9A-F]{8}$/.test(String(raw.replayDigest || '')) ? String(raw.replayDigest) : '',
  };
  normalized.receipt = runReceipt(normalized);
  return normalized;
}

function readEntries() {
  try {
    const raw = localStorage.getItem(ARCHIVE_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    const entries = Array.isArray(parsed) ? parsed : parsed?.entries;
    if (!Array.isArray(entries)) return [];
    const seen = new Set();
    return entries.map(normalizeEntry).filter((entry) => {
      if (seen.has(entry.id)) return false;
      seen.add(entry.id);
      return true;
    }).sort((a, b) => Date.parse(b.completedAt) - Date.parse(a.completedAt)).slice(0, archiveLimit());
  } catch (error) {
    recordStorageError(error, 'run-archive-read');
    return [];
  }
}

function writeEntries(entries) {
  if (!storageWritesAllowed()) return false;
  try {
    localStorage.setItem(ARCHIVE_KEY, JSON.stringify({
      version: ARCHIVE_VERSION,
      entries: entries.slice(0, archiveLimit()),
    }));
    return true;
  } catch (error) {
    recordStorageError(error, 'run-archive');
    return false;
  }
}

export function runArchiveSnapshot() {
  return { version: ARCHIVE_VERSION, entries: readEntries() };
}

export function recentCompletedRuns(limit = 3) {
  return readEntries().slice(0, Math.max(0, Math.min(10, Number(limit) || 0)));
}

export function leaderboardRuns({ mode = null, difficulty = null, limit = 10 } = {}) {
  const modeFilter = MODES.has(mode) ? mode : null;
  const difficultyFilter = DIFFICULTIES.has(difficulty) ? difficulty : null;
  const max = Math.max(1, Math.min(20, Math.floor(Number(limit) || 10)));
  return readEntries()
    .filter((entry) => !modeFilter || entry.mode === modeFilter)
    .filter((entry) => !difficultyFilter || entry.difficulty === difficultyFilter)
    .sort((a, b) => {
      const timeA = a.totalBattleTime > 0 ? a.totalBattleTime : Number.POSITIVE_INFINITY;
      const timeB = b.totalBattleTime > 0 ? b.totalBattleTime : Number.POSITIVE_INFINITY;
      return timeA - timeB || b.totalDamageDealt - a.totalDamageDealt ||
        Date.parse(a.completedAt) - Date.parse(b.completedAt);
    })
    .slice(0, max)
    .map((entry) => ({ ...entry }));
}

export function runRecords(entries = readEntries()) {
  const valid = Array.isArray(entries) ? entries.map(normalizeEntry) : [];
  const timed = valid.filter((entry) => entry.totalBattleTime > 0);
  const best = timed.reduce((winner, entry) => !winner || entry.totalBattleTime < winner.totalBattleTime ? entry : winner, null);
  return {
    completions: valid.length,
    dailyCompletions: valid.filter((entry) => entry.mode === 'daily').length,
    weeklyCompletions: valid.filter((entry) => entry.mode === 'weekly').length,
    veteranCompletions: valid.filter((entry) => entry.difficulty === 'veteran').length,
    bestTime: best?.totalBattleTime ?? null,
    bestRun: best ? { ...best } : null,
    highestDamage: valid.reduce((max, entry) => Math.max(max, entry.totalDamageDealt), 0),
  };
}

export function recordCompletedRun(raw = {}) {
  const entries = readEntries();
  const entry = normalizeEntry({ ...raw, completedAt: raw.completedAt || new Date().toISOString() });
  const existing = entries.find((item) => item.id === entry.id);
  if (existing) return { entry: existing, isNew: false, persisted: true, records: runRecords(entries) };
  const next = [entry, ...entries].slice(0, archiveLimit());
  const persisted = writeEntries(next);
  return {
    entry,
    isNew: persisted,
    persisted,
    records: runRecords(persisted ? next : entries),
  };
}

export function replaceRunArchive(raw) {
  const entries = Array.isArray(raw) ? raw : raw?.entries;
  if (!Array.isArray(entries) || entries.length > HARD_MAX_ENTRIES) return false;
  const seen = new Set();
  const normalized = entries.map(normalizeEntry).filter((entry) => {
    if (seen.has(entry.id)) return false;
    seen.add(entry.id);
    return true;
  }).sort((a, b) => Date.parse(b.completedAt) - Date.parse(a.completedAt));
  return writeEntries(normalized);
}

export function clearRunArchive() {
  if (!storageWritesAllowed()) return false;
  try {
    localStorage.removeItem(ARCHIVE_KEY);
    return true;
  } catch (error) {
    recordStorageError(error, 'run-archive');
    return false;
  }
}
