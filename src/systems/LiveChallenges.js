// LiveChallenges.js — deterministic, local daily objectives.
//
// Challenges are intentionally device-local until an online service exists.
// The normalized shape is portable so a future account/season backend can
// consume it without changing battle code or silently collecting telemetry.

import { recordStorageError } from './RuntimeDiagnostics.js?v=20260725-4';
import { storageWritesAllowed } from './StorageWriteGate.js?v=20260725-4';

const CHALLENGE_KEY = 'overlogic_live_challenges';
const CHALLENGE_VERSION = 1;

const POOLS = Object.freeze({
  wins: [
    { id: 'daily_wins', titleKey: 'challenge.dailyWins', target: 3, xp: 60 },
    { id: 'daily_wins', titleKey: 'challenge.dailyWins', target: 5, xp: 90 },
  ],
  damage: [
    { id: 'daily_damage', titleKey: 'challenge.dailyDamage', target: 500, xp: 60 },
    { id: 'daily_damage', titleKey: 'challenge.dailyDamage', target: 1000, xp: 100 },
  ],
  boss: [
    { id: 'daily_boss', titleKey: 'challenge.dailyBoss', target: 1, xp: 100 },
    { id: 'daily_boss', titleKey: 'challenge.dailyBoss', target: 2, xp: 160 },
  ],
});

function dayHash(date) {
  let hash = 2166136261;
  for (const char of date) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function definitionsForDate(date = utcDate()) {
  const hash = dayHash(date);
  return [
    POOLS.wins[hash % POOLS.wins.length],
    POOLS.damage[(hash >>> 3) % POOLS.damage.length],
    POOLS.boss[(hash >>> 6) % POOLS.boss.length],
  ];
}

function utcDate(date = new Date()) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
}

function previousUtcDate(date) {
  const [year, month, day] = String(date).split('-').map(Number);
  return utcDate(new Date(Date.UTC(year, month - 1, day - 1)));
}

function carryProgression(raw) {
  const streak = Number(raw?.streak);
  const completedDays = Array.isArray(raw?.completedDays)
    ? [...new Set(raw.completedDays.filter((value) => /^\d{4}-\d{2}-\d{2}$/.test(String(value))).map(String))].slice(-30)
    : [];
  return {
    streak: Number.isFinite(streak) ? Math.max(0, Math.min(9999, Math.floor(streak))) : 0,
    lastCompletedDate: /^\d{4}-\d{2}-\d{2}$/.test(String(raw?.lastCompletedDate || '')) ? String(raw.lastCompletedDate) : null,
    completedDays,
  };
}

function emptyState(date = utcDate(), progression = {}) {
  const definitions = definitionsForDate(date);
  return {
    version: CHALLENGE_VERSION,
    date,
    ...carryProgression(progression),
    objectives: Object.fromEntries(definitions.map((definition) => [definition.id, {
      progress: 0,
      completed: false,
      completedAt: null,
    }])),
  };
}

function normalizeState(raw, date = utcDate()) {
  const definitions = definitionsForDate(date);
  const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : null;
  const progression = carryProgression(source);
  const base = source?.date === date ? source : emptyState(date, progression);
  const objectives = {};
  for (const definition of definitions) {
    const item = base.objectives?.[definition.id];
    const progress = Number(item?.progress);
    objectives[definition.id] = {
      progress: Number.isFinite(progress) ? Math.max(0, Math.min(definition.target, progress)) : 0,
      completed: item?.completed === true || (Number.isFinite(progress) && progress >= definition.target),
      completedAt: typeof item?.completedAt === 'string' ? item.completedAt.slice(0, 40) : null,
    };
  }
  return { version: CHALLENGE_VERSION, date, ...carryProgression(base), objectives };
}

function readState(date = utcDate()) {
  try {
    const raw = localStorage.getItem(CHALLENGE_KEY);
    return normalizeState(raw ? JSON.parse(raw) : null, date);
  } catch (error) {
    recordStorageError(error, 'daily-challenges-read');
    return emptyState(date);
  }
}

function writeState(state) {
  if (!storageWritesAllowed()) return false;
  try {
    localStorage.setItem(CHALLENGE_KEY, JSON.stringify(state));
    return true;
  } catch (error) {
    recordStorageError(error, 'daily-challenges');
    return false;
  }
}

export function challengeDefinitions() {
  return definitionsForDate().map((definition) => ({ ...definition }));
}

export function challengeSnapshot(date = new Date()) {
  const dateKey = utcDate(date);
  const definitions = definitionsForDate(dateKey);
  const state = readState(dateKey);
  return {
    version: state.version,
    date: state.date,
    streak: state.streak,
    lastCompletedDate: state.lastCompletedDate,
    completedDays: [...state.completedDays],
    objectives: Object.fromEntries(definitions.map((definition) => [definition.id, {
      ...state.objectives[definition.id],
      target: definition.target,
      titleKey: definition.titleKey,
      xp: definition.xp,
    }])),
  };
}

export function replaceChallenges(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return false;
  return writeState(normalizeState(raw));
}

export function recordChallengeBattle(entry = {}, date = new Date()) {
  if (entry._sandbox === true) return { ...challengeSnapshot(date), unlocked: [], bonusXp: 0, persisted: true };
  const dateKey = utcDate(date);
  const definitions = definitionsForDate(dateKey);
  const state = readState(dateKey);
  const wasComplete = definitions.every((definition) => state.objectives[definition.id]?.completed === true);
  const unlocked = [];
  const increment = {
    daily_wins: entry.won === true ? 1 : 0,
    daily_damage: Math.max(0, Number(entry.damageDealt) || 0),
    daily_boss: entry.won === true && ['battle_9', 'battle_10', 'battle_12', 'battle_13'].includes(entry.battleId) ? 1 : 0,
  };
  for (const definition of definitions) {
    const item = state.objectives[definition.id];
    if (item.completed) continue;
    item.progress = Math.min(definition.target, item.progress + increment[definition.id]);
    if (item.progress >= definition.target) {
      item.completed = true;
      item.completedAt = new Date().toISOString();
      unlocked.push(definition.id);
    }
  }
  const isComplete = definitions.every((definition) => state.objectives[definition.id]?.completed === true);
  if (!wasComplete && isComplete && state.lastCompletedDate !== dateKey) {
    state.streak = state.lastCompletedDate === previousUtcDate(dateKey) ? state.streak + 1 : 1;
    state.lastCompletedDate = dateKey;
    state.completedDays = [...new Set([...state.completedDays, dateKey])].slice(-30);
  }
  const persisted = writeState(state);
  const awarded = persisted ? unlocked : [];
  return {
    ...challengeSnapshot(date),
    unlocked: awarded,
    bonusXp: awarded.reduce((sum, id) => sum + (definitions.find((definition) => definition.id === id)?.xp || 0), 0),
    persisted,
  };
}

export function clearChallenges() {
  if (!storageWritesAllowed()) return false;
  try {
    localStorage.removeItem(CHALLENGE_KEY);
    return true;
  } catch (error) {
    recordStorageError(error, 'daily-challenges');
    return false;
  }
}
