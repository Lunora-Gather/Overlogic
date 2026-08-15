// ProfileProgression.js — local operator profile and achievement foundation.
// It is deliberately deterministic and privacy-preserving. Online identity,
// seasons, and entitlements can later map onto this versioned shape.

const PROFILE_KEY = 'overlogic_profile';
const PROFILE_VERSION = 1;

export const ACHIEVEMENTS = Object.freeze([
  { id: 'first_battle', titleKey: 'achievement.firstBattle', xp: 25 },
  { id: 'first_win', titleKey: 'achievement.firstWin', xp: 50 },
  { id: 'debugger', titleKey: 'achievement.debugger', xp: 75 },
  { id: 'daily_protocol', titleKey: 'achievement.dailyProtocol', xp: 100 },
  { id: 'boss_breaker', titleKey: 'achievement.bossBreaker', xp: 150 },
  { id: 'speedrun', titleKey: 'achievement.speedrun', xp: 100 },
]);

function defaultProfile() {
  return {
    version: PROFILE_VERSION,
    xp: 0,
    totalBattles: 0,
    wins: 0,
    losses: 0,
    dailyWins: 0,
    bestBattleTime: null,
    achievements: {},
  };
}

function readProfile() {
  try {
    const raw = localStorage.getItem(PROFILE_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return defaultProfile();
    const profile = { ...defaultProfile(), ...parsed };
    profile.xp = Math.max(0, Number(profile.xp) || 0);
    profile.totalBattles = Math.max(0, Number(profile.totalBattles) || 0);
    profile.wins = Math.max(0, Number(profile.wins) || 0);
    profile.losses = Math.max(0, Number(profile.losses) || 0);
    profile.dailyWins = Math.max(0, Number(profile.dailyWins) || 0);
    profile.bestBattleTime = profile.bestBattleTime !== null && Number.isFinite(Number(profile.bestBattleTime))
      ? Math.max(0, Number(profile.bestBattleTime)) : null;
    profile.achievements = profile.achievements && typeof profile.achievements === 'object'
      ? profile.achievements : {};
    return profile;
  } catch {
    return defaultProfile();
  }
}

function writeProfile(profile) {
  try {
    localStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
    return true;
  } catch {
    return false;
  }
}

export function profileSnapshot() {
  return readProfile();
}

export function replaceProfile(profile) {
  if (!profile || typeof profile !== 'object' || Array.isArray(profile)) return false;
  const normalized = { ...defaultProfile(), ...profile, version: PROFILE_VERSION };
  normalized.achievements = profile.achievements && typeof profile.achievements === 'object'
    ? profile.achievements : {};
  return writeProfile(normalized);
}

export function profileRank(xp) {
  const level = Math.max(1, Math.floor(Math.sqrt(Math.max(0, Number(xp) || 0) / 100)) + 1);
  const floor = (level - 1) ** 2 * 100;
  const next = level ** 2 * 100;
  return { level, current: Math.max(0, xp - floor), required: next - floor };
}

export function recordProfileBattle(entry = {}, bonusXp = 0) {
  const profile = readProfile();
  const unlocked = [];
  profile.totalBattles += 1;
  profile.xp += (entry.won ? 30 : 10) + Math.max(0, Number(bonusXp) || 0);
  if (entry.won) profile.wins += 1;
  else profile.losses += 1;
  if (entry.won && entry.mode === 'daily') profile.dailyWins += 1;
  if (entry.won && Number.isFinite(entry.battleTime) && entry.battleTime > 0) {
    profile.bestBattleTime = profile.bestBattleTime === null
      ? entry.battleTime : Math.min(profile.bestBattleTime, entry.battleTime);
  }
  const hasLoss = profile.losses > 0;
  const conditions = {
    first_battle: profile.totalBattles >= 1,
    first_win: profile.wins >= 1,
    debugger: hasLoss && profile.wins >= 1,
    daily_protocol: profile.dailyWins >= 1,
    boss_breaker: entry.won && ['battle_9', 'battle_10'].includes(entry.battleId),
    speedrun: entry.won && entry.battleTime > 0 && entry.battleTime <= 10,
  };
  for (const achievement of ACHIEVEMENTS) {
    if (!conditions[achievement.id] || profile.achievements[achievement.id]) continue;
    profile.achievements[achievement.id] = new Date().toISOString();
    profile.xp += achievement.xp;
    unlocked.push(achievement.id);
  }
  writeProfile(profile);
  return { profile, unlocked };
}

export function resetProfile() {
  return writeProfile(defaultProfile());
}
