// BattleHUD.js — combat overlay. HP/Energy/Overlogic bars, current logic line, wave,
// timer, pause/speed/quit buttons, boss bar, phase toast. Mirrors scripts/ui/BattleHUD.gd.

import { GameManager } from '../core/GameManager.js?v=20260725-4';
import { AudioManager } from '../systems/AudioManager.js?v=20260725-4';
import { GameState } from '../core/GameState.js?v=20260725-4';
import { GameDatabase } from '../core/GameDatabase.js?v=20260725-4';
import { describeRule } from '../logic/LogicRule.js?v=20260725-4';
import { escapeHtml } from './safeHtml.js?v=20260725-4';
import { t } from '../i18n/I18n.js?v=20260725-4';

export class BattleHUD {
  constructor(arena) {
    this.arena = arena;   // CombatArena instance (set later by main)
    this.hpFill = document.getElementById('hp-fill');
    this.hpText = document.getElementById('hp-text');
    this.enFill = document.getElementById('en-fill');
    this.enText = document.getElementById('en-text');
    this.olFill = document.getElementById('ol-fill');
    this.olText = document.getElementById('ol-text');
    this.curLogic = document.getElementById('current-logic');
    this.decisionReason = document.getElementById('decision-reason');
    this.decisionTime = document.getElementById('decision-time');
    this.waveInfo = document.getElementById('wave-info');
    this.timerEl = document.getElementById('combat-timer');
    this.srSummary = document.getElementById('combat-sr-summary');
    this.btnPause = document.getElementById('btn-pause');
    this.btnStep  = document.getElementById('btn-step');
    this.btnSpeed = document.getElementById('btn-speed');
    this.btnQuit  = document.getElementById('btn-quit');
    this.inspectorToggle = document.getElementById('btn-combat-inspector');
    this.bossWrap = document.getElementById('boss-bar-wrap');
    this.bossName = document.getElementById('boss-name');
    this.bossFill = document.getElementById('boss-fill');
    this.phaseToast = document.getElementById('phase-toast');
    this.btnPause.setAttribute('aria-keyshortcuts', 'P');
    this.btnStep.setAttribute('aria-keyshortcuts', '.');
    this.btnSpeed.setAttribute('aria-keyshortcuts', 'S');
    this._lastRuleId = null;
    this._lastMeltdownState = false;
    this._lastSummaryText = '';
    this._lastSummaryAt = 0;
    this._bind();
    window.addEventListener('overlogic:localechange', () => {
      this.renderRulesPanel();
      this._lastRuleId = null;
      this.renderDecision();
      if (this.lastDiagnostics) this.updateDiagnostics(...this.lastDiagnostics);
      if (this.arena) {
        this.syncPauseControls();
        this.btnSpeed.textContent = t('combat.speed', { speed: this.arena.speed });
        this.setWave(this.arena.currentWave, this.arena.totalWaves);
      }
    });
  }

  logConsole(message, type = 'info') {
    const consoleEl = document.getElementById('combat-console-log');
    if (!consoleEl) return;
    const entry = document.createElement('div');
    entry.className = `console-entry ${type}`;
    const timePrefix = `[${this.arena ? this.arena.battleTime.toFixed(1) : '0.0'}s] `;
    entry.textContent = timePrefix + message;
    const follow = consoleEl.scrollHeight - consoleEl.clientHeight - consoleEl.scrollTop < 2;
    consoleEl.appendChild(entry);
    while (consoleEl.children.length > 50) {
      consoleEl.removeChild(consoleEl.firstChild);
    }
    if (follow) consoleEl.scrollTop = consoleEl.scrollHeight;
  }

