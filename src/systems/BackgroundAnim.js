// BackgroundAnim.js — Cybernetic grid-aligned circuit particle background animation.
// Creates a digital network theme behind all screens.

export class BackgroundAnim {
  constructor(canvas) {
    this.canvas = canvas;
    this.g = canvas.getContext('2d');
    this.particles = [];
    this.gridSize = 50; // grid cell size in pixels
    this.maxParticles = 35;
    this.speed = 1.2;
    this.running = false;
    this.rafId = null;
    this.reduceMotion = false;
    this.shouldRun = false;
    this.visibilityPaused = false;
    this.init();
    this.loop = this.loop.bind(this);
  }

  init() {
    this.resize();
    window.addEventListener('resize', () => this.resize());
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        this.visibilityPaused = true;
        this._stopFrameLoop();
      } else {
        this.visibilityPaused = false;
        if (this.shouldRun) this.start();
      }
    });

    // Spawn initial grid-aligned particles
    for (let i = 0; i < this.maxParticles; i++) {
      this.particles.push(this.createParticle());
    }
  }

  resize() {
    this.width = window.innerWidth || 1024;
    this.height = window.innerHeight || 768;
    const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = this.width * pixelRatio;
    this.canvas.height = this.height * pixelRatio;
    // Assigning canvas.width/height resets the bitmap, but not every browser
    // implementation resets the 2D transform consistently across resize
    // events. Explicitly reset it so repeated resizes never compound scale().
    this.g.setTransform(1, 0, 0, 1, 0, 0);
    this.g.scale(pixelRatio, pixelRatio);
  }

  createParticle() {
    // Start at a random grid intersection
    const col = Math.floor(Math.random() * (this.width / this.gridSize));
    const row = Math.floor(Math.random() * (this.height / this.gridSize));
    
    // Choose one of 4 cardinal directions
    const dirs = [
      { x: 1, y: 0 },
      { x: -1, y: 0 },
      { x: 0, y: 1 },
      { x: 0, y: -1 }
    ];
    const dir = dirs[Math.floor(Math.random() * dirs.length)];

    return {
      x: col * this.gridSize,
      y: row * this.gridSize,
      vx: dir.x * this.speed,
      vy: dir.y * this.speed,
      history: [],
      maxHistory: 12,
      color: Math.random() > 0.4 ? 'rgba(0, 210, 255, 0.35)' : 'rgba(62, 255, 157, 0.28)'
    };
  }

  start() {
    this.shouldRun = true;
    if (this.visibilityPaused || this.running) return;
    this.running = true;
    if (this.reduceMotion) {
      this.g.clearRect(0, 0, this.width, this.height);
      this.draw();
      this.running = false;
      return;
    }
    this.rafId = requestAnimationFrame(this.loop);
  }

  stop() {
    this.shouldRun = false;
    this._stopFrameLoop();
  }

  _stopFrameLoop() {
    this.running = false;
    if (this.rafId !== null) cancelAnimationFrame(this.rafId);
    this.rafId = null;
  }

  setReducedMotion(enabled) {
    this.reduceMotion = !!enabled;
    this.stop();
    this.start();
  }

  loop() {
    if (!this.running || document.hidden) {
      if (document.hidden) this._stopFrameLoop();
      return;
    }
    this.g.clearRect(0, 0, this.width, this.height);
    this.update();
    this.draw();
    this.rafId = requestAnimationFrame(this.loop);
  }

  update() {
    for (const p of this.particles) {
      // Record history for trails
      p.history.push({ x: p.x, y: p.y });
      if (p.history.length > p.maxHistory) {
        p.history.shift();
      }

      // Move particle
      p.x += p.vx;
      p.y += p.vy;

      // If at a grid intersection, maybe make a 90 degree turn
      const gx = Math.round(p.x / this.gridSize) * this.gridSize;
      const gy = Math.round(p.y / this.gridSize) * this.gridSize;
      const atX = Math.abs(p.x - gx) < this.speed * 0.6;
      const atY = Math.abs(p.y - gy) < this.speed * 0.6;

      if (atX && atY) {
        // Lock to exact intersection coordinates to avoid drift
        p.x = gx;
        p.y = gy;

        // 18% chance to turn
        if (Math.random() < 0.18) {
          const currentDir = { x: Math.sign(p.vx), y: Math.sign(p.vy) };
          // Turn 90 degrees (either left or right)
          if (currentDir.x !== 0) {
            p.vx = 0;
            p.vy = (Math.random() > 0.5 ? 1 : -1) * this.speed;
          } else {
            p.vx = (Math.random() > 0.5 ? 1 : -1) * this.speed;
            p.vy = 0;
          }
        }
      }

      // Out of bounds reset
      if (p.x < -100 || p.x > this.width + 100 || p.y < -100 || p.y > this.height + 100) {
        Object.assign(p, this.createParticle());
      }
    }
  }

  draw() {
    const g = this.g;

    // Draw subtle grid intersections (dots)
    g.fillStyle = 'rgba(0, 210, 255, 0.03)';
    for (let x = 0; x < this.width; x += this.gridSize) {
      for (let y = 0; y < this.height; y += this.gridSize) {
        g.fillRect(x - 1, y - 1, 2, 2);
      }
    }

    // Draw trails and node points
    g.lineWidth = 1.2;
    for (const p of this.particles) {
      if (p.history.length < 2) continue;

      g.strokeStyle = p.color;
      g.beginPath();
      g.moveTo(p.history[0].x, p.history[0].y);
      for (let i = 1; i < p.history.length; i++) {
        g.lineTo(p.history[i].x, p.history[i].y);
      }
      g.stroke();

      // Glowing active node dot
      g.fillStyle = p.color.replace('0.35', '0.75').replace('0.28', '0.75');
      g.beginPath();
      g.arc(p.x, p.y, 2.5, 0, Math.PI * 2);
      g.fill();
    }

    // Draw connections between nearby nodes
    g.lineWidth = 0.5;
    for (let i = 0; i < this.particles.length; i++) {
      const p1 = this.particles[i];
      for (let j = i + 1; j < this.particles.length; j++) {
        const p2 = this.particles[j];
        const dist = Math.hypot(p1.x - p2.x, p1.y - p2.y);
        if (dist < 130) {
          const alpha = (1 - dist / 130) * 0.16;
          g.strokeStyle = `rgba(0, 210, 255, ${alpha})`;
          g.beginPath();
          g.moveTo(p1.x, p1.y);
          g.lineTo(p2.x, p2.y);
          g.stroke();
        }
      }
    }
  }
}
