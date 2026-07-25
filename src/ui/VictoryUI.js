// VictoryUI.js — demo cleared screen with full run statistics.
// Mirrors scripts/ui/VictoryUI.gd.

import { GameManager } from '../core/GameManager.js';
import { GameState } from '../core/GameState.js';
import { AudioManager } from '../systems/AudioManager.js';
import { drawStatsChart } from './StatsChart.js';
import { escapeHtml } from './safeHtml.js';

export class VictoryUI {
  constructor() {
    this.el = document.getElementById('screen-victory');
    this.canvas = document.getElementById('chart-victory');
    this.btn = document.getElementById('btn-victory-menu');
    this.statsEl = document.getElementById('victory-run-stats');
    this.rulesEl = document.getElementById('victory-rules-summary');

    this.btn.addEventListener('click', () => {
      AudioManager.play('button_click');
      GameManager.goMainMenu();
    });

    // Redraw on resize
    window.addEventListener('resize', () => {
      if (this.el && !this.el.classList.contains('hidden')) {
        const report = GameState.lastReport || {};
        drawStatsChart(this.canvas, report);
      }
    });
  }

  show() {
    const report = GameState.lastReport || {};
    drawStatsChart(this.canvas, report);
    this._renderStats(report);
    this._renderRulesSummary();
  }

  _renderStats(report) {
    if (!this.statsEl) return;
    const rules = GameState.rules;
    const ruleCount = rules.length;
    const finalHp = report._endHp ?? null;
    const runStats = GameState.runStats || {};
    const dmgDealt = runStats.totalDamageDealt ?? 0;
    const battlesWon = runStats.battlesWon ?? 0;
    const totalTime = runStats.totalBattleTime ?? 0;
    const upgrades = Array.isArray(runStats.rewardsChosen) ? runStats.rewardsChosen.length : 0;

    this.statsEl.innerHTML = `
      <div class="victory-stat"><span class="stat-label">Battles Won</span><span class="stat-value">${battlesWon}</span></div>
      <div class="victory-stat"><span class="stat-label">Final HP</span><span class="stat-value">${finalHp === null ? '—' : Math.round(finalHp)}</span></div>
      <div class="victory-stat"><span class="stat-label">Total Damage</span><span class="stat-value">${Math.round(dmgDealt)}</span></div>
      <div class="victory-stat"><span class="stat-label">Combat Time</span><span class="stat-value">${totalTime.toFixed(1)}s</span></div>
      <div class="victory-stat"><span class="stat-label">Active Rules</span><span class="stat-value">${ruleCount}</span></div>
      <div class="victory-stat"><span class="stat-label">Upgrades Acquired</span><span class="stat-value">${upgrades}</span></div>
    `;
  }

  _renderRulesSummary() {
    if (!this.rulesEl) return;
    const rules = [...GameState.rules].sort((a, b) => b.priority - a.priority);
    if (rules.length === 0) {
      this.rulesEl.innerHTML = '<p class="muted" style="font-size:12px;">No rules defined.</p>';
      return;
    }
    const items = rules.map(r => {
      const cond = r.conditionId || '?';
      const act = r.actionId || '?';
      const op = r.operator && r.conditionId2 ? ` ${r.operator.toUpperCase()} ${r.conditionId2}` : '';
      return `<li><span class="rule-prio-badge">${escapeHtml(r.priority)}</span> IF <span class="rule-cond">${escapeHtml(cond + op)}</span> → <span class="rule-act">${escapeHtml(act)}</span></li>`;
    }).join('');
    this.rulesEl.innerHTML = `<ul class="victory-rules-list">${items}</ul>`;
  }
}
