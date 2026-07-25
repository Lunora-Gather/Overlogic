// BattleHUD.js — combat overlay. HP/Energy/Overlogic bars, current logic line, wave,
// timer, pause/speed/quit buttons, boss bar, phase toast. Mirrors scripts/ui/BattleHUD.gd.

import { GameManager } from '../core/GameManager.js';
import { AudioManager } from '../systems/AudioManager.js';
import { GameState } from '../core/GameState.js';
import { GameDatabase } from '../core/GameDatabase.js';
import { formatCond } from '../logic/LogicRule.js';
import { escapeHtml } from './safeHtml.js';

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
    this.waveInfo = document.getElementById('wave-info');
    this.timerEl = document.getElementById('combat-timer');
    this.btnPause = document.getElementById('btn-pause');
    this.btnStep  = document.getElementById('btn-step');
    this.btnSpeed = document.getElementById('btn-speed');
    this.btnQuit  = document.getElementById('btn-quit');
    this.bossWrap = document.getElementById('boss-bar-wrap');
    this.bossName = document.getElementById('boss-name');
    this.bossFill = document.getElementById('boss-fill');
    this.phaseToast = document.getElementById('phase-toast');
    this._lastRuleId = null;
    this._lastMeltdownState = false;
    this._bind();
  }

  logConsole(message, type = 'info') {
    const consoleEl = document.getElementById('combat-console-log');
    if (!consoleEl) return;
    const entry = document.createElement('div');
    entry.className = `console-entry ${type}`;
    const timePrefix = `[${this.arena ? this.arena.battleTime.toFixed(1) : '0.0'}s] `;
    entry.textContent = timePrefix + message;
    consoleEl.appendChild(entry);
    while (consoleEl.children.length > 50) {
      consoleEl.removeChild(consoleEl.firstChild);
    }
    consoleEl.scrollTop = consoleEl.scrollHeight;
  }

  _bind() {
    this.btnPause.addEventListener('click', () => {
      if (!this.arena) return;
      this.arena.togglePause();
      this.btnPause.textContent = this.arena.paused ? 'Resume' : 'Pause';
      this.btnStep.classList.toggle('hidden', !this.arena.paused);
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
      this.btnSpeed.textContent = `Speed x${s}`;
      AudioManager.play('button_click');
    });
    this.btnQuit.addEventListener('click', () => {
      AudioManager.play('button_click');
      if (this.arena) this.arena.stop();
      GameManager.goLogicEdit();
    });
    document.addEventListener('keydown', (event) => {
      if (document.getElementById('screen-combat')?.classList.contains('hidden')) return;
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement) return;
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

  onBattleStart(battle) {
    this.btnPause.textContent = 'Pause';
    this.btnStep.classList.add('hidden');
    this.btnSpeed.textContent = 'Speed x1';
    this.curLogic.textContent = 'Current Logic: —';
    this.curLogic.classList.remove('overlogic');
    this.hideBossBar();
    this.hidePhaseToast();
    this.renderRulesPanel();
    this._lastRuleId = null;
    this._lastMeltdownState = false;
    const consoleEl = document.getElementById('combat-console-log');
    if (consoleEl) consoleEl.innerHTML = '';
    this.logConsole('Directive Engine initialized...', 'success');
  }

  setHp(hp, mx) {
    this.hpFill.style.width = `${Math.max(0, (hp / mx) * 100)}%`;
    this.hpText.textContent = `${Math.max(0, hp)|0} / ${mx|0}`;
  }
  setEnergy(en, mx) {
    this.enFill.style.width = `${Math.max(0, (en / mx) * 100)}%`;
    this.enText.textContent = `${Math.max(0, en)|0} / ${mx|0}`;
  }
  setOverlogic(val, active) {
    this.olFill.style.width = `${Math.max(0, Math.min(100, val))}%`;
    this.olText.textContent = active ? '🔥 MELTDOWN! 🔥' : `${val|0}°C`;
    this.olFill.classList.toggle('meltdown-pulse', active);

    const activeBool = !!active;
    if (activeBool && !this._lastMeltdownState) {
      this.logConsole(`CRITICAL WARNING: CPU meltdown initiated! Cooldowns boosted but heat damage active!`, 'danger');
      AudioManager.play('boss_laser');
    } else if (!activeBool && this._lastMeltdownState) {
      this.logConsole(`System Recovery: Core stabilized. Cooldown complete.`, 'success');
    }
    this._lastMeltdownState = activeBool;
  }
  setShield(on)    { /* visual handled in renderer */ }
  setOverdrive(on) { /* visual handled in renderer */ }

  setCurrentLogic(label, rule, overlogicActive) {
    const txt = overlogicActive && rule ? `Overlogic Active: ${label}` : `Current Logic: ${label}`;
    this.curLogic.textContent = txt;
    this.curLogic.classList.toggle('overlogic', !!overlogicActive && !!rule);

    // Highlight executing rule in directives list
    const items = document.querySelectorAll('.combat-rule-item');
    for (const li of items) {
      li.classList.remove('executing', 'overlogic');
    }
    if (rule) {
      const activeLi = document.getElementById(`combat-rule-${rule.id}`);
      if (activeLi) {
        activeLi.classList.add('executing');
        if (overlogicActive) {
          activeLi.classList.add('overlogic');
        }
      }

      if (this._lastRuleId !== rule.id) {
        this._lastRuleId = rule.id;
        const prefix = overlogicActive ? 'OVERDRIVE: ' : 'Executed: ';
        this.logConsole(`${prefix}${label}`, overlogicActive ? 'warn' : 'info');

        // flash effect on rule switch (DESIGN.md §13.3: 0.2s highlight)
        this.curLogic.classList.remove('flash');
        // force reflow so the class re-applies cleanly on rapid switches
        void this.curLogic.offsetWidth;
        this.curLogic.classList.add('flash');
      }
    } else {
      if (this._lastRuleId !== null) {
        this._lastRuleId = null;
        this.logConsole('Standby: default movement', 'info');
      }
    }
  }

  renderRulesPanel() {
    const rulesList = document.getElementById('combat-rules-list');
    if (!rulesList) return;
    rulesList.innerHTML = '';
    const sortedRules = [...GameState.rules].sort((a, b) => b.priority - a.priority);
    for (const r of sortedRules) {
      if (r.enabled === false) continue;
      const li = document.createElement('li');
      li.id = `combat-rule-${r.id}`;
      li.className = 'combat-rule-item';
      
      const cond1Str = formatCond(r.conditionId, r.conditionValue, GameDatabase);
      let condStr = cond1Str;
      if (r.operator && r.conditionId2) {
        const cond2Str = formatCond(r.conditionId2, r.conditionValue2, GameDatabase);
        const opStr = r.operator.toUpperCase();
        condStr = `${cond1Str} ${opStr} ${cond2Str}`;
      }
      const a = GameDatabase.getAction(r.actionId);
      const aName = a ? a.displayName : r.actionId;
      const targetStr = r.targetPriority && r.targetPriority !== 'nearest' ? ` (${r.targetPriority})` : '';

      li.innerHTML = `IF <span class="c-cond">${escapeHtml(condStr)}</span> THEN <span class="c-act">${escapeHtml(aName + targetStr)}</span> <span class="c-prio">[Prio ${escapeHtml(r.priority|0)}]</span>`;
      rulesList.appendChild(li);
    }
  }

  updateDiagnostics(diagnostics) {
    for (const [ruleId, state] of Object.entries(diagnostics)) {
      const li = document.getElementById(`combat-rule-${ruleId}`);
      if (!li) continue;
      
      li.classList.remove('diag-cooldown', 'diag-energy', 'diag-condition_false', 'diag-overridden', 'diag-executing');
      
      const oldBadge = li.querySelector('.diag-status-badge');
      if (oldBadge) oldBadge.remove();
      
      li.classList.add(`diag-${state}`);
      
      const badge = document.createElement('span');
      badge.className = 'diag-status-badge';
      badge.style.float = 'right';
      badge.style.fontSize = '9px';
      badge.style.padding = '1px 5px';
      badge.style.borderRadius = '3px';
      badge.style.marginLeft = '8px';
      badge.style.fontWeight = 'bold';
      badge.style.textTransform = 'uppercase';
      
      switch (state) {
        case 'executing':
          badge.textContent = 'Active';
          badge.style.background = 'rgba(0, 255, 195, 0.2)';
          badge.style.color = '#00ffc3';
          badge.style.border = '1px solid #00ffc3';
          break;
        case 'cooldown':
          badge.textContent = 'CD';
          badge.style.background = 'rgba(0, 210, 255, 0.15)';
          badge.style.color = '#00d2ff';
          badge.style.border = '1px solid #00d2ff';
          break;
        case 'energy':
          badge.textContent = 'Low EN';
          badge.style.background = 'rgba(255, 230, 0, 0.15)';
          badge.style.color = '#ffe24b';
          badge.style.border = '1px solid #ffe24b';
          break;
        case 'condition_false':
          badge.textContent = 'Skip';
          badge.style.background = 'rgba(255, 255, 255, 0.05)';
          badge.style.color = 'rgba(255, 255, 255, 0.3)';
          badge.style.border = '1px solid rgba(255, 255, 255, 0.15)';
          break;
        case 'overridden':
          badge.textContent = 'Ready';
          badge.style.background = 'rgba(255, 255, 255, 0.1)';
          badge.style.color = 'rgba(255, 255, 255, 0.7)';
          badge.style.border = '1px solid rgba(255, 255, 255, 0.3)';
          break;
      }
      if (state !== 'disabled') {
        li.appendChild(badge);
      }
    }
  }

  setWave(cur, total) { this.waveInfo.textContent = `Wave ${cur}/${total}`; }
  setTimer(t) { this.timerEl.textContent = `${t.toFixed(1)}s`; }

  showBossBar(name) { this.bossName.textContent = name; this.bossWrap.classList.remove('hidden'); }
  hideBossBar() { this.bossWrap.classList.add('hidden'); }
  setBossHp(hp, mx) { this.bossFill.style.width = `${Math.max(0, (hp / mx) * 100)}%`; }

  showPhaseToast(text) { this.phaseToast.textContent = text; this.phaseToast.classList.remove('hidden'); }
  hidePhaseToast() { this.phaseToast.classList.add('hidden'); }
}
