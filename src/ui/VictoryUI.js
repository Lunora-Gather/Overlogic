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
import { copyText } from './Clipboard.js?v=20260725-4';
import { formatCond } from '../logic/LogicRule.js?v=20260725-4';

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
    this.replayDigestEl = document.getElementById('victory-replay-digest');
    this.simulationFactsEl = document.getElementById('victory-simulation-facts');
    this.challengeLink = document.getElementById('victory-challenge-link');
    const copyChallenge = document.getElementById('btn-victory-challenge');
    const copyStatus = document.getElementById('victory-copy-status');
    copyChallenge.addEventListener('click', async () => {
      const copied = await copyText(this.challengeLink.value);
      if (this.el.classList.contains('hidden')) return;
      const message = t(copied ? 'victory.challengeCopied' : 'victory.challengeManual');
      copyStatus.textContent = message;
      if (copied) {
        copyChallenge.textContent = message;
      } else {
        this.challengeLink.hidden = false;
        this.challengeLink.focus();
        this.challengeLink.select();
      }
    });
    this.copyReplayBtn = document.getElementById('btn-copy-victory-replay');

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
        if (!await copyText(receipt)) throw new Error('clipboard unavailable');
        const original = this.copyReceiptBtn.textContent;
        this.copyReceiptBtn.textContent = t('victory.receiptCopied');
        setTimeout(() => { this.copyReceiptBtn.textContent = original; }, 1400);
      } catch {
        this.copyReceiptBtn.textContent = t('victory.receiptManual');
      }
    });
    this.copyReplayBtn?.addEventListener('click', async () => {
      const digest = this.replayDigestEl?.textContent?.trim() || '';
      const copied = await copyText(digest === '—' ? '' : digest);
      const original = this.copyReplayBtn.textContent;
      this.copyReplayBtn.textContent = t(copied ? 'victory.replayCopied' : 'victory.replayManual');
      if (copied) setTimeout(() => { this.copyReplayBtn.textContent = original; }, 1400);
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
    const url = new URL('./', location.href);
    url.searchParams.set('challenge', GameState.exportRunCode());
    this.challengeLink.value = url.href;
    this.challengeLink.hidden = true;
    document.getElementById('victory-copy-status').textContent = '';
    document.getElementById('btn-victory-challenge').textContent = t('victory.challengeLink');
    this._renderStats(report);
    this._renderRulesSummary();
    this.el.scrollTop = 0;
    document.getElementById('victory-title').focus({ preventScroll: true });
  }

  _renderStats(report) {
    if (!this.statsEl) return;
    const rules = GameState.rules;
    const ruleCount = rules.length;
    const activeRuleCount = rules.filter(rule => rule.enabled).length;
    const finalHp = report._endHp ?? null;
    const runStats = GameState.runStats || {};
    const dmgDealt = runStats.totalDamageDealt ?? 0;
    const battlesWon = runStats.battlesWon ?? 0;
    const totalTime = runStats.totalBattleTime ?? 0;
    const upgrades = Array.isArray(runStats.rewardsChosen) ? runStats.rewardsChosen.length : 0;
    const replayDigests = Array.isArray(runStats.replayDigests)
      ? runStats.replayDigests
      : (report._replayDigest ? [report._replayDigest] : []);
    const replayDigest = combineReplayDigests(replayDigests);
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
      replayDigest,
    });
    if (this.receiptEl) this.receiptEl.textContent = receipt;
    if (this.replayDigestEl) this.replayDigestEl.textContent = replayDigest;
    if (this.simulationFactsEl) {
      this.simulationFactsEl.textContent = t('victory.simulationFacts', {
        version: Number(report._simulationVersion) || 1,
        step: ((Number(report._simulationStep) || 1 / 60) * 1000).toFixed(1),
      });
    }
    if (this.copyReplayBtn) this.copyReplayBtn.disabled = !/^RPL\d+-[0-9A-F]{8}$/.test(replayDigest);

    const seconds = value => t('reward.unit.seconds', { value: value.toFixed(1) });
    const stats = [
      ['battles', battlesWon],
      ['finalHp', finalHp === null ? '—' : `${Math.round(finalHp)} / ${Math.round(GameState.stats.max_hp)}`],
      ['totalDamage', Math.round(dmgDealt)],
      ['time', seconds(totalTime)],
      ['activeRules', activeRuleCount],
      ['upgrades', upgrades],
      ['clears', records.completions],
      ['personalBest', records.bestTime === null ? '—' : seconds(records.bestTime)],
    ];
    this.statsEl.innerHTML = stats.map(([key, value]) =>
      `<div class="victory-stat"><dt>${escapeHtml(t(`victory.${key}`))}</dt><dd>${escapeHtml(value)}</dd></div>`).join('');
  }

  _renderRulesSummary() {
    if (!this.rulesEl) return;
    const rules = [...GameState.rules].sort((a, b) => b.priority - a.priority);
    if (rules.length === 0) {
      this.rulesEl.innerHTML = `<p class="muted" style="font-size:12px;">${escapeHtml(t('editor.noRules'))}</p>`;
      return;
    }
    const items = rules.map(r => {
      const action = GameDatabase.getAction?.(r.actionId);
      const cond1 = formatCond(r.conditionId, r.conditionValue, GameDatabase, r.negateCondition1);
      const cond2 = r.operator && r.conditionId2
        ? formatCond(r.conditionId2, r.conditionValue2, GameDatabase, r.negateCondition2)
        : '';
      const cond = cond2 ? `${cond1} ${t(`rule.${r.operator}`)} ${cond2}` : cond1;
      const act = entity('action', r.actionId, action?.displayName || r.actionId || '?');
      const target = r.targetPriority && r.targetPriority !== 'nearest'
        ? ` (${t(`target.${r.targetPriority}`)})`
        : '';
      return `<li><span class="rule-prio-badge">${escapeHtml(r.priority)}</span> ${escapeHtml(t('combat.if'))} <span class="rule-cond">${escapeHtml(cond)}</span> ${escapeHtml(t('combat.then'))} <span class="rule-act">${escapeHtml(act + target)}</span></li>`;
    }).join('');
    this.rulesEl.innerHTML = `<ul class="victory-rules-list">${items}</ul>`;
  }
}
