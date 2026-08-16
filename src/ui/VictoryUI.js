// VictoryUI.js — demo cleared screen with full run statistics.
// Mirrors scripts/ui/VictoryUI.gd.

import { GameManager } from '../core/GameManager.js?v=20260725-4';
import { GameState } from '../core/GameState.js?v=20260725-4';
import { GameDatabase } from '../core/GameDatabase.js?v=20260725-4';
import { AudioManager } from '../systems/AudioManager.js?v=20260725-4';
import { drawStatsChart } from './StatsChart.js?v=20260725-4';
import { escapeHtml } from './safeHtml.js?v=20260725-4';
import { entity, t } from '../i18n/I18n.js?v=20260725-4';
import { runRecords } from '../systems/RunArchive.js?v=20260725-4';
import { runReceipt } from '../systems/RunVerification.js?v=20260725-4';
import { combineReplayDigests } from '../systems/RunReplay.js?v=20260725-4';

export class VictoryUI {
  constructor() {
    this.el = document.getElementById('screen-victory');
    this.canvas = document.getElementById('chart-victory');
    this.btn = document.getElementById('btn-victory-menu');
    this.replayBtn = document.getElementById('btn-victory-replay');
    this.statsEl = document.getElementById('victory-run-stats');
    this.rulesEl = document.getElementById('victory-rules-summary');
    this.receiptEl = document.getElementById('victory-receipt');
    this.copyReceiptBtn = document.getElementById('btn-copy-victory-receipt');

    this.btn.addEventListener('click', () => {
      AudioManager.play('button_click');
      GameManager.goMainMenu();
    });
    this.replayBtn?.addEventListener('click', () => {
      AudioManager.play('button_click');
      GameState.resetRun();
      GameManager.goLogicEdit();
    });
    this.copyReceiptBtn?.addEventListener('click', async () => {
      const receipt = this.receiptEl?.textContent?.trim() || '';
      if (!receipt) return;
      try {
        if (!navigator.clipboard?.writeText) throw new Error('clipboard unavailable');
        await navigator.clipboard.writeText(receipt);
        const original = this.copyReceiptBtn.textContent;
        this.copyReceiptBtn.textContent = t('victory.receiptCopied');
        setTimeout(() => { this.copyReceiptBtn.textContent = original; }, 1400);
      } catch {
        this.copyReceiptBtn.textContent = t('victory.receiptManual');
      }
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
    this.replayBtn?.focus();
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
    const replayDigests = Array.isArray(runStats.replayDigests)
      ? runStats.replayDigests
      : (report._replayDigest ? [report._replayDigest] : []);
    const records = runRecords();
    const receipt = runReceipt({
      mode: GameState.runConfig?.mode,
      difficulty: GameState.runConfig?.difficulty,
      seed: GameState.runConfig?.seed,
      battlesWon,
      totalDamageDealt: dmgDealt,
      totalBattleTime: totalTime,
      finalHp,
      rulesCount: ruleCount,
      upgrades,
      simulationVersion: report._simulationVersion,
      simulationStep: report._simulationStep,
      replayDigest: combineReplayDigests(replayDigests),
    });
    if (this.receiptEl) this.receiptEl.textContent = receipt;

    this.statsEl.innerHTML = `
      <div class="victory-stat"><span class="stat-label">${t('victory.battles')}</span><span class="stat-value">${battlesWon}</span></div>
      <div class="victory-stat"><span class="stat-label">${t('victory.finalHp')}</span><span class="stat-value">${finalHp === null ? '—' : Math.round(finalHp)}</span></div>
      <div class="victory-stat"><span class="stat-label">${t('victory.totalDamage')}</span><span class="stat-value">${Math.round(dmgDealt)}</span></div>
      <div class="victory-stat"><span class="stat-label">${t('victory.time')}</span><span class="stat-value">${totalTime.toFixed(1)}s</span></div>
      <div class="victory-stat"><span class="stat-label">${t('victory.activeRules')}</span><span class="stat-value">${ruleCount}</span></div>
      <div class="victory-stat"><span class="stat-label">${t('victory.upgrades')}</span><span class="stat-value">${upgrades}</span></div>
      <div class="victory-stat"><span class="stat-label">${t('victory.clears')}</span><span class="stat-value">${records.completions}</span></div>
      <div class="victory-stat"><span class="stat-label">${t('victory.personalBest')}</span><span class="stat-value">${records.bestTime === null ? '—' : `${records.bestTime.toFixed(1)}s`}</span></div>
    `;
  }

  _renderRulesSummary() {
    if (!this.rulesEl) return;
    const rules = [...GameState.rules].sort((a, b) => b.priority - a.priority);
    if (rules.length === 0) {
      this.rulesEl.innerHTML = `<p class="muted" style="font-size:12px;">${escapeHtml(t('editor.noRules'))}</p>`;
      return;
    }
    const items = rules.map(r => {
      const condition = GameDatabase.getCondition?.(r.conditionId);
      const action = GameDatabase.getAction?.(r.actionId);
      const cond = entity('condition', r.conditionId, condition?.displayName || r.conditionId || '?');
      const act = entity('action', r.actionId, action?.displayName || r.actionId || '?');
      const op = r.operator && r.conditionId2 ? ` ${r.operator.toUpperCase()} ${entity('condition', r.conditionId2, r.conditionId2)}` : '';
      return `<li><span class="rule-prio-badge">${escapeHtml(r.priority)}</span> IF <span class="rule-cond">${escapeHtml(cond + op)}</span> → <span class="rule-act">${escapeHtml(act)}</span></li>`;
    }).join('');
    this.rulesEl.innerHTML = `<ul class="victory-rules-list">${items}</ul>`;
  }
}
