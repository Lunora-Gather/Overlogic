// RewardUI.js — reward selection screen. Shows 3 cards, applies on click.
// Enhanced with current passives display and richer card descriptions.
// Mirrors scripts/ui/RewardUI.gd.

import { GameState } from '../core/GameState.js?v=20260725-4';
import { GameDatabase } from '../core/GameDatabase.js?v=20260725-4';
import { GameManager } from '../core/GameManager.js?v=20260725-4';
import { buildRewardOptions, buildUpgradeOptions, rewardDescription, rewardDisplayName } from '../systems/RewardManager.js?v=20260725-4';
import { AudioManager } from '../systems/AudioManager.js?v=20260725-4';
import { escapeHtml } from './safeHtml.js?v=20260725-4';
import { t } from '../i18n/I18n.js?v=20260725-4';

const TYPE_ICONS = {
  passive: '⚙️',
  new_action: '⚡',
  new_condition: '🔍',
};

export class RewardUI {
  constructor() {
    this.el = document.getElementById('screen-reward');
    this.optionsEl = document.getElementById('reward-options');
    this._currentOptions = [];
    this.el.addEventListener('keydown', (event) => {
      if (event.altKey || event.ctrlKey || event.metaKey) return;
      if (!/^[1-3]$/.test(event.key)) return;
      const card = this.optionsEl.querySelectorAll('.reward-card')[Number(event.key) - 1];
      if (!card) return;
      event.preventDefault();
      card.click();
    });
    window.addEventListener('overlogic:localechange', () => {
      if (!this.el.classList.contains('hidden')) this._render();
    });
  }

  show() {
    if (GameManager.isUpgradeReward) {
      this._currentOptions = buildUpgradeOptions();
    } else {
      const justWonBattle = GameState.getActiveBattle() || GameDatabase.getBattle(GameState.currentBattleIndex);
      this._currentOptions = buildRewardOptions(justWonBattle);
    }
    this._render();
    this.optionsEl.querySelector('.reward-card, button')?.focus();
  }

  _render() {
    this.optionsEl.innerHTML = '';

    // Remove old summary bar if re-rendering
    const oldBar = this.el.querySelector('.reward-summary-bar');
    if (oldBar) oldBar.remove();

    // Current status summary bar (inserted before the options grid)
    const report = GameState.lastReport || {};
    const currentHp = report._endHp ?? GameState.persistentHp ?? GameState.stats.max_hp;
    const hpPct = Math.round(currentHp / GameState.stats.max_hp * 100);
    const actionCount = Object.values(report.action_usage || {}).reduce((sum, count) => sum + count, 0);
    const hasCombatReport = Number.isFinite(report.battle_time) && report.battle_time > 0;
    const summaryBar = document.createElement('div');
    summaryBar.className = 'reward-summary-bar';
    summaryBar.innerHTML = `
      <span class="reward-summary-label">${t(hasCombatReport ? 'reward.lastCombat' : 'reward.currentState')}</span>
      <span class="reward-summary-stat">❤️ HP ${Math.max(0, Math.round(currentHp))}/${Math.round(GameState.stats.max_hp)} (${hpPct}%)</span>
      <span class="reward-summary-stat">⚡ ${GameState.stats.max_energy} EN</span>
      <span class="reward-summary-stat">🗡️ ${Math.round(GameState.stats.basic_dmg * 10) / 10} ATK</span>
      ${hasCombatReport ? `
        <span class="reward-summary-stat">⏱️ ${report.battle_time.toFixed(1)}s</span>
        <span class="reward-summary-stat">🎯 ${t('reward.damage', { value: Math.round(report.total_damage_dealt || 0) })}</span>
        <span class="reward-summary-stat">⚙️ ${t('reward.actions', { value: actionCount })}</span>
      ` : ''}
      <span class="reward-summary-stat" style="color: #a0a0a0; font-size: 10px;">
        ${t('reward.extraModules', { actions: GameState.unlockedActionIds.length, conditions: GameState.unlockedConditionIds.length })}
      </span>
    `;
    this.optionsEl.before(summaryBar);

    if (this._currentOptions.length === 0) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'btn primary big'; btn.textContent = t('common.continue');
      btn.addEventListener('click', () => GameManager.onRewardChosen(''));
      this.optionsEl.appendChild(btn);
      return;
    }

    for (const [index, rid] of this._currentOptions.entries()) {
      const r = GameDatabase.getReward(rid);
      if (!r) continue;
      const card = document.createElement('div');
      card.className = 'reward-card';
      card.tabIndex = 0;
      card.setAttribute('role', 'button');
      card.setAttribute('aria-label', rewardDisplayName(r));
      card.setAttribute('aria-keyshortcuts', String(index + 1));
      const icon = TYPE_ICONS[r.rewardType] || '✦';
      const typeLabel = t(`rewardType.${r.rewardType}`);
      const impact = this._impactPreview(r);
      const descriptionId = `reward-option-${index + 1}-description`;
      const impactId = `reward-option-${index + 1}-impact`;
      card.setAttribute('aria-describedby', impact ? `${descriptionId} ${impactId}` : descriptionId);
      card.innerHTML =
        `<span class="r-type"><span aria-hidden="true">[${index + 1}]</span> ${icon} ${escapeHtml(typeLabel)}</span>` +
        `<span class="r-name">${escapeHtml(rewardDisplayName(r))}</span>` +
        `<span id="${descriptionId}" class="r-desc">${escapeHtml(rewardDescription(r))}</span>` +
        (impact ? `<span id="${impactId}" class="r-impact">${escapeHtml(impact)}</span>` : '') +
        `<span class="r-pick-hint">${escapeHtml(t('reward.select'))}</span>`;
      const choose = () => {
        AudioManager.play('rule_add');
        GameManager.onRewardChosen(rid);
      };
      card.addEventListener('click', choose);
      card.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          choose();
          return;
        }
        if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(e.key)) return;
        e.preventDefault();
        const cards = [...this.optionsEl.querySelectorAll('.reward-card')];
        const current = cards.indexOf(card);
        const next = e.key === 'Home' ? 0
          : e.key === 'End' ? cards.length - 1
            : (current + (['ArrowRight', 'ArrowDown'].includes(e.key) ? 1 : -1) + cards.length) % cards.length;
        cards[next]?.focus({ preventScroll: true });
      });
      this.optionsEl.appendChild(card);
    }
  }

  _impactPreview(reward) {
    if (reward.rewardType !== 'passive') return t('reward.unlocksDirective');
    const key = reward.targetId;
    const before = Number(GameState.stats[key]);
    if (!Number.isFinite(before)) return '';
    const multiplicative = new Set([
      'energy_regen', 'basic_dmg', 'dash_cd', 'shield_cd', 'interrupt_cd',
    ]);
    const after = multiplicative.has(key) ? before * reward.value : before + reward.value;
    const format = (value) => Number.isInteger(value)
      ? String(value)
      : String(Math.round(value * 10) / 10);
    return t('reward.projected', { before: format(before), after: format(after) });
  }
}
