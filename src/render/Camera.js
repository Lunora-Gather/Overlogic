import { GameState } from '../core/GameState.js';

export class Camera {
  constructor() {
    this.x = 0; this.y = 0;          // look-at point in world units
    this.shakeTime = 0; this.shakeMag = 0;
  }
  follow(robot, dt, maxOffset = 3) {
    // Light follow: clamp target within ±maxOffset of origin
    const tx = clamp(robot.x, -maxOffset, maxOffset);
    const ty = clamp(robot.y, -maxOffset, maxOffset);
    // Smooth lerp
    this.x += (tx - this.x) * Math.min(1, dt * 4);
    this.y += (ty - this.y) * Math.min(1, dt * 4);
  }
  shake(time, mag) {
    if (GameState?.settings && (!GameState.settings.screenShake || GameState.settings.reduceMotion)) return;
    this.shakeTime = Math.max(this.shakeTime, time);
    this.shakeMag = mag;
  }
  tick(dt) { if (this.shakeTime > 0) this.shakeTime -= dt; }
  offset() {
    if (this.shakeTime <= 0) return { x: 0, y: 0 };
    return { x: (Math.random() - 0.5) * this.shakeMag, y: (Math.random() - 0.5) * this.shakeMag };
  }
}
function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
