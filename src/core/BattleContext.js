// BattleContext.js — per-battle shared context. Holds live enemies, projectiles,
// mines, elapsed time, tracker, overlogic. Math helpers for nearest enemy / arena clamp.
// Mirrors scripts/core/BattleContext.gd. Pure class, no DOM.

import { CombatStatsTracker } from '../systems/CombatStatsTracker.js';
import { OverlogicSystem } from '../systems/OverlogicSystem.js';

const ARENA_HALF = 10;        // 20x20 arena
const ARENA_MARGIN = 0.4;     // body clamp margin

export class BattleContext {
  constructor() {
    this.robot = null;
    this.enemies = [];        // live EnemyBase instances
    this.projectiles = [];    // live Projectile instances
    this.mines = [];          // live Mine instances
    this.particles = [];      // live Particle instances
    this.time = 0;
    this.arenaHalf = ARENA_HALF;
    this.tracker = new CombatStatsTracker();
    this.overlogic = new OverlogicSystem();
    this.boss = null;
    this.timeSpeed = 1;       // combat speed multiplier (x1 / x2)
    this.random = Math.random; // seeded by CombatArena for gameplay-affecting randomness
    this._lastCasting = false; // for casting-seen edge detection
    this.hazards = [];        // live HazardTile instances
    this.executor = null;     // set by CombatArena after executor is created
    this.hud = null;          // set by CombatArena
  }

  // Returns nearest live enemy instance or null.
  nearestEnemyTo(pos) {
    let best = null, bestD = Infinity;
    for (const e of this.enemies) {
      if (e.dead) continue;
      const d = Math.hypot(e.x - pos.x, e.y - pos.y);
      if (d < bestD) { bestD = d; best = e; }
    }
    return best;
  }

  nearestEnemyDistance(pos) {
    const e = this.nearestEnemyTo(pos);
    if (!e) return Infinity;
    return Math.hypot(e.x - pos.x, e.y - pos.y);
  }

  countEnemiesWithin(pos, radius) {
    let n = 0;
    for (const e of this.enemies) {
      if (e.dead) continue;
      if (Math.hypot(e.x - pos.x, e.y - pos.y) <= radius) n += 1;
    }
    return n;
  }

  nearestHostileProjectileTo(pos) {
    let best = null;
    let bestD = Infinity;
    for (const projectile of this.projectiles) {
      if (projectile.dead || projectile.fromPlayer) continue;
      const toRobotX = pos.x - projectile.x;
      const toRobotY = pos.y - projectile.y;
      const closingDistance = toRobotX * projectile.dir.x + toRobotY * projectile.dir.y;
      const crossTrackDistance = Math.abs(toRobotX * projectile.dir.y - toRobotY * projectile.dir.x);
      if (closingDistance <= 0 || crossTrackDistance > 1.1) continue;
      const distance = Math.hypot(projectile.x - pos.x, projectile.y - pos.y);
      if (distance < bestD) {
        best = projectile;
        bestD = distance;
      }
    }
    return best;
  }

  nearestHostileProjectileDistance(pos) {
    const projectile = this.nearestHostileProjectileTo(pos);
    if (!projectile) return Infinity;
    return Math.hypot(projectile.x - pos.x, projectile.y - pos.y);
  }

  anyEnemyCasting() {
    for (const e of this.enemies) if (!e.dead && e.isCasting()) return true;
    return false;
  }

  castingEnemies() {
    const out = [];
    for (const e of this.enemies) if (!e.dead && e.isCasting()) out.push(e);
    return out;
  }

  liveEnemies() {
    let n = 0;
    for (const e of this.enemies) if (!e.dead) n += 1;
    return n;
  }

  clampToArena(pos) {
    const h = this.arenaHalf - ARENA_MARGIN;
    return { x: clamp(pos.x, -h, h), y: clamp(pos.y, -h, h) };
  }

  // Edge detection: returns true exactly once when casting starts.
  tickCastingEdge() {
    const now = this.anyEnemyCasting();
    const edge = now && !this._lastCasting;
    this._lastCasting = now;
    return edge;
  }

  isRobotOnHazard() {
    if (!this.robot || this.robot.dead) return false;
    for (const h of this.hazards) {
      if (h.isOverlapping(this.robot)) {
        return true;
      }
    }
    return false;
  }
}

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
