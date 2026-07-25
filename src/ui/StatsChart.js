// StatsChart.js — Custom 2D Canvas chart renderer for cyberpunk run analytics.

import { GameDatabase } from '../core/GameDatabase.js?v=20260725-3';
import { entity, t } from '../i18n/I18n.js?v=20260725-3';

export function drawStatsChart(canvas, report) {
  if (!canvas || !report) return;
  const g = canvas.getContext('2d');

  // High DPI / Retina Support
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  const W = rect.width || 680;
  
  // Responsive layout: Stack vertically on small screens
  const isMobile = W < 600;
  const H = isMobile ? 380 : 200;

  canvas.width = W * dpr;
  canvas.height = H * dpr;
  canvas.style.width = `${W}px`;
  canvas.style.height = `${H}px`;

  g.scale(dpr, dpr);

  // Clear background
  g.fillStyle = '#0a0d1a';
  g.fillRect(0, 0, W, H);

  // Draw background grid lines (cyberpunk style)
  g.strokeStyle = 'rgba(0, 210, 255, 0.08)';
  g.lineWidth = 1;
  for (let x = 30; x < W; x += 40) {
    g.beginPath(); g.moveTo(x, 0); g.lineTo(x, H); g.stroke();
  }
  for (let y = 20; y < H; y += 30) {
    g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke();
  }

  // Split calculations
  const colW = isMobile ? W : W / 2;
  const maxActions = 4;
  
  // Font settings
  g.font = '11px monospace';
  g.textAlign = 'left';
  g.textBaseline = 'middle';

  // --- 1. Draw Action Usage ---
  g.fillStyle = '#00d2ff';
  g.font = 'bold 12px monospace';
  const actionTitleY = 20;
  g.fillText(t('chart.actionUsage'), 20, actionTitleY);
  
  g.font = '10px monospace';
  const actions = Object.entries(report.action_usage || {}).sort((a, b) => b[1] - a[1]);
  const slicedActions = actions.slice(0, maxActions);
  const maxActionCount = Math.max(1, ...actions.map(a => a[1]));

  let ay = 50;
  if (slicedActions.length === 0) {
    g.fillStyle = '#888';
    g.fillText(t('chart.noActions'), 20, ay);
  } else {
    for (const [actId, count] of slicedActions) {
      const act = GameDatabase.getAction(actId);
      const name = act ? entity('action', actId, act.displayName) : actId;
      
      g.fillStyle = '#8892b0';
      g.fillText(name.toUpperCase(), 20, ay);

      // Draw bar
      const barMaxW = colW - 140;
      const barW = (count / maxActionCount) * barMaxW;
      
      // Bar background
      g.fillStyle = 'rgba(0, 210, 255, 0.1)';
      g.fillRect(110, ay - 6, barMaxW, 12);

      // Glowing bar fill
      g.save();
      g.fillStyle = '#00ffc3';
      g.shadowColor = '#00ffc3';
      g.shadowBlur = 8;
      g.fillRect(110, ay - 6, barW, 12);
      g.restore();

      // Count text
      g.fillStyle = '#ffffff';
      g.fillText(`x${count}`, 115 + barW, ay);

      ay += isMobile ? 30 : 36;
    }
  }

  // --- 2. Draw Damage Taken ---
  g.fillStyle = '#ff4757';
  g.font = 'bold 12px monospace';
  const dmgTitleX = isMobile ? 20 : colW + 20;
  const dmgTitleY = isMobile ? 200 : 20;
  g.fillText(t('chart.damageSource'), dmgTitleX, dmgTitleY);

  g.font = '10px monospace';
  const damageSources = Object.entries(report.damage_by_source || {}).sort((a, b) => b[1] - a[1]);
  const maxDmg = Math.max(1, ...damageSources.map(d => d[1]));
  
  let dy = isMobile ? 230 : 50;
  const dmgLabelX = isMobile ? 20 : colW + 20;
  const dmgBarX = isMobile ? 110 : colW + 110;

  if (damageSources.length === 0) {
    g.fillStyle = '#888';
    g.fillText(t('chart.noDamage'), dmgLabelX, dy);
  } else {
    for (const [source, dmg] of damageSources.slice(0, maxActions)) {
      const enemy = GameDatabase.getEnemy(source);
      const name = enemy ? entity('enemy', source, enemy.displayName) : source;

      g.fillStyle = '#8892b0';
      g.fillText(name.toUpperCase(), dmgLabelX, dy);

      // Draw bar
      const barMaxW = colW - 140;
      const barW = (dmg / maxDmg) * barMaxW;
      
      // Bar background
      g.fillStyle = 'rgba(255, 71, 87, 0.1)';
      g.fillRect(dmgBarX, dy - 6, barMaxW, 12);

      // Glowing bar fill
      g.save();
      g.fillStyle = '#ff4757';
      g.shadowColor = '#ff4757';
      g.shadowBlur = 8;
      g.fillRect(dmgBarX, dy - 6, barW, 12);
      g.restore();

      // Dmg text
      g.fillStyle = '#ffffff';
      g.fillText(`${Math.round(dmg)} DMG`, dmgBarX + 5 + barW, dy);

      dy += isMobile ? 30 : 36;
    }
  }
}
