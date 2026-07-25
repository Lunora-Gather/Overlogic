// MainMenu.js — main menu screen controller. Wires buttons, resumes audio on first click.

import { GameManager } from '../core/GameManager.js';
import { AudioManager } from '../systems/AudioManager.js';
import { GameState } from '../core/GameState.js';
import { getLocale, setLocale, t } from '../i18n/I18n.js';

export class MainMenu {
  constructor() {
    this.el = document.getElementById('screen-main');
    this.btnStart = document.getElementById('btn-start');
    this.btnHow = document.getElementById('btn-how');
    this.btnReset = document.getElementById('btn-reset');
    this.btnExit = document.getElementById('btn-exit');
    this.overlay = document.getElementById('how-overlay');
    this.btnHowClose = document.getElementById('btn-how-close');
    this.runMode = document.getElementById('run-mode');
    this.runDifficulty = document.getElementById('run-difficulty');
    this.dailySeedLabel = document.getElementById('daily-seed-label');
    this.runConfigHint = document.getElementById('run-config-hint');
    this.howBody = document.getElementById('how-body');
    this._howReturnFocus = null;
    this._bind();
    this.render();
  }

  _bind() {
    this.btnStart.addEventListener('click', () => {
      AudioManager.resume();
      AudioManager.play('button_click');
      GameState.configureRun(this.runMode.value, this.runDifficulty.value);
      GameManager.goLogicEdit();
    });
    this.btnHow.addEventListener('click', () => {
      AudioManager.resume();
      AudioManager.play('button_click');
      this._howReturnFocus = document.activeElement;
      this.overlay.classList.remove('hidden');
      this.overlay.setAttribute('aria-hidden', 'false');
      this.btnHowClose.focus();
    });
    this.btnHowClose.addEventListener('click', () => {
      this._closeHow();
    });
    this.overlay.addEventListener('click', (event) => {
      if (event.target === this.overlay) this._closeHow();
    });
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && !this.overlay.classList.contains('hidden')) {
        event.preventDefault();
        this._closeHow();
      }
    });
    this.btnReset.addEventListener('click', () => {
      AudioManager.resume();
      AudioManager.play('button_click');
      if (confirm(t('reset.confirm'))) {
        GameState.clearStorage();
        this.btnReset.textContent = t('reset.done');
        setTimeout(() => { this.btnReset.textContent = t('menu.reset'); }, 1500);
      }
    });
    this.btnExit.addEventListener('click', () => {
      AudioManager.play('button_click');
      try { window.close(); } catch (e) {}
      this.btnExit.textContent = t('menu.closeTab');
    });
    document.getElementById('locale-switcher')?.addEventListener('click', (event) => {
      const button = event.target.closest('[data-locale]');
      if (!button) return;
      GameState.settings.language = button.dataset.locale;
      GameState.saveSettings();
      setLocale(button.dataset.locale);
    });
    this.runMode?.addEventListener('change', () => this.renderRunConfig());
    this.runDifficulty?.addEventListener('change', () => this.renderRunConfig());
    window.addEventListener('overlogic:localechange', () => this.render());
  }

  render() {
    if (this.runMode) this.runMode.value = GameState.settings.runMode;
    if (this.runDifficulty) this.runDifficulty.value = GameState.settings.difficulty;
    for (const button of document.querySelectorAll('#locale-switcher [data-locale]')) {
      button.classList.toggle('active', button.dataset.locale === getLocale());
      button.setAttribute('aria-pressed', button.dataset.locale === getLocale() ? 'true' : 'false');
    }
    if (this.howBody) {
      this.howBody.replaceChildren(...t('how.body').split('|').map(line => {
        const paragraph = document.createElement('p');
        paragraph.textContent = line;
        return paragraph;
      }));
    }
    this.renderRunConfig();
  }

  _closeHow() {
    AudioManager.play('button_click');
    this.overlay.classList.add('hidden');
    this.overlay.setAttribute('aria-hidden', 'true');
    if (this._howReturnFocus instanceof HTMLElement) this._howReturnFocus.focus();
    this._howReturnFocus = null;
  }

  renderRunConfig() {
    if (!this.dailySeedLabel || !this.runMode) return;
    const daily = this.runMode.value === 'daily';
    this.dailySeedLabel.classList.toggle('hidden', !daily);
    this.dailySeedLabel.textContent = daily
      ? t('menu.dailySeed', { seed: GameState.dailySeed() })
      : '';
    if (this.runConfigHint && this.runDifficulty) {
      const difficulty = this.runDifficulty.value;
      this.runConfigHint.textContent = [
        t(`menu.config.${difficulty}`),
        daily ? t('menu.config.daily') : t('menu.config.standard'),
      ].join(' · ');
    }
  }
}
