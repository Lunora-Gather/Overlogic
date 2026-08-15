// MainMenu.js — main menu screen controller. Wires buttons, resumes audio on first click.

import { GameManager } from '../core/GameManager.js?v=20260725-4';
import { AudioManager } from '../systems/AudioManager.js?v=20260725-4';
import { GameState } from '../core/GameState.js?v=20260725-4';
import { getLocale, setLocale, t } from '../i18n/I18n.js?v=20260725-4';
import { trapDialogFocus } from './focusTrap.js?v=20260725-4';

export class MainMenu {
  constructor() {
    this.el = document.getElementById('screen-main');
    this.btnStart = document.getElementById('btn-start');
    this.btnNewRun = document.getElementById('btn-new-run');
    this.btnHow = document.getElementById('btn-how');
    this.btnReset = document.getElementById('btn-reset');
    this.btnExit = document.getElementById('btn-exit');
    this.overlay = document.getElementById('how-overlay');
    this.btnHowClose = document.getElementById('btn-how-close');
    this.confirmOverlay = document.getElementById('confirm-overlay');
    this.confirmMessage = document.getElementById('confirm-message');
    this.btnConfirmAccept = document.getElementById('btn-confirm-accept');
    this.btnConfirmCancel = document.getElementById('btn-confirm-cancel');
    this.runMode = document.getElementById('run-mode');
    this.runDifficulty = document.getElementById('run-difficulty');
    this.dailySeedLabel = document.getElementById('daily-seed-label');
    this.runConfigHint = document.getElementById('run-config-hint');
    this.howBody = document.getElementById('how-body');
    this._howReturnFocus = null;
    this._confirmReturnFocus = null;
    this._confirmKey = null;
    this._confirmResolver = null;
    trapDialogFocus(this.overlay);
    trapDialogFocus(this.confirmOverlay);
    this._bind();
    this.render();
  }

  _bind() {
    this.btnStart.addEventListener('click', () => {
      AudioManager.resume();
      AudioManager.play('button_click');
      if (GameState.isDemoCleared()) GameState.resetRun();
      GameState.configureRun(this.runMode.value, this.runDifficulty.value);
      GameManager.goLogicEdit();
    });
    this.btnNewRun?.addEventListener('click', () => {
      AudioManager.resume();
      AudioManager.play('button_click');
      this._requestConfirm('menu.newRunConfirm').then((confirmed) => {
        if (!confirmed) return;
        GameState.resetRun();
        GameState.configureRun(this.runMode.value, this.runDifficulty.value);
        this.render();
        GameManager.goLogicEdit();
      });
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
    this.btnConfirmAccept?.addEventListener('click', () => this._closeConfirm(true));
    this.btnConfirmCancel?.addEventListener('click', () => this._closeConfirm(false));
    this.confirmOverlay?.addEventListener('click', (event) => {
      if (event.target === this.confirmOverlay) this._closeConfirm(false);
    });
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && !this.overlay.classList.contains('hidden')) {
        event.preventDefault();
        this._closeHow();
      }
      if (event.key === 'Escape' && this.confirmOverlay && !this.confirmOverlay.classList.contains('hidden')) {
        event.preventDefault();
        this._closeConfirm(false);
      }
    });
    this.btnReset.addEventListener('click', () => {
      AudioManager.resume();
      AudioManager.play('button_click');
      this._requestConfirm('reset.confirm').then((confirmed) => {
        if (!confirmed) return;
        GameState.clearStorage();
        this.btnReset.textContent = t('reset.done');
        setTimeout(() => { this.btnReset.textContent = t('menu.reset'); }, 1500);
      });
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
    window.addEventListener('overlogic:localechange', () => {
      if (this._confirmKey && this.confirmMessage) this.confirmMessage.textContent = t(this._confirmKey);
      this.render();
    });
  }

  render() {
    const activeRun = GameState.hasRunProgress() && !GameState.isDemoCleared();
    if (this.runMode) this.runMode.value = activeRun ? GameState.runConfig.mode : GameState.settings.runMode;
    if (this.runDifficulty) this.runDifficulty.value = activeRun ? GameState.runConfig.difficulty : GameState.settings.difficulty;
    for (const button of document.querySelectorAll('#locale-switcher [data-locale]')) {
      button.classList.toggle('active', button.dataset.locale === getLocale());
      button.setAttribute('aria-pressed', button.dataset.locale === getLocale() ? 'true' : 'false');
    }
    const complete = GameState.isDemoCleared();
    const active = activeRun;
    this.btnStart.textContent = complete ? t('menu.replay') : (active ? t('menu.continue') : t('menu.start'));
    this.btnNewRun?.classList.toggle('hidden', !active);
    if (this.runMode) this.runMode.disabled = active;
    if (this.runDifficulty) this.runDifficulty.disabled = active;
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

  _requestConfirm(key) {
    if (!this.confirmOverlay || !this.btnConfirmAccept || !this.btnConfirmCancel) {
      return Promise.resolve(false);
    }
    if (this._confirmResolver) this._closeConfirm(false);
    this._confirmKey = key;
    this._confirmReturnFocus = document.activeElement;
    this.confirmMessage.textContent = t(key);
    this.confirmOverlay.classList.remove('hidden');
    this.confirmOverlay.setAttribute('aria-hidden', 'false');
    this.btnConfirmAccept.focus();
    return new Promise((resolve) => { this._confirmResolver = resolve; });
  }

  _closeConfirm(result) {
    if (!this.confirmOverlay || !this._confirmResolver) return;
    const resolve = this._confirmResolver;
    this._confirmResolver = null;
    this._confirmKey = null;
    this.confirmOverlay.classList.add('hidden');
    this.confirmOverlay.setAttribute('aria-hidden', 'true');
    if (this._confirmReturnFocus instanceof HTMLElement) this._confirmReturnFocus.focus();
    this._confirmReturnFocus = null;
    resolve(result === true);
  }

  renderRunConfig() {
    if (!this.dailySeedLabel || !this.runMode) return;
    const daily = this.runMode.value === 'daily';
    this.dailySeedLabel.classList.toggle('hidden', !daily);
    this.dailySeedLabel.textContent = daily
      ? t('menu.dailySeed', { seed: GameState.dailySeed() })
      : '';
    if (this.runConfigHint && this.runDifficulty) {
      if (GameState.hasRunProgress() && !GameState.isDemoCleared()) {
        this.runConfigHint.textContent = t('menu.activeRun', {
          mode: t(`mode.${GameState.runConfig.mode}`),
          difficulty: t(`difficulty.${GameState.runConfig.difficulty}`),
          progress: Math.min(GameState.currentMapColumn + 1, GameState.mapNodes.length),
          total: GameState.mapNodes.length,
        });
        return;
      }
      const difficulty = this.runDifficulty.value;
      this.runConfigHint.textContent = [
        t(`menu.config.${difficulty}`),
        daily ? t('menu.config.daily') : t('menu.config.modeStandard'),
      ].join(' · ');
    }
  }
}
