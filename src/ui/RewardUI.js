import { GameState } from '../core/GameState.js?v=20260725-4';
import { GameDatabase } from '../core/GameDatabase.js?v=20260725-4';
import { GameManager } from '../core/GameManager.js?v=20260725-4';
import { buildRewardOptions, buildUpgradeOptions, rewardDescription, rewardDisplayName } from '../systems/RewardManager.js?v=20260725-4';
import { AudioManager } from '../systems/AudioManager.js?v=20260725-4';
import { escapeHtml } from './safeHtml.js?v=20260725-4';
import { entity, getLocale, t } from '../i18n/I18n.js?v=20260725-4';

const STAT_UNITS = {
  max_hp: 'hp',
  max_energy: 'energy',
  move_speed: 'speed',
  energy_regen: 'energyRate',
  basic_dmg: 'damage',
  dash_cd: 'seconds',
  shield_cd: 'seconds',
  shield_dur: 'seconds',
  overdrive_dur: 'seconds',
  interrupt_cd: 'seconds',
  reflective_plating: 'percent',
  nanite_repair: 'repairRate',
  armor_piercing: 'armor',
};

export class RewardUI {
  constructor() {
    this.el = document.getElementById('screen-reward');
    this.optionsEl = document.getElementById('reward-options');
    this.title = document.getElementById('reward-title');
    this.source = document.getElementById('reward-source');
    this.facts = document.getElementById('reward-facts');
    this.instructions = document.getElementById('reward-instructions');
    this._currentOptions = [];
    this.el.addEventListener('keydown', (event) => {
      if (event.altKey || event.ctrlKey || event.metaKey) return;
      if (!/^[1-3]$/.test(event.key)) return;
      const card = this.optionsEl.querySelectorAll('.reward-card')[Number(event.key) - 1];
      if (!card) return;
      event.preventDefault();
      if (!event.repeat) card.click();
    });
    window.addEventListener('overlogic:localechange', () => {
      if (this.el.classList.contains('hidden')) return;
      const focusedOption = [...this.optionsEl.children].indexOf(document.activeElement);
      this._render();
      if (focusedOption >= 0) this.optionsEl.children[focusedOption]?.focus({ preventScroll: true });
    });
  }

  show() {
    if (GameState.hasPendingUpgradeReward()) {
      this._currentOptions = buildUpgradeOptions();
    } else {
      const justWonBattle = GameState.getActiveBattle();
      this._currentOptions = buildRewardOptions(justWonBattle);
    }
    this._render();
    this.el.scrollTop = 0;
    this.title.focus({ preventScroll: true });
  }

  _render() {
    this.optionsEl.replaceChildren();
    this.instructions.hidden = this._currentOptions.length === 0;

    const vault = GameState.hasPendingUpgradeReward();
    const battle = GameState.getActiveBattle();
    const report = GameState.lastReport;
    this.source.textContent = vault ? t('map.upgradeName') : t('reward.wonAt', {
      battle: entity('battle', battle?.id, battle?.displayName),
    });
    this.title.textContent = t(this._currentOptions.length ? 'reward.title' : 'reward.empty');
    const maxHp = GameState.stats.max_hp;
    const hp = (vault ? GameState.persistentHp : report?._endHp) ?? maxHp;
    const facts = [[t(vault ? 'combat.hitPoints' : 'reward.endingHp'), `${Math.round(hp)} / ${Math.round(maxHp)}`]];
    if (!vault && Number.isFinite(report?.battle_time) && report.battle_time > 0) {
      facts.push([t('victory.time'), t('reward.unit.seconds', { value: report.battle_time.toFixed(1) })]);
    }
    this.facts.innerHTML = facts.map(([label, value]) =>
      `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`).join('');

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
      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'reward-card';
      card.dataset.rewardType = r.rewardType;
      card.setAttribute('aria-keyshortcuts', String(index + 1));
      const typeLabel = t(`rewardType.${r.rewardType}`);
      const impact = this._impactPreview(r);
      const nameId = `reward-option-${index + 1}-name`;
      const detailId = `${nameId}-detail`;
      card.setAttribute('aria-labelledby', nameId);
      card.setAttribute('aria-describedby', detailId);
      card.innerHTML =
        `<span class="r-type"><span>${escapeHtml(typeLabel)}</span><kbd aria-hidden="true">${index + 1}</kbd></span>` +
        `<span id="${nameId}" class="r-name">${escapeHtml(rewardDisplayName(r))}</span>` +
        (impact
          ? `<span id="${detailId}" class="r-impact">` +
            `<span class="sr-only">${escapeHtml(t('reward.projected', impact))}</span>` +
            `<span aria-hidden="true" class="r-before">${escapeHtml(impact.before)}</span>` +
            `<span aria-hidden="true" class="r-arrow">→</span><strong aria-hidden="true">${escapeHtml(impact.after)}</strong></span>`
          : `<span id="${detailId}" class="r-desc">${escapeHtml(rewardDescription(r))}</span>`);
      const choose = () => {
        AudioManager.play('rule_add');
        GameManager.onRewardChosen(rid);
      };
      card.addEventListener('click', choose);
      card.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') return;
        if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(e.key)) return;
        e.preventDefault();
        const cards = [...this.optionsEl.querySelectorAll('.reward-card')];
        const current = cards.indexOf(card);
        const next = e.key === 'Home' ? 0
          : e.key === 'End' ? cards.length - 1
            : (current + (['ArrowRight', 'ArrowDown'].includes(e.key) ? 1 : -1) + cards.length) % cards.length;
        cards[next]?.focus();
      });
      this.optionsEl.appendChild(card);
    }
  }

  _impactPreview(reward) {
    if (reward.rewardType !== 'passive') return null;
    const key = reward.targetId;
    const unit = STAT_UNITS[key];
    if (!unit || !Number.isFinite(GameState.stats[key])) return null;
    const number = new Intl.NumberFormat(getLocale(), { maximumFractionDigits: 2 });
    const format = (value) => t(`reward.unit.${unit}`, { value: number.format(unit === 'percent' ? value * 100 : value) });
    return {
      before: format(GameState.stats[key]),
      after: format(GameState.passiveUpgradeValue(key, reward.value)),
    };
  }
}
