// ArenaRenderer.js — Advanced procedural Canvas 2D renderer.
// Draws dynamic bending circuit grid, high-tech robot, glows, and environment lighting.

// --- Grid cache (offscreen canvas) ---
// Rebuilt only when canvas size changes; skipped entirely when shockwaves are active.
let _gridCache = null;
let _gridCacheW = 0;
let _gridCacheH = 0;

export function drawArena(g, canvas, ctx, camera) {
  const _now = performance.now();
  const W = canvas.width, H = canvas.height;
  const scale = W / 20;   // 20m arena → canvas
  const cam = camera.offset();
  const ox = W / 2 - camera.x * scale + cam.x;
  const oy = H / 2 - camera.y * scale + cam.y;

  // Ambient deep background
  g.fillStyle = '#020306';
  g.fillRect(0, 0, W, H);

  // Dynamic grid warping/bending calculations based on active shockwaves
  function getWarped(wx, wy) {
    let px = wx;
    let py = wy;
    for (const p of ctx.particles) {
      if (p.type === 'shockwave') {
        const dx = wx - p.x;
        const dy = wy - p.y;
        const dist = Math.hypot(dx, dy);
        const currentR = p.size * (1 - p.life / p.maxLife);
        const width = 1.6; // width of warp ripple
        if (dist > 0 && Math.abs(dist - currentR) < width) {
          // calculate bending strength
          const intensity = (1 - Math.abs(dist - currentR) / width) * (p.life / p.maxLife) * 0.45;
          px += (dx / dist) * intensity;
          py += (dy / dist) * intensity;
        }
      }
    }
    return { x: px * scale, y: py * scale };
  }

  // Draw cyber grid lines (sub-divided for bending curvature)
  // Optimisation: if no shockwave particles are active, render the static grid
  // once into an offscreen canvas and blit it every frame instead of recalculating.
  const hasShockwave = ctx.particles.some(p => p.type === 'shockwave');

  if (!hasShockwave) {
    // Rebuild the cached offscreen canvas only when the size changes.
    if (!_gridCache || _gridCacheW !== W || _gridCacheH !== H) {
      _gridCacheW = W;
      _gridCacheH = H;
      _gridCache = document.createElement('canvas');
      _gridCache.width = W;
      _gridCache.height = H;
      const gc = _gridCache.getContext('2d');
      // Cache the grid in a camera-neutral coordinate space. The camera can
      // follow the robot every frame; baking the current ox/oy into the cache
      // makes the grid visibly drift once the robot leaves the centre.
      const cacheOx = W / 2;
      const cacheOy = H / 2;

      gc.strokeStyle = 'rgba(0, 210, 255, 0.05)';
      gc.lineWidth = 1;

      // Horizontal grid lines (no warp — identity getWarped)
      for (let gy = -10; gy <= 10; gy++) {
        gc.beginPath();
        gc.moveTo(cacheOx + (-10) * scale, cacheOy + gy * scale);
        for (let gx = -9.5; gx <= 10; gx += 0.5) {
          gc.lineTo(cacheOx + gx * scale, cacheOy + gy * scale);
        }
        gc.stroke();
      }

      // Vertical grid lines
      for (let gx = -10; gx <= 10; gx++) {
        gc.beginPath();
        gc.moveTo(cacheOx + gx * scale, cacheOy + (-10) * scale);
        for (let gy = -9.5; gy <= 10; gy += 0.5) {
          gc.lineTo(cacheOx + gx * scale, cacheOy + gy * scale);
        }
        gc.stroke();
      }

      // Glowing grid intersection nodes
      gc.fillStyle = 'rgba(0, 210, 255, 0.2)';
      for (let gx = -10; gx <= 10; gx += 5) {
        for (let gy = -10; gy <= 10; gy += 5) {
          gc.beginPath();
          gc.arc(cacheOx + gx * scale, cacheOy + gy * scale, 2, 0, Math.PI * 2);
          gc.fill();
        }
      }
    }

    // Blit the cached grid in a single drawImage call, applying the current
    // camera transform at draw time rather than rebuilding the cache.
    g.save();
    g.translate(-camera.x * scale + cam.x, -camera.y * scale + cam.y);
    g.drawImage(_gridCache, 0, 0);
    g.restore();
  } else {
    // Shockwaves active: draw fully-warped grid as before, and invalidate cache.
    _gridCache = null;

    g.save();
    g.strokeStyle = 'rgba(0, 210, 255, 0.05)';
    g.lineWidth = 1;

    // Horizontal grid lines
    for (let gy = -10; gy <= 10; gy++) {
      g.beginPath();
      let pt = getWarped(-10, gy);
      g.moveTo(ox + pt.x, oy + pt.y);
      for (let gx = -9.5; gx <= 10; gx += 0.5) {
        pt = getWarped(gx, gy);
        g.lineTo(ox + pt.x, oy + pt.y);
      }
      g.stroke();
    }

    // Vertical grid lines
    for (let gx = -10; gx <= 10; gx++) {
      g.beginPath();
      let pt = getWarped(gx, -10);
      g.moveTo(ox + pt.x, oy + pt.y);
      for (let gy = -9.5; gy <= 10; gy += 0.5) {
        pt = getWarped(gx, gy);
        g.lineTo(ox + pt.x, oy + pt.y);
      }
      g.stroke();
    }

    // Draw glowing grid intersection nodes (major points)
    g.fillStyle = 'rgba(0, 210, 255, 0.2)';
    for (let gx = -10; gx <= 10; gx += 5) {
      for (let gy = -10; gy <= 10; gy += 5) {
        const pt = getWarped(gx, gy);
        g.beginPath();
        g.arc(ox + pt.x, oy + pt.y, 2, 0, Math.PI * 2);
        g.fill();
      }
    }
    g.restore();
  }

  // Arena Borders with double glowing layer
  g.save();
  // Glowing layer
  g.strokeStyle = 'rgba(0, 210, 255, 0.18)';
  g.lineWidth = 8;
  g.shadowColor = '#00d2ff';
  g.shadowBlur = 12;
  g.strokeRect(ox - 10 * scale, oy - 10 * scale, 20 * scale, 20 * scale);
  // Sharp inner core border
  g.shadowBlur = 0;
  g.strokeStyle = 'rgba(0, 210, 255, 0.7)';
  g.lineWidth = 2.5;
  g.strokeRect(ox - 10 * scale, oy - 10 * scale, 20 * scale, 20 * scale);
  g.restore();

  // Translate camera view to draw world entities
  g.save();
  g.translate(ox, oy);

  // Hazards
  if (ctx.hazards) {
    for (const h of ctx.hazards) h.draw(g, scale);
  }

  // Mines
  for (const m of ctx.mines) m.draw(g, scale);
  // Projectiles
  for (const p of ctx.projectiles) p.draw(g, scale);
  // Enemies
  for (const e of ctx.enemies) e.draw(g, scale);
  // Particles (sparks, dust, text)
  for (const p of ctx.particles) p.draw(g, scale);

  // Target Aiming Laser (Task 4)
  const robot = ctx.robot;
  if (robot && !robot.dead && robot.aimTarget && !robot.aimTarget.dead) {
    g.save();
    const turretAngle = Math.atan2(robot.aimTarget.y - robot.y, robot.aimTarget.x - robot.x);
    const rPx = robot.bodyRadius * scale;
    const startX = (robot.x + Math.cos(turretAngle) * robot.bodyRadius) * scale;
    const startY = (robot.y + Math.sin(turretAngle) * robot.bodyRadius) * scale;
    const endX = robot.aimTarget.x * scale;
    const endY = robot.aimTarget.y * scale;

    g.strokeStyle = 'rgba(0, 210, 255, 0.45)';
    g.lineWidth = 1.5;
    g.setLineDash([4, 4]);
    g.lineDashOffset = -performance.now() * 0.04; // Animate laser dashes
    g.shadowColor = '#00d2ff';
    g.shadowBlur = 6;

    g.beginPath();
    g.moveTo(startX, startY);
    g.lineTo(endX, endY);
    g.stroke();
    
    // Draw focus reticle at target
    g.restore();
    g.save();
    g.strokeStyle = '#00d2ff';
    g.shadowColor = '#00d2ff';
    g.shadowBlur = 8;
    g.lineWidth = 1.5;
    // Outer circle
    g.beginPath();
    g.arc(endX, endY, 5, 0, Math.PI * 2);
    g.stroke();
    
    // Small inner point
    g.fillStyle = '#00ffc3';
    g.beginPath();
    g.arc(endX, endY, 1.5, 0, Math.PI * 2);
    g.fill();
    g.restore();
  }

  // Robot
  drawRobot(g, ctx.robot, scale, _now);

  g.restore();

  // Screen-space red warning vignette for core temperature (overlogic value)
  if (ctx.overlogic && ctx.overlogic.value > 0) {
    g.save();
    let intensity = ctx.overlogic.value / 100; // 0 to 1
    if (ctx.overlogic.active) {
      // Pulsate in meltdown
      intensity *= 0.7 + 0.3 * Math.sin(_now / 150);
    }
    const maxDimension = Math.max(W, H);
    const grad = g.createRadialGradient(
      W / 2, H / 2, maxDimension * 0.3,
      W / 2, H / 2, maxDimension * 0.7
    );
    const alpha = intensity * 0.4;
    grad.addColorStop(0, 'rgba(255, 0, 0, 0)');
    grad.addColorStop(1, `rgba(255, 0, 0, ${alpha})`);
    g.fillStyle = grad;
    g.fillRect(0, 0, W, H);
    g.restore();
  }
}

