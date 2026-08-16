// PostBattleReportUI.js — failure debug report. Mirrors scripts/ui/PostBattleReportUI.gd.

import { GameState } from '../core/GameState.js?v=20260725-4';
import { GameManager } from '../core/GameManager.js?v=20260725-4';
import { GameDatabase } from '../core/GameDatabase.js?v=20260725-4';
import { buildReport } from '../systems/PostBattleReportBuilder.js?v=20260725-4';
import { AudioManager } from '../systems/AudioManager.js?v=20260725-4';
import { drawStatsChart } from './StatsChart.js?v=20260725-4';
import { escapeHtml } from './safeHtml.js?v=20260725-4';
import { entity, t } from '../i18n/I18n.js?v=20260725-4';

export class PostBattleReportUI {
  constructor() {
    this.el = document.getElementById('screen-report');
    this.repDamage = document.getElementById('rep-damage');
    this.repLogic  = document.getElementById('rep-logic');
    this.repSuggest = document.getElementById('rep-suggest');
    this.repTimeline = document.getElementById('rep-timeline');
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
    this.btnRestart.addEventListener('click', () => {
      AudioManager.play('button_click');
      GameManager.onReportRestartRun();
    });
    this.btnTimelineToggle?.addEventListener('click', () => {
      this._showAllTimeline = !this._showAllTimeline;
      this._renderTimeline(this._timelineEvents);
    });
  }

  show() {
    this._showAllTimeline = false;
    const report = GameState.lastReport || {};
    const availableActions = GameState.availableActionIds();
    const availableConditions = GameState.availableConditionIds();
    const built = buildReport(report, availableActions, availableConditions);
    
    this.repDamage.innerHTML = built.damage_lines.map(s => `<li>${escapeHtml(s)}</li>`).join('');
    
    // Logic report enriched with action usage stats
    const actionUsage = report.action_usage || {};
    const allActions = GameState.availableActionIds();
    let logicHtml = built.logic_lines.map(s => `<li>${escapeHtml(s)}</li>`).join('');

    // Add action frequency section
    const usedActions = allActions.filter(a => actionUsage[a] > 0)
      .sort((a, b) => (actionUsage[b] || 0) - (actionUsage[a] || 0));
    const unusedActions = allActions.filter(a => !actionUsage[a] && a !== 'basic_attack');

    if (usedActions.length > 0) {
      logicHtml += `<li style="margin-top: 8px; border-top: 1px solid var(--line); padding-top: 8px; color: var(--muted); font-size: 10px;">${escapeHtml(t('report.frequency'))}</li>`;
      for (const a of usedActions) {
        const count = actionUsage[a] || 0;
        const bar = '█'.repeat(Math.min(count, 20)) + '░'.repeat(Math.max(0, 20 - count));
        logicHtml += `<li style="font-family: monospace; font-size: 10px;"><span style="color: #4be1ff; display: inline-block; width: 130px;">${escapeHtml(entity('action', a, a))}</span> ${escapeHtml(count)}× <span style="color: #1a4a55;">${bar}</span></li>`;
      }
    }
    const enemyKills = report.enemy_kills || {};
    const killEntries = Object.entries(enemyKills)
      .filter(([, count]) => Number(count) > 0)
      .sort((a, b) => Number(b[1]) - Number(a[1]));
    if (killEntries.length > 0) {
      logicHtml += `<li style="margin-top: 8px; border-top: 1px solid var(--line); padding-top: 8px; color: var(--muted); font-size: 10px;">${escapeHtml(t('report.kills'))}</li>`;
      for (const [enemyId, count] of killEntries) {
        const enemy = GameDatabase.getEnemy(enemyId);
        const name = entity('enemy', enemyId, enemy?.displayName || enemyId);
        logicHtml += `<li style="font-family: monospace; font-size: 10px;"><span style="color: #ff9d6c; display: inline-block; width: 130px;">${escapeHtml(name)}</span> ${escapeHtml(Number(count))}×</li>`;
      }
    }
    const repairEntries = Object.entries(report.enemy_repairs || {})
      .filter(([, amount]) => Number(amount) > 0)
      .sort((a, b) => Number(b[1]) - Number(a[1]));
    if (repairEntries.length > 0) {
      logicHtml += `<li style="margin-top: 8px; border-top: 1px solid var(--line); padding-top: 8px; color: var(--muted); font-size: 10px;">${escapeHtml(t('report.enemyRepairs'))}</li>`;
      for (const [enemyId, amount] of repairEntries) {
        const enemy = GameDatabase.getEnemy(enemyId);
        const name = entity('enemy', enemyId, enemy?.displayName || enemyId);
        logicHtml += `<li style="font-family: monospace; font-size: 10px;"><span style="color: #55ffb0; display: inline-block; width: 130px;">${escapeHtml(name)}</span> ${escapeHtml(t('report.enemyRepairLine', { value: Math.round(amount) }))}</li>`;
      }
    }
    if (unusedActions.length > 0) {
      logicHtml += `<li style="color: #ff6b6b; font-size: 10px; margin-top: 6px;">${escapeHtml(t('report.neverTriggered', { actions: unusedActions.map(a => entity('action', a, a)).join(', ') }))}</li>`;
    }
    this.repLogic.innerHTML = logicHtml;

    this._renderTimeline(report.timeline || []);
    
    // Clear and build suggestions with interactive Auto-Add buttons
    this.repSuggest.innerHTML = '';
    for (const sug of built.suggestions) {
      const li = document.createElement('li');
      li.style.display = 'flex';
      li.style.justifyContent = 'space-between';
      li.style.alignItems = 'center';
      li.style.gap = '12px';
      li.style.padding = '4px 0';

      const spanText = document.createElement('span');
      spanText.textContent = sug.text;
      li.appendChild(spanText);

      if (sug.rule) {
        const addBtn = document.createElement('button');
        addBtn.className = 'btn small primary';
        addBtn.textContent = t('report.autoAdd');
        addBtn.style.padding = '3px 8px';
        addBtn.style.fontSize = '10px';
        addBtn.style.minHeight = '24px';
        addBtn.style.whiteSpace = 'nowrap';
        
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
          addBtn.style.opacity = '0.6';
        });
        li.appendChild(addBtn);
      }
      this.repSuggest.appendChild(li);
    }
    
    // Draw performance charts
    drawStatsChart(this.canvas, report);
    this.btnRetry?.focus();
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
          source: entity('enemy', event.source, event.source),
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
      } else {
        text.textContent = t('report.timelineWave', { wave: event.wave, total: event.total });
      }
      item.append(time, text);
      this.repTimeline.appendChild(item);
    }
  }
}
