// MainMenu.js — main menu screen controller. Wires buttons, resumes audio on first click.

import { GameManager } from '../core/GameManager.js?v=20260725-4';
import { AudioManager } from '../systems/AudioManager.js?v=20260725-4';
import { GameState } from '../core/GameState.js?v=20260725-4';
import { getLocale, setLocale, t } from '../i18n/I18n.js?v=20260725-4';
import { trapDialogFocus } from './focusTrap.js?v=20260725-4';
import { recentBattles, historySummary } from '../systems/RunHistory.js?v=20260725-4';
import { profileSnapshot, profileRank, ACHIEVEMENTS } from '../systems/ProfileProgression.js?v=20260725-4';
import { escapeHtml } from './safeHtml.js?v=20260725-4';
import { challengeSnapshot } from '../systems/LiveChallenges.js?v=20260725-4';
import { leaderboardRuns, runRecords } from '../systems/RunArchive.js?v=20260725-4';
import { dailyProtocol, weeklyProtocol } from '../systems/RunModifiers.js?v=20260725-4';
import { featureEnabled, operationsConfig } from '../systems/OperationsConfig.js?v=20260725-4';
import { recordProductEvent } from '../systems/ProductTelemetry.js?v=20260725-4';
import { copyText } from './Clipboard.js?v=20260725-4';

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
    this.periodSeedLabel = document.getElementById('period-seed-label');
    this.runSeedInput = document.getElementById('run-seed-input');
    this.btnCopyRunSeed = document.getElementById('btn-copy-run-seed');
    this.runConfigHint = document.getElementById('run-config-hint');
    this.runSeason = document.getElementById('run-season');
    this.runSeasonName = document.getElementById('run-season-name');
    this.runSeasonStatus = document.getElementById('run-season-status');
    this.runHistory = document.getElementById('run-history');
    this.runChallenges = document.getElementById('run-challenges');
    this.runProfile = document.getElementById('run-profile');
    this.profileOverlay = document.getElementById('profile-overlay');
    this.profileDialogBody = document.getElementById('profile-dialog-body');
    this.btnProfileClose = document.getElementById('btn-profile-close');
    this.howBody = document.getElementById('how-body');
    this._challengeRefreshTimer = null;
    this._howReturnFocus = null;
    this._confirmReturnFocus = null;
    this._confirmKey = null;
    this._confirmResolver = null;
    this._profileReturnFocus = null;
    this.profileLeaderboardMode = null;
    this.profileLeaderboardDifficulty = null;
    const standalone = window.matchMedia?.('(display-mode: standalone)').matches === true ||
      window.navigator?.standalone === true;
    this.btnExit?.classList.toggle('hidden', !standalone);
    trapDialogFocus(this.overlay);
    trapDialogFocus(this.confirmOverlay);
    trapDialogFocus(this.profileOverlay);
    this._bind();
    this.render();
  }

  _applyOperationsGates(activeRun = GameState.hasRunProgress() && !GameState.isDemoCleared()) {
    if (!this.runMode) return;
    this.runChallenges?.classList.toggle('hidden', !featureEnabled('dailyChallenges'));
    const modeOptions = [
      ['daily', 'dailyChallenges'],
      ['weekly', 'weeklyGauntlet'],
    ];
    for (const [mode, feature] of modeOptions) {
      const option = this.runMode.querySelector(`option[value="${mode}"]`);
      if (!option) continue;
      const enabled = featureEnabled(feature);
      // Never strand an in-progress run when a live flag is changed. Existing
      // runs remain resumable; only new runs lose the unavailable option.
      option.hidden = !enabled && !(activeRun && this.runMode.value === mode);
      option.disabled = !enabled && !(activeRun && this.runMode.value === mode);
    }
    if (!activeRun && !featureEnabled('dailyChallenges') && this.runMode.value === 'daily') {
      this.runMode.value = 'standard';
    }
    if (!activeRun && !featureEnabled('weeklyGauntlet') && this.runMode.value === 'weekly') {
      this.runMode.value = 'standard';
    }
  }

  _bind() {
    this.btnStart.addEventListener('click', () => {
      AudioManager.resume();
      AudioManager.play('button_click');
      if (GameState.hasPendingBattleResolution()) {
        GameManager.resumePendingBattle();
        return;
      }
      if (GameState.isDemoCleared()) GameState.resetRun();
      GameState.configureRun(this.runMode.value, this.runDifficulty.value, this._requestedSeed());
      recordProductEvent('run_started', {
        mode: GameState.runConfig.mode,
        difficulty: GameState.runConfig.difficulty,
      });
      GameManager.goLogicEdit();
    });
    this.btnNewRun?.addEventListener('click', () => {
      AudioManager.resume();
      AudioManager.play('button_click');
      this._requestConfirm('menu.newRunConfirm').then((confirmed) => {
        if (!confirmed) return;
        GameState.resetRun();
        GameState.configureRun(this.runMode.value, this.runDifficulty.value, this._requestedSeed());
        recordProductEvent('run_started', {
          mode: GameState.runConfig.mode,
          difficulty: GameState.runConfig.difficulty,
        });
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
    this.runProfile?.addEventListener('click', (event) => {
      if (event.target.closest('#btn-profile-open')) this._openProfile();
    });
    this.btnProfileClose?.addEventListener('click', () => this._closeProfile());
    this.profileOverlay?.addEventListener('click', (event) => {
      if (event.target === this.profileOverlay) this._closeProfile();
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
      if (event.key === 'Escape' && this.profileOverlay && !this.profileOverlay.classList.contains('hidden')) {
        event.preventDefault();
        this._closeProfile();
      }
    });
    this.btnReset.addEventListener('click', () => {
      AudioManager.resume();
      AudioManager.play('button_click');
      this._requestConfirm('reset.confirm').then((confirmed) => {
        if (!confirmed) return;
        const cleared = GameState.clearStorage();
        this.render();
        this.btnReset.textContent = t(cleared ? 'reset.done' : 'reset.failed');
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
    const updateRunConfig = () => {
      const challenge = GameState.parseRunCode(this.runSeedInput?.value);
      if (challenge) {
        this.runMode.value = challenge.mode;
        this.runDifficulty.value = challenge.difficulty;
      }
      if (GameState.canConfigureRun()) {
        const requestedSeed = challenge?.seed || (['standard'].includes(this.runMode.value) ? this._requestedSeed() : null);
        GameState.configureRun(this.runMode.value, this.runDifficulty.value, requestedSeed);
      }
      this.renderRunConfig();
    };
    this.runMode?.addEventListener('change', updateRunConfig);
    this.runDifficulty?.addEventListener('change', updateRunConfig);
    this.runSeedInput?.addEventListener('change', updateRunConfig);
    this.runSeedInput?.addEventListener('input', updateRunConfig);
    this.btnCopyRunSeed?.addEventListener('click', async () => {
      const code = GameState.exportRunCode();
      const copied = await copyText(code);
      if (copied) {
        this.btnCopyRunSeed.textContent = t('menu.copiedSeed');
        setTimeout(() => { this.btnCopyRunSeed.textContent = t('menu.copySeed'); }, 1400);
      } else {
        this.runSeedInput?.select();
        this.btnCopyRunSeed.textContent = t('menu.copySeedManual');
      }
    });
    window.addEventListener('overlogic:localechange', () => {
      if (this._confirmKey && this.confirmMessage) this.confirmMessage.textContent = t(this._confirmKey);
      this.render();
    });
  }

  render() {
    const activeRun = GameState.hasRunProgress() && !GameState.isDemoCleared();
    if (this.runMode) this.runMode.value = activeRun ? GameState.runConfig.mode : GameState.settings.runMode;
    this._applyOperationsGates(activeRun);
    if (this.runDifficulty) this.runDifficulty.value = activeRun ? GameState.runConfig.difficulty : GameState.settings.difficulty;
    for (const button of document.querySelectorAll('#locale-switcher [data-locale]')) {
      button.classList.toggle('active', button.dataset.locale === getLocale());
      button.setAttribute('aria-pressed', button.dataset.locale === getLocale() ? 'true' : 'false');
    }
    const complete = GameState.isDemoCleared();
    const active = activeRun;
    const pending = GameState.hasPendingBattleResolution();
    this.btnStart.textContent = complete
      ? t('menu.replay')
      : (pending ? t('menu.resumeReward') : (active ? t('menu.continue') : t('menu.start')));
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
    this.renderSeason();
    this.renderProfile();
    if (this.profileOverlay && !this.profileOverlay.classList.contains('hidden')) this.renderProfileDialog();
    this.renderChallenges();
    this.renderHistory();
  }

  renderSeason() {
    if (!this.runSeason || !this.runSeasonName || !this.runSeasonStatus) return;
    const operations = operationsConfig();
    const seasonKey = operations.season?.labelKey;
    this.runSeasonName.textContent = seasonKey ? t(seasonKey) : t('ops.seasonFoundry');
    this.runSeasonStatus.textContent = operations.maintenance?.enabled
      ? t('menu.seasonMaintenance')
      : t('menu.seasonActive');
    this.runSeason.classList.toggle('maintenance', operations.maintenance?.enabled === true);
  }

  renderProfile() {
    if (!this.runProfile) return;
    const profile = profileSnapshot();
    const rank = profileRank(profile.xp);
    const unlocked = ACHIEVEMENTS.filter((achievement) => profile.achievements[achievement.id]).length;
    const records = runRecords();
    const progress = Math.max(0, Math.min(100, Math.round((rank.current / rank.required) * 100)));
    const bestRun = records.bestTime === null
      ? t('menu.profileNoBestRun')
      : t('menu.profileBestRun', { time: `${records.bestTime.toFixed(1)}s` });
    this.runProfile.innerHTML = `
      <div class="profile-heading"><span>${t('menu.profileTitle')}</span><span>${t('menu.profileRank', { level: rank.level })}</span></div>
      <div class="profile-progress" aria-label="${t('menu.profileXp', { current: rank.current, required: rank.required })}">
        <span style="width:${progress}%"></span>
      </div>
      <div class="profile-meta"><span>${t('menu.profileBattles', { count: profile.totalBattles })}</span><span>${t('menu.profileWins', { count: profile.wins })}</span><span>${t('menu.profileAchievements', { unlocked, total: ACHIEVEMENTS.length })}</span></div>
      <div class="profile-records"><span>${t('menu.profileClears', { count: records.completions })}</span><span>${bestRun}</span></div>
      <div class="profile-actions"><button type="button" id="btn-profile-open" class="btn ghost small">${t('menu.profileOpen')}</button></div>`;
  }

  renderProfileDialog() {
    if (!this.profileDialogBody) return;
    const profile = profileSnapshot();
    const rank = profileRank(profile.xp);
    const records = runRecords();
    const progress = Math.max(0, Math.min(100, Math.round((rank.current / rank.required) * 100)));
    const winRate = profile.totalBattles > 0 ? Math.round((profile.wins / profile.totalBattles) * 100) : 0;
    const unlockedCount = ACHIEVEMENTS.filter((achievement) => profile.achievements[achievement.id]).length;
    const bestBattle = profile.bestBattleTime === null
      ? t('menu.profileNoTime') : `${profile.bestBattleTime.toFixed(1)}s`;
    const achievements = ACHIEVEMENTS.map((achievement) => {
      const unlockedAt = profile.achievements[achievement.id];
      let date = '';
      if (unlockedAt) {
        const parsed = new Date(unlockedAt);
        if (Number.isFinite(parsed.getTime())) {
          date = new Intl.DateTimeFormat(getLocale(), { year: 'numeric', month: 'short', day: 'numeric' }).format(parsed);
        }
      }
      return `<article class="achievement-card ${unlockedAt ? 'unlocked' : 'locked'}">
        <span class="achievement-mark" aria-hidden="true">${unlockedAt ? '✓' : '◇'}</span>
        <div class="achievement-copy">
          <strong>${escapeHtml(t(achievement.titleKey))}</strong>
          <p>${escapeHtml(t(achievement.descriptionKey))}</p>
          <small>${escapeHtml(unlockedAt ? t('menu.profileUnlockedOn', { date }) : t('menu.profileLocked'))}</small>
        </div>
        <span class="achievement-xp">+${achievement.xp} XP</span>
      </article>`;
    }).join('');
    const modes = ['standard', 'daily', 'weekly'];
    const difficulties = ['casual', 'standard', 'veteran'];
    const selectedMode = modes.includes(this.profileLeaderboardMode)
      ? this.profileLeaderboardMode
      : (modes.includes(GameState.runConfig?.mode) ? GameState.runConfig.mode : 'standard');
    const selectedDifficulty = difficulties.includes(this.profileLeaderboardDifficulty)
      ? this.profileLeaderboardDifficulty
      : (difficulties.includes(GameState.runConfig?.difficulty) ? GameState.runConfig.difficulty : 'standard');
    const leaderboard = leaderboardRuns({ mode: selectedMode, difficulty: selectedDifficulty, limit: 5 });
    const modeOptions = modes.map((mode) => `<option value="${mode}"${mode === selectedMode ? ' selected' : ''}>${escapeHtml(t(`mode.${mode}`))}</option>`).join('');
    const difficultyOptions = difficulties.map((difficulty) => `<option value="${difficulty}"${difficulty === selectedDifficulty ? ' selected' : ''}>${escapeHtml(t(`difficulty.${difficulty}`))}</option>`).join('');
    const leaderboardRows = leaderboard.map((entry, index) => `<li class="leaderboard-row">
      <span class="leaderboard-rank">#${index + 1}</span>
      <span class="leaderboard-route"><strong>${escapeHtml(t(`mode.${entry.mode}`))}</strong><small>${escapeHtml(t(`difficulty.${entry.difficulty}`))}</small></span>
      <span class="leaderboard-time">${entry.totalBattleTime.toFixed(1)}s</span>
      <span class="leaderboard-damage">${escapeHtml(t('menu.profileDamageValue', { value: Math.round(entry.totalDamageDealt) }))}</span>
      <code>${escapeHtml(entry.receipt)}</code>
    </li>`).join('');
    this.profileDialogBody.innerHTML = `
      <section class="dossier-rank" aria-label="${escapeHtml(t('menu.profileXp', { current: rank.current, required: rank.required }))}">
        <div><span>${escapeHtml(t('menu.profileRank', { level: rank.level }))}</span><strong>${escapeHtml(t('menu.profileXp', { current: rank.current, required: rank.required }))}</strong></div>
        <div class="profile-progress"><span style="width:${progress}%"></span></div>
      </section>
      <section class="dossier-stats" aria-label="${escapeHtml(t('menu.profileStatsTitle'))}">
        <div><span>${escapeHtml(t('menu.profileBattlesLabel'))}</span><strong>${profile.totalBattles}</strong></div>
        <div><span>${escapeHtml(t('menu.profileWinRate'))}</span><strong>${winRate}%</strong></div>
        <div><span>${escapeHtml(t('menu.profileDailyWins'))}</span><strong>${profile.dailyWins}</strong></div>
        <div><span>${escapeHtml(t('menu.profileWeeklyWins'))}</span><strong>${profile.weeklyWins}</strong></div>
        <div><span>${escapeHtml(t('menu.profileClearsLabel'))}</span><strong>${records.completions}</strong></div>
        <div><span>${escapeHtml(t('menu.profileBestBattle'))}</span><strong>${escapeHtml(bestBattle)}</strong></div>
      </section>
      <section class="dossier-achievements" aria-labelledby="dossier-achievements-title">
        <div class="dossier-section-heading"><h3 id="dossier-achievements-title">${escapeHtml(t('menu.profileAchievementsTitle'))}</h3><span>${unlockedCount}/${ACHIEVEMENTS.length}</span></div>
        <div class="achievement-grid">${achievements}</div>
      </section>
      <section class="dossier-leaderboard" aria-labelledby="dossier-leaderboard-title">
        <div class="dossier-section-heading"><h3 id="dossier-leaderboard-title">${escapeHtml(t('menu.profileLeaderboardTitle'))}</h3><span>${escapeHtml(t('menu.profileLeaderboardLocal'))}</span></div>
        <div class="leaderboard-filters" aria-label="${escapeHtml(t('menu.profileLeaderboardFilters'))}">
          <label><span>${escapeHtml(t('menu.profileLeaderboardMode'))}</span><select id="profile-leaderboard-mode" aria-label="${escapeHtml(t('menu.profileLeaderboardMode'))}">${modeOptions}</select></label>
          <label><span>${escapeHtml(t('menu.profileLeaderboardDifficulty'))}</span><select id="profile-leaderboard-difficulty" aria-label="${escapeHtml(t('menu.profileLeaderboardDifficulty'))}">${difficultyOptions}</select></label>
        </div>
        ${leaderboardRows ? `<ol class="leaderboard-list">${leaderboardRows}</ol>` : `<p class="leaderboard-empty">${escapeHtml(t('menu.profileLeaderboardEmpty'))}</p>`}
      </section>`;
    const modeFilter = this.profileDialogBody.querySelector('#profile-leaderboard-mode');
    const difficultyFilter = this.profileDialogBody.querySelector('#profile-leaderboard-difficulty');
    modeFilter?.addEventListener('change', () => {
      this.profileLeaderboardMode = modeFilter.value;
      this.renderProfileDialog();
      this.profileDialogBody.querySelector('#profile-leaderboard-mode')?.focus({ preventScroll: true });
    });
    difficultyFilter?.addEventListener('change', () => {
      this.profileLeaderboardDifficulty = difficultyFilter.value;
      this.renderProfileDialog();
      this.profileDialogBody.querySelector('#profile-leaderboard-difficulty')?.focus({ preventScroll: true });
    });
  }

  _openProfile() {
    if (!this.profileOverlay || !this.btnProfileClose) return;
    this._profileReturnFocus = document.activeElement;
    this.renderProfileDialog();
    this.profileOverlay.classList.remove('hidden');
    this.profileOverlay.setAttribute('aria-hidden', 'false');
    // Keep keyboard focus inside the dialog without letting the bottom action
    // scroll a long mobile dossier past its title and career summary.
    this.btnProfileClose.focus({ preventScroll: true });
    const profileCard = this.profileOverlay.querySelector('.profile-card');
    if (profileCard) profileCard.scrollTop = 0;
    AudioManager.play('button_click');
  }

  _closeProfile() {
    if (!this.profileOverlay || this.profileOverlay.classList.contains('hidden')) return;
    this.profileOverlay.classList.add('hidden');
    this.profileOverlay.setAttribute('aria-hidden', 'true');
    if (this._profileReturnFocus instanceof HTMLElement) this._profileReturnFocus.focus();
    this._profileReturnFocus = null;
    AudioManager.play('button_click');
  }

  renderHistory() {
    if (!this.runHistory) return;
    const summary = historySummary();
    const entries = recentBattles();
    if (entries.length === 0) {
      this.runHistory.innerHTML = `<div class="history-empty">${t('menu.historyEmpty')}</div>`;
      return;
    }
    const cards = entries.map((entry) => {
      const battle = entry.battleId.replace(/^battle_/, '#');
      const result = entry.won ? t('menu.historyWin') : t('menu.historyLoss');
      const resultClass = entry.won ? 'win' : 'loss';
      return `<li class="history-entry ${resultClass}">
        <span class="history-result">${escapeHtml(result)}</span>
        <span class="history-battle">${escapeHtml(battle)}</span>
        <span class="history-meta">${escapeHtml(t(`difficulty.${entry.difficulty}`))} · ${escapeHtml(Math.round(entry.battleTime))}s · ${escapeHtml(t('menu.historySeed', { seed: entry.seed }))}</span>
      </li>`;
    }).join('');
    this.runHistory.innerHTML = `
      <div class="history-heading"><span>${t('menu.historyTitle')}</span><span class="history-summary">${t('menu.historySummary', { wins: summary.wins, losses: summary.losses })}</span></div>
      <ul class="history-list">${cards}</ul>`;
    }

  _closeHow() {
    AudioManager.play('button_click');
    this.overlay.classList.add('hidden');
    this.overlay.setAttribute('aria-hidden', 'true');
    if (this._howReturnFocus instanceof HTMLElement) this._howReturnFocus.focus();
    this._howReturnFocus = null;
  }

  renderChallenges() {
    if (!this.runChallenges) return;
    const snapshot = challengeSnapshot();
    const items = Object.values(snapshot.objectives || {}).map((challenge) => {
      const progress = Math.max(0, Math.min(challenge.target, Number(challenge.progress) || 0));
      const percent = Math.round((progress / challenge.target) * 100);
      const status = challenge.completed ? t('menu.challengeDone') : t('menu.challengeProgress', {
        current: Number.isInteger(progress) ? progress : progress.toFixed(0),
        target: challenge.target,
      });
      return `<li class="challenge-entry ${challenge.completed ? 'completed' : ''}">
        <div class="challenge-entry-heading"><span>${escapeHtml(t(challenge.titleKey))}</span><span>${escapeHtml(status)}</span></div>
        <div class="challenge-progress" role="progressbar" aria-valuemin="0" aria-valuemax="${challenge.target}" aria-valuenow="${progress}" aria-label="${escapeHtml(t(challenge.titleKey))}"><span style="width:${percent}%"></span></div>
      </li>`;
    }).join('');
    const challengeMeta = `${t('menu.challengeDate', { date: snapshot.date })} · ${t('menu.challengeStreak', { count: snapshot.streak || 0 })}`;
    this.runChallenges.innerHTML = `
      <div class="challenge-heading"><span>${escapeHtml(t('menu.challengesTitle'))}</span><span>${escapeHtml(challengeMeta)}</span></div>
      <ul class="challenge-list">${items}</ul>`;
    this._scheduleChallengeRefresh();
  }

  _scheduleChallengeRefresh() {
    if (this._challengeRefreshTimer) clearTimeout(this._challengeRefreshTimer);
    if (typeof window === 'undefined') return;
    const now = new Date();
    const nextUtcDay = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
    const delay = Math.max(1000, nextUtcDay - now.getTime() + 1000);
    this._challengeRefreshTimer = window.setTimeout(() => {
      this._challengeRefreshTimer = null;
      this.renderChallenges();
    }, delay);
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
    if (!this.periodSeedLabel || !this.runMode) return;
    const period = this.runMode.value;
    const daily = period === 'daily';
    const weekly = period === 'weekly';
    const configuredSeed = Number(GameState.runConfig?.seed) || null;
    const fixedSeed = configuredSeed || GameState.periodSeed(period);
    const currentDailySeed = GameState.dailySeed();
    this.periodSeedLabel.classList.toggle('hidden', !daily && !weekly);
    this.periodSeedLabel.textContent = daily
      ? (fixedSeed && fixedSeed !== currentDailySeed
        ? t('menu.archivedDailySeed', {
          date: GameState.dailyIdentityFromSeed(fixedSeed)?.key || String(fixedSeed),
          seed: fixedSeed,
        })
        : t('menu.dailySeed', { seed: fixedSeed || currentDailySeed }))
      : weekly
        ? t('menu.weeklySeed', {
          week: GameState.weeklyIdentityFromSeed(fixedSeed)?.key || GameState.weeklyIdentity().key,
          seed: fixedSeed || GameState.weeklySeed(),
        })
        : '';
    if (this.runSeedInput) {
      const active = GameState.hasRunProgress() && !GameState.isDemoCleared();
      this.runSeedInput.disabled = active || daily || weekly;
      if (document.activeElement !== this.runSeedInput || active || daily || weekly) {
        this.runSeedInput.value = daily
          ? String(fixedSeed || GameState.dailySeed())
          : weekly
            ? String(fixedSeed || GameState.weeklySeed())
            : String(GameState.runConfig.seed || '');
      }
    }
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
      const hints = [
        t(`menu.config.${difficulty}`),
        daily ? t('menu.config.daily') : weekly ? t('menu.config.weekly') : t('menu.config.modeStandard'),
      ];
      const protocol = daily
        ? dailyProtocol(fixedSeed || GameState.dailySeed())
        : (weekly ? weeklyProtocol(fixedSeed || GameState.weeklySeed()) : null);
      if (protocol) hints.push(`${t(weekly ? 'menu.weeklyProtocolLabel' : 'menu.dailyProtocolLabel')}: ${t(protocol.titleKey)}`);
      this.runConfigHint.textContent = hints.join(' · ');
    }
  }

  _requestedSeed() {
    const value = this.runSeedInput?.value?.trim() || '';
    const challenge = GameState.parseRunCode(value);
    if (challenge) return challenge.seed;
    return value;
  }
}