function drawRobot(g, robot, scale, _now) {
  if (!robot) return;
  const rPx = Math.max(robot.bodyRadius * scale, 11);
  
  // 1. Draw base body (rotated to movement direction)
  g.save();
  g.translate(robot.x * scale, robot.y * scale);
  g.rotate(robot.chassisAngle || 0);
  
  const color = robot.dead ? '#555555' : '#00d2ff';
  
  // Stabilizer side wing pads (base plate)
  if (!robot.dead) {
    g.fillStyle = '#101d36';
    g.strokeStyle = color;
    g.lineWidth = 1;
    // Wing pads
    g.fillRect(rPx * 0.1, -rPx * 0.9, rPx * 0.3, rPx * 0.25);
    g.fillRect(rPx * 0.1, rPx * 0.65, rPx * 0.3, rPx * 0.25);
    // Draw wheels or treads inside wings
    g.fillStyle = '#060912';
    g.fillRect(rPx * 0.15, -rPx * 0.85, rPx * 0.2, rPx * 0.15);
    g.fillRect(rPx * 0.15, rPx * 0.7, rPx * 0.2, rPx * 0.15);
  }
  
  // Metallic chassis circle
  g.fillStyle = robot.dead ? '#3a3a3a' : '#080d1a';
  g.strokeStyle = color;
  g.lineWidth = 2.5;
  g.shadowColor = color;
  g.shadowBlur = robot.dead ? 0 : 10;
  
  g.beginPath();
  g.arc(0, 0, rPx, 0, Math.PI * 2);
  g.fill();
  g.stroke();
  
  // Draw damage flash overlay on chassis
  if (robot.flashTimer > 0) {
    g.fillStyle = 'rgba(255, 255, 255, 0.65)';
    g.fill();
  }
  
  g.restore(); // base body drawn
  
  // 2. Draw turret gun pod on top (rotated towards nearest enemy)
  if (!robot.dead) {
    g.save();
    g.translate(robot.x * scale, robot.y * scale);
    
    // Find turret direction
    let turretAngle = robot.chassisAngle || 0;
    const e = robot.aimTarget && !robot.aimTarget.dead ? robot.aimTarget : (robot.ctx ? robot.ctx.nearestEnemyTo({ x: robot.x, y: robot.y }) : null);
    if (e) {
      turretAngle = Math.atan2(e.y - robot.y, e.x - robot.x);
    }
    g.rotate(turretAngle);
    
    // Turret gun barrel
    g.fillStyle = '#00ffc3';
    g.shadowColor = '#00ffc3';
    g.shadowBlur = 8;
    g.fillRect(rPx * 0.35, -rPx * 0.15, rPx * 0.65, rPx * 0.3);
    
    // Turret head shell
    g.fillStyle = '#0c1d3b';
    g.strokeStyle = '#00ffc3';
    g.lineWidth = 1.5;
    g.shadowColor = '#00ffc3';
    g.shadowBlur = 6;
    g.beginPath();
    g.arc(0, 0, rPx * 0.55, 0, Math.PI * 2);
    g.fill();
    g.stroke();
    
    // Center glowing power reactor core
    const corePulse = 0.85 + 0.15 * Math.sin(_now / 120);
    g.fillStyle = robot.overdriveTimer > 0 ? '#ff9d3e' : '#00d2ff';
    g.shadowColor = g.fillStyle;
    g.shadowBlur = 10;
    g.beginPath();
    g.arc(0, 0, rPx * 0.3 * corePulse, 0, Math.PI * 2);
    g.fill();
    
    g.restore();
  } else {
    // Draw dead eyes on chassis center
    g.save();
    g.translate(robot.x * scale, robot.y * scale);
    g.strokeStyle = '#555555';
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(-rPx * 0.3, -rPx * 0.3); g.lineTo(rPx * 0.3, rPx * 0.3);
    g.moveTo(rPx * 0.3, -rPx * 0.3); g.lineTo(-rPx * 0.3, rPx * 0.3);
    g.stroke();
    g.restore();
  }
  
  // Glowing hexagonal / circular Forcefield Shield
  if (robot.shieldTimer > 0) {
    g.save();
    g.translate(robot.x * scale, robot.y * scale);
    
    const shieldR = rPx * 1.55;
    const pulse = 0.08 * Math.sin(_now / 70);
    
    g.strokeStyle = `rgba(0, 210, 255, ${0.45 + pulse * 1.5})`;
    g.shadowColor = '#00d2ff';
    g.shadowBlur = 12;
    g.lineWidth = 3;
    
    g.beginPath();
    g.arc(0, 0, shieldR, 0, Math.PI * 2);
    g.stroke();
    
    g.fillStyle = `rgba(0, 210, 255, ${0.07 + pulse * 0.04})`;
    g.fill();
    
    g.restore();
  }
}
