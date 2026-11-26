// PostBattleReportUI.js — failure debug report. Mirrors scripts/ui/PostBattleReportUI.gd.

import { GameState } from '../core/GameState.js?v=20260725-4';
import { GameManager } from '../core/GameManager.js?v=20260725-4';
import { GameDatabase } from '../core/GameDatabase.js?v=20260725-4';
import { buildReport, damageSourceLabel } from '../systems/PostBattleReportBuilder.js?v=20260725-4';
import { AudioManager } from '../systems/AudioManager.js?v=20260725-4';
import { drawStatsChart } from './StatsChart.js?v=20260725-4';
import { escapeHtml } from './safeHtml.js?v=20260725-4';
import { entity, t } from '../i18n/I18n.js?v=20260725-4';
import { copyText } from './Clipboard.js?v=20260725-4';

export class PostBattleReportUI {
  constructor(requestConfirm) {
    this.requestConfirm = requestConfirm;
    this.el = document.getElementById('screen-report');
    this.repDamage = document.getElementById('rep-damage');
    this.repLogic  = document.getElementById('rep-logic');
    this.repSuggest = document.getElementById('rep-suggest');
    this.repTimeline = document.getElementById('rep-timeline');
    this.repReplayDigest = document.getElementById('rep-replay-digest');
    this.repSimulationFacts = document.getElementById('rep-simulation-facts');
    this.btnCopyReplay = document.getElementById('btn-copy-report-replay');
    this.btnTimelineToggle = document.getElementById('btn-report-timeline-toggle');
    this.canvas = document.getElementById('chart-report');
    this.btnRetry  = document.getElementById('btn-retry');
    this.btnEdit   = document.getElementById('btn-edit');
    this.btnRestart = document.getElementById('btn-restart');
    this._timelineEvents = [];
    this._showAllTimeline = false;
    this._bind();

    // Redraw charts on window resize to ensure high-DPI canvas looks sharp
    window.addEventListener('resize', () => {
      if (this.el && !this.el.classList.contains('hidden')) {
        const report = GameState.lastReport || {};
        drawStatsChart(this.canvas, report);
      }
    });
  }

  _bind() {
    this.btnRetry.addEventListener('click', () => {
      AudioManager.play('button_click');
      GameManager.onReportRetryBattle();
    });
    this.btnEdit.addEventListener('click', () => {
      AudioManager.play('button_click');
      GameManager.onReportEditLogic();
    });
    this.btnRestart.addEventListener('click', async () => {
      AudioManager.play('button_click');
      if (await this.requestConfirm('report.restartConfirm', this.btnRestart)) GameManager.onReportRestartRun();
    });
    this.btnTimelineToggle?.addEventListener('click', () => {
      this._showAllTimeline = !this._showAllTimeline;
      this._renderTimeline(this._timelineEvents);
    });
    this.btnCopyReplay?.addEventListener('click', async () => {
      const digest = this.repReplayDigest?.textContent?.trim() || '';
      const copied = await copyText(digest === '—' ? '' : digest);
      const original = this.btnCopyReplay.textContent;
      this.btnCopyReplay.textContent = t(copied ? 'report.replayCopied' : 'report.replayManual');
      if (copied) window.setTimeout(() => { this.btnCopyReplay.textContent = original; }, 1400);
    });
  }

