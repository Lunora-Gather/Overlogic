// RewardUI.js — reward selection screen. Shows 3 cards, applies on click.
// Enhanced with current passives display and richer card descriptions.
// Mirrors scripts/ui/RewardUI.gd.

import { GameState } from '../core/GameState.js';
import { GameDatabase } from '../core/GameDatabase.js';
import { GameManager } from '../core/GameManager.js';
import { buildRewardOptions, buildUpgradeOptions, rewardDescription, rewardDisplayName } from '../systems/RewardManager.js';
import { AudioManager } from '../systems/AudioManager.js';
import { escapeHtml } from './safeHtml.js';
import { t } from '../i18n/I18n.js';

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
      btn.className = 'btn primary big'; btn.textContent = t('common.continue');
      btn.addEventListener('click', () => GameManager.onRewardChosen(''));
      this.optionsEl.appendChild(btn);
      return;
    }

    for (const rid of this._currentOptions) {
      const r = GameDatabase.getReward(rid);
      if (!r) continue;
      const card = document.createElement('div');
      card.className = 'reward-card';
      card.tabIndex = 0;
      card.role = 'button';
      card.setAttribute('aria-label', rewardDisplayName(r));
      const icon = TYPE_ICONS[r.rewardType] || '✦';
      const typeLabel = t(`rewardType.${r.rewardType}`);
      card.innerHTML =
        `<span class="r-type">${icon} ${escapeHtml(typeLabel)}</span>` +
        `<span class="r-name">${escapeHtml(rewardDisplayName(r))}</span>` +
        `<span class="r-desc">${escapeHtml(rewardDescription(r))}</span>` +
        `<span class="r-pick-hint">${escapeHtml(t('reward.select'))}</span>`;
      const choose = () => {
        AudioManager.play('rule_add');
        GameManager.onRewardChosen(rid);
      };
      card.addEventListener('click', choose);
      card.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        e.preventDefault();
        choose();
      });
      this.optionsEl.appendChild(card);
    }
  }
}