  _bind() {
    this.inspectorToggle?.addEventListener('click', () => {
      const open = this.inspectorToggle.getAttribute('aria-expanded') !== 'true';
      this.inspectorToggle.setAttribute('aria-expanded', String(open));
      if (open) {
        const log = document.getElementById('combat-console-log');
        log.scrollTop = log.scrollHeight;
      }
    });
    this.btnPause.addEventListener('click', () => {
      if (!this.arena) return;
      this.arena.togglePause();
      this.syncPauseControls();
      AudioManager.play('button_click');
    });
    this.btnStep.addEventListener('click', () => {
      if (!this.arena) return;
      this.arena.stepFrame();
      AudioManager.play('button_click');
    });
    this.btnSpeed.addEventListener('click', () => {
      if (!this.arena) return;
      const s = this.arena.toggleSpeed();
      this.btnSpeed.textContent = t('combat.speed', { speed: s });
      AudioManager.play('button_click');
    });
    this.btnQuit.addEventListener('click', () => {
      AudioManager.play('button_click');
      if (this.arena) this.arena.stop();
      GameManager.goLogicEdit();
    });
    document.addEventListener('keydown', (event) => {
      if (document.getElementById('screen-combat')?.classList.contains('hidden')) return;
      if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return;
      if (document.getElementById('settings-overlay')?.classList.contains('hidden') === false) return;
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement || event.target instanceof HTMLTextAreaElement || event.target?.isContentEditable) return;
      if (event.key.toLowerCase() === 'p') {
        event.preventDefault();
        this.btnPause.click();
      } else if (event.key === '.' && this.arena?.paused) {
        event.preventDefault();
        this.btnStep.click();
      } else if (event.key.toLowerCase() === 's') {
        event.preventDefault();
        this.btnSpeed.click();
      }
    });
  }

  syncPauseControls() {
    const paused = this.arena?.paused === true;
    this.btnPause.textContent = t(paused ? 'combat.resume' : 'combat.pause');
    this.btnPause.setAttribute('aria-pressed', String(paused));
    this.btnStep.classList.toggle('hidden', !paused);
    const signal = document.getElementById('arena-feed-state');
    signal.dataset.i18n = paused ? 'combat.paused' : 'combat.liveSignal';
    signal.textContent = t(signal.dataset.i18n);
  }

  onBattleStart(battle) {
    this.inspectorToggle.setAttribute('aria-expanded', 'false');
    this.syncPauseControls();
    this.btnSpeed.textContent = t('combat.speed', { speed: 1 });
    this.lastDecision = null;
    this.lastDiagnostics = null;
    this.lastLoggedRule = null;
    this.renderDecision();
    this.hideBossBar();
    this.hidePhaseToast();
    this.renderRulesPanel();
    this._lastRuleId = null;
    this._lastMeltdownState = false;
    this._lastSummaryText = '';
    this._lastSummaryAt = 0;
    const consoleEl = document.getElementById('combat-console-log');
    if (consoleEl) consoleEl.innerHTML = '';
    this.logConsole(t('log.initialized'), 'success');
  }

  setHp(hp, mx) {
    this.hpFill.style.width = `${Math.max(0, (hp / mx) * 100)}%`;
    this.hpText.textContent = `${Math.max(0, hp)|0} / ${mx|0}`;
    const track = this.hpFill.parentElement;
    track?.setAttribute('aria-valuemax', String(Math.max(0, mx)));
    track?.setAttribute('aria-valuenow', String(Math.max(0, Math.min(mx, hp))));
    this._updateLiveSummary();
  }
  setEnergy(en, mx) {
    this.enFill.style.width = `${Math.max(0, (en / mx) * 100)}%`;
    this.enText.textContent = `${Math.max(0, en)|0} / ${mx|0}`;
    const track = this.enFill.parentElement;
    track?.setAttribute('aria-valuemax', String(Math.max(0, mx)));
    track?.setAttribute('aria-valuenow', String(Math.max(0, Math.min(mx, en))));
    this._updateLiveSummary();
  }
  setOverlogic(val, active) {
    this.olFill.style.width = `${Math.max(0, Math.min(100, val))}%`;
    this.olText.textContent = active ? t('combat.meltdown') : `${val|0}°C`;
    this.olFill.parentElement?.setAttribute('aria-valuenow', String(Math.max(0, Math.min(100, val))));
    this.olFill.classList.toggle('meltdown-pulse', active);

    const activeBool = !!active;
    if (activeBool && !this._lastMeltdownState) {
      this.logConsole(t('log.meltdown'), 'danger');
      AudioManager.play('boss_laser');
    } else if (!activeBool && this._lastMeltdownState) {
      this.logConsole(t('log.recovered'), 'success');
    }
    this._lastMeltdownState = activeBool;
    this._updateLiveSummary();
  }

  _updateLiveSummary() {
    if (!this.srSummary || !this.arena?.robot) return;
    const now = performance.now();
    if (now - this._lastSummaryAt < 1200) return;
    const robot = this.arena.robot;
    const next = t('combat.statusSummary', {
      hp: Math.max(0, robot.hp | 0), maxHp: robot.maxHp | 0,
      energy: Math.max(0, robot.energy | 0), maxEnergy: robot.maxEnergy | 0,
      temperature: this.olText?.textContent || '0',
      wave: t('combat.wave', { current: this.arena.currentWave, total: this.arena.totalWaves }),
    });
    this._lastSummaryAt = now;
    if (next === this._lastSummaryText) return;
    this._lastSummaryText = next;
    this.srSummary.textContent = next;
  }
  setShield(on)    { /* visual handled in renderer */ }
  setOverdrive(on) { /* visual handled in renderer */ }

  renderDecision() {
    const decision = this.lastDecision;
    if (!decision) {
      this.curLogic.textContent = t('combat.noActionYet');
      this.decisionReason.textContent = t('combat.waitingForRule');
      this.decisionTime.textContent = '';
      return;
    }
    const { condition, action } = describeRule(decision.rule, GameDatabase);
    if (this.curLogic.textContent !== action) this.curLogic.textContent = action;
    this.decisionReason.textContent = t('combat.triggeredBy', { condition, priority: decision.rule.priority });
    this.decisionTime.textContent = decision.time.toFixed(1) + ' s';
  }

  setCurrentLogic(label, rule, overlogicActive, diagnostics) {
    const executed = rule && diagnostics?.[rule.id] === 'executing';
    if (executed) {
      if (this.lastLoggedRule !== rule.id) {
        this.logConsole(t(overlogicActive ? 'log.overdrive' : 'log.executed', { label }), overlogicActive ? 'warn' : 'info');
        this.lastLoggedRule = rule.id;
      }
      this.lastDecision = { rule, time: this.arena.battleTime };
      this.renderDecision();
    }
    if (!executed) this.lastLoggedRule = null;
    const activeId = executed ? rule.id : null;
    if (this._lastRuleId === activeId) {
      if (activeId) document.getElementById(`combat-rule-${activeId}`)?.classList.toggle('overlogic', overlogicActive);
      return;
    }
    const previous = document.getElementById(`combat-rule-${this._lastRuleId}`);
    previous?.classList.remove('executing', 'overlogic');
    this._lastRuleId = activeId;
    if (!activeId) return;

    const active = document.getElementById(`combat-rule-${activeId}`);
    active?.classList.add('executing');
    active?.classList.toggle('overlogic', overlogicActive);
  }

  renderRulesPanel() {
    const rulesList = document.getElementById('combat-rules-list');
    if (!rulesList) return;
    rulesList.innerHTML = '';
    const sortedRules = [...GameState.rules].filter(rule => rule.enabled !== false).sort((a, b) => b.priority - a.priority);
    if (!sortedRules.length) {
      const empty = document.createElement('li');
      empty.textContent = t('combat.noEnabledRules');
      rulesList.appendChild(empty);
    }
    for (const r of sortedRules) {
      const li = document.createElement('li');
      li.id = `combat-rule-${r.id}`;
      li.className = 'combat-rule-item';
      
      const { condition, action } = describeRule(r, GameDatabase);
      li.innerHTML = `<strong class="c-act">${escapeHtml(action)}</strong><span class="c-cond">${escapeHtml(condition)}</span>`;
      rulesList.appendChild(li);
    }
  }

  updateDiagnostics(diagnostics, diagnosticReasons = {}) {
    this.lastDiagnostics = [diagnostics, diagnosticReasons];
    for (const [ruleId, state] of Object.entries(diagnostics)) {
      const li = document.getElementById(`combat-rule-${ruleId}`);
      if (!li) continue;
      const signature = state + '/' + (diagnosticReasons[ruleId] || '');
      if (li.dataset.diagnostic === signature) continue;
      li.dataset.diagnostic = signature;
      li.classList.remove('diag-disabled', 'diag-cooldown', 'diag-energy', 'diag-condition_false', 'diag-overridden', 'diag-executing', 'diag-pursuing', 'diag-action_unavailable');
      
      const oldBadge = li.querySelector('.diag-status-badge');
      if (oldBadge) oldBadge.remove();
      
      li.classList.add(`diag-${state}`);
      
      const reason = {
        executing: 'combat.active',
        cooldown: 'combat.onCooldown',
        energy: 'combat.lowEnergy',
        condition_false: 'combat.conditionUnmet',
        overridden: 'combat.lowerPriority',
        pursuing: 'combat.pursuing',
        action_unavailable: `diagnostic.reason.${diagnosticReasons[ruleId] || 'unknown'}`,
      }[state];
      if (reason) {
        const badge = document.createElement('span');
        badge.className = 'diag-status-badge';
        badge.textContent = t(reason);
        li.appendChild(badge);
      }
    }
  }

  setWave(cur, total) {
    this.waveInfo.textContent = t('combat.wave', { current: cur, total });
    this.waveInfo.classList.remove('incoming');
    this._updateLiveSummary();
  }
  setWaveIncoming(cur, total, seconds) {
    this.waveInfo.textContent = t('combat.incoming', {
      current: cur,
      total,
      seconds: seconds.toFixed(1),
    });
    this.waveInfo.classList.add('incoming');
  }
  setTimer(t) { this.timerEl.textContent = `${Math.max(0, t).toFixed(1)}s`; }

  showBossBar(name) { this.bossName.textContent = name; this.bossWrap.classList.remove('hidden'); }
  hideBossBar() { this.bossWrap.classList.add('hidden'); }
  setBossHp(hp, mx) {
    this.bossFill.style.width = `${Math.max(0, (hp / mx) * 100)}%`;
    const track = this.bossFill.parentElement;
    track?.setAttribute('aria-valuemax', String(Math.max(0, mx)));
    track?.setAttribute('aria-valuenow', String(Math.max(0, Math.min(mx, hp))));
  }

  showPhaseToast(text) { this.phaseToast.textContent = text; this.phaseToast.classList.remove('hidden'); }
  hidePhaseToast() { this.phaseToast.classList.add('hidden'); }
}