  show() {
    this._showAllTimeline = false;
    for (const details of this.el.querySelectorAll('details')) details.open = false;
    const report = GameState.lastReport || {};
    const availableActions = GameState.availableActionIds();
    const availableConditions = GameState.availableConditionIds();
    const built = buildReport(report, availableActions, availableConditions);
    this._renderIntegrity(report);
    document.getElementById('report-outcome').textContent = built.outcome;
    
    this.repDamage.innerHTML = built.damage_lines.map(s => `<li>${escapeHtml(s)}</li>`).join('');
    
    // Logic report enriched with action usage stats
    const actionUsage = report.action_usage || {};
    const allActions = GameState.availableActionIds();
    let logicHtml = built.logic_lines.map(s => `<li>${escapeHtml(s)}</li>`).join('');

    // Add action frequency section
    const usedActions = allActions.filter(a => actionUsage[a] > 0)
      .sort((a, b) => (actionUsage[b] || 0) - (actionUsage[a] || 0));

    if (usedActions.length > 0) {
      logicHtml += `<li class="report-metric-heading">${escapeHtml(t('report.frequency'))}</li>`;
      for (const a of usedActions) {
        const count = actionUsage[a] || 0;
        logicHtml += `<li class="report-metric"><span>${escapeHtml(entity('action', a, a))}</span>
          <strong>${escapeHtml(count)}×</strong>
          <meter aria-hidden="true" min="0" max="${Number(actionUsage[usedActions[0]])}" value="${Number(count)}"></meter></li>`;
      }
    }
    const enemyKills = report.enemy_kills || {};
    const killEntries = Object.entries(enemyKills)
      .filter(([, count]) => Number(count) > 0)
      .sort((a, b) => Number(b[1]) - Number(a[1]));
    if (killEntries.length > 0) {
      logicHtml += `<li class="report-metric-heading">${escapeHtml(t('report.kills'))}</li>`;
      for (const [enemyId, count] of killEntries) {
        const enemy = GameDatabase.getEnemy(enemyId);
        const name = entity('enemy', enemyId, enemy?.displayName || enemyId);
        logicHtml += `<li class="report-metric"><span>${escapeHtml(name)}</span> ${escapeHtml(Number(count))}×</li>`;
      }
    }
    const repairEntries = Object.entries(report.enemy_repairs || {})
      .filter(([, amount]) => Number(amount) > 0)
      .sort((a, b) => Number(b[1]) - Number(a[1]));
    if (repairEntries.length > 0) {
      logicHtml += `<li class="report-metric-heading">${escapeHtml(t('report.enemyRepairs'))}</li>`;
      for (const [enemyId, amount] of repairEntries) {
        const enemy = GameDatabase.getEnemy(enemyId);
        const name = entity('enemy', enemyId, enemy?.displayName || enemyId);
        logicHtml += `<li class="report-metric"><span>${escapeHtml(name)}</span> ${escapeHtml(t('report.enemyRepairLine', { value: Math.round(amount) }))}</li>`;
      }
    }
    const shieldEntries = Object.entries(report.enemy_shield_mitigation || {})
      .filter(([, amount]) => Number(amount) > 0)
      .sort((a, b) => Number(b[1]) - Number(a[1]));
    if (shieldEntries.length > 0) {
      logicHtml += `<li class="report-metric-heading">${escapeHtml(t('report.enemyShields'))}</li>`;
      for (const [enemyId, amount] of shieldEntries) {
        const enemy = GameDatabase.getEnemy(enemyId);
        const name = entity('enemy', enemyId, enemy?.displayName || enemyId);
        const castInfo = report.enemy_shields?.[enemyId];
        const casts = Number(castInfo?.casts) || 0;
        logicHtml += `<li class="report-metric"><span>${escapeHtml(name)}</span> ${escapeHtml(t('report.enemyShieldLine', { casts, value: Math.round(amount) }))}</li>`;
      }
    }
    this.repLogic.innerHTML = logicHtml;

    this._renderTimeline(report.timeline || []);
    
    // Clear and build suggestions with interactive Auto-Add buttons
    this.repSuggest.innerHTML = '';
    const others = document.getElementById('rep-other-suggest');
    others.replaceChildren();
    others.parentElement.hidden = built.suggestions.length < 2;
    for (const [index, sug] of built.suggestions.entries()) {
      const li = document.createElement('li');
      const spanText = document.createElement('span');
      spanText.textContent = sug.text;
      li.appendChild(spanText);

      if (sug.rule) {
        const addBtn = document.createElement('button');
        addBtn.type = 'button';
        addBtn.className = 'btn small primary';
        addBtn.textContent = t('report.autoAdd');
        const existing = GameState.rules.some(rule => rule.enabled !== false && !rule.operator &&
          !rule.negateCondition1 && rule.conditionId === sug.rule.conditionId && rule.actionId === sug.rule.actionId &&
          rule.priority >= sug.rule.priority && JSON.stringify(rule.conditionValue) === JSON.stringify(sug.rule.conditionValue));
        if (existing) {
          addBtn.disabled = true;
          addBtn.textContent = t('report.configured');
        }

        
        addBtn.addEventListener('click', () => {
          const added = GameState.addRule(
            sug.rule.conditionId,
            sug.rule.conditionValue,
            sug.rule.actionId,
            sug.rule.priority
          );
          AudioManager.play(added ? 'rule_add' : 'button_click');
          addBtn.disabled = true;
          addBtn.textContent = t(added ? 'report.added' : 'report.unavailable');
          addBtn.classList.remove('primary');

        });
        li.appendChild(addBtn);
      }
      (index === 0 ? this.repSuggest : others).appendChild(li);
    }
    
    // Draw performance charts
    drawStatsChart(this.canvas, report);
    this.el.scrollTop = 0;
    this.btnEdit?.focus({ preventScroll: true });
  }

  _renderIntegrity(report) {
    const digest = /^RPL\d+-[0-9A-F]{8}$/.test(String(report?._replayDigest || ''))
      ? String(report._replayDigest) : '—';
    const version = Number.isFinite(Number(report?._simulationVersion)) ? Number(report._simulationVersion) : 1;
    const step = Number.isFinite(Number(report?._simulationStep)) ? Number(report._simulationStep) : 1 / 60;
    if (this.repReplayDigest) this.repReplayDigest.textContent = digest;
    if (this.repSimulationFacts) {
      this.repSimulationFacts.textContent = t('report.simulationFacts', {
        version,
        step: (step * 1000).toFixed(1),
      });
    }
    if (this.btnCopyReplay) this.btnCopyReplay.disabled = digest === '—';
  }

  _renderTimeline(events) {
    if (!this.repTimeline) return;
    this._timelineEvents = Array.isArray(events) ? events : [];
    if (this.btnTimelineToggle) {
      const canExpand = this._timelineEvents.filter((event) => event.kind !== 'damage' || event.value >= 4).length > 16;
      this.btnTimelineToggle.classList.toggle('hidden', !canExpand);
      this.btnTimelineToggle.textContent = this._showAllTimeline
        ? t('report.timelineCollapse') : t('report.timelineExpand');
      this.btnTimelineToggle.setAttribute('aria-expanded', this._showAllTimeline ? 'true' : 'false');
    }
    this.repTimeline.replaceChildren();
    const allImportant = this._timelineEvents
      .filter((event) => event.kind !== 'damage' || event.value >= 4);
    const important = this._showAllTimeline ? allImportant : allImportant.slice(-16);
    if (important.length === 0) {
      const empty = document.createElement('li');
      empty.textContent = t('report.timelineEmpty');
      this.repTimeline.appendChild(empty);
      return;
    }
    for (const event of important) {
      const item = document.createElement('li');
      item.dataset.kind = event.kind;
      const time = document.createElement('time');
      time.textContent = `${Number(event.time || 0).toFixed(1)}s`;
      const text = document.createElement('span');
      if (event.kind === 'action') {
        text.textContent = t('report.timelineAction', {
          name: entity('action', event.actionId, event.actionId),
        });
      } else if (event.kind === 'damage') {
        text.textContent = t('report.timelineDamage', {
          value: Math.round(event.value || 0),
          source: damageSourceLabel(event.source),
        });
      } else if (event.kind === 'interrupt') {
        text.textContent = t('report.timelineInterrupt');
      } else if (event.kind === 'recall') {
        text.textContent = t('report.timelineRecall');
      } else if (event.kind === 'enemy_repair') {
        text.textContent = t('report.timelineRepair', {
          value: Math.round(event.value || 0),
          source: entity('enemy', event.source, event.source),
        });
      } else if (event.kind === 'enemy_shield') {
        text.textContent = t('report.timelineShield', {
          source: entity('enemy', event.source, event.source),
        });
      } else {
        text.textContent = t('report.timelineWave', { wave: event.wave, total: event.total });
      }
      item.append(time, text);
      this.repTimeline.appendChild(item);
    }
  }
}
