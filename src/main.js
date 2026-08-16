// main.js — entry point. Loads data, wires screens, hosts CombatArena lifecycle.

import { GameDatabase } from './core/GameDatabase.js?v=20260725-4';
import { GameState } from './core/GameState.js?v=20260725-4';
import { GameManager } from './core/GameManager.js?v=20260725-4';
import { CombatArena } from './core/CombatArena.js?v=20260725-4';
import { MainMenu } from './ui/MainMenu.js?v=20260725-4';
import { LogicEditorUI } from './ui/LogicEditorUI.js?v=20260725-4';
import { BattleHUD } from './ui/BattleHUD.js?v=20260725-4';
import { RewardUI } from './ui/RewardUI.js?v=20260725-4';
import { PostBattleReportUI } from './ui/PostBattleReportUI.js?v=20260725-4';
import { VictoryUI } from './ui/VictoryUI.js?v=20260725-4';
import { CodeModal } from './ui/CodeModal.js?v=20260725-4';
import { AudioManager } from './systems/AudioManager.js?v=20260725-4';
import { BackgroundAnim } from './systems/BackgroundAnim.js?v=20260725-4';
import { escapeHtml } from './ui/safeHtml.js?v=20260725-4';
import { entity, setLocale, t } from './i18n/I18n.js?v=20260725-4';
import { trapDialogFocus } from './ui/focusTrap.js?v=20260725-4';
import { markBootComplete, recordRuntimeError, recordRuntimeEvent } from './systems/RuntimeDiagnostics.js?v=20260725-4';

const bootStatus = document.getElementById('boot-status');
const appNotice = document.getElementById('app-notice');
const appNoticeMessage = document.getElementById('app-notice-message');
const appNoticeAction = document.getElementById('btn-app-notice-action');
const appNoticeClose = document.getElementById('btn-app-notice-close');
const appVersion = document.getElementById('app-version');
const releaseMeta = document.querySelector('meta[name="overlogic-release"]');
const releaseId = releaseMeta?.content || '';
if (appVersion) appVersion.textContent = /^[A-Za-z0-9][A-Za-z0-9._-]{6,39}$/.test(releaseId)
  ? releaseId : 'DEV';
globalThis.__OVERLOGIC_RELEASE__ = appVersion?.textContent || 'DEV';
let noticeTimer = null;
let noticeActionHandler = null;

// Apply the saved locale before the first network request so a slow/failed
// boot never flashes the wrong language or falls back to English-only copy.
setLocale(GameState.settings.language, { notify: false });

function hideBootStatus() {
  bootStatus?.classList.add('hidden');
}

function showBootFailure(error) {
  recordRuntimeError(error, 'boot');
  if (!bootStatus) return;
  bootStatus.classList.remove('hidden');
  bootStatus.classList.add('error');
  bootStatus.replaceChildren();
  const title = document.createElement('strong');
  title.dataset.i18n = 'boot.offlineTitle';
  title.textContent = t('boot.offlineTitle');
  const detail = document.createElement('span');
  detail.dataset.i18n = 'boot.offlineDetail';
  detail.textContent = t('boot.offlineDetail');
  const retry = document.createElement('button');
  retry.type = 'button';
  retry.className = 'btn primary small';
  retry.dataset.i18n = 'boot.retry';
  retry.textContent = t('boot.retry');
  retry.addEventListener('click', () => window.location.reload());
  bootStatus.append(title, detail, retry);
  console.error('Overlogic boot failed:', error);
}

function showAppNotice(messageKey, { actionKey = null, onAction = null, autoHide = 0 } = {}) {
  if (!appNotice || !appNoticeMessage || !appNoticeAction) return;
  if (noticeTimer) clearTimeout(noticeTimer);
  if (noticeActionHandler) appNoticeAction.removeEventListener('click', noticeActionHandler);
  noticeActionHandler = null;
  appNoticeMessage.textContent = t(messageKey);
  appNotice.classList.remove('hidden');
  if (actionKey && onAction) {
    appNoticeAction.textContent = t(actionKey);
    appNoticeAction.classList.remove('hidden');
    noticeActionHandler = () => onAction();
    appNoticeAction.addEventListener('click', noticeActionHandler);
  } else {
    appNoticeAction.classList.add('hidden');
  }
  if (autoHide > 0) {
    noticeTimer = setTimeout(() => appNotice.classList.add('hidden'), autoHide);
  }
}

function setupRuntimeSafety() {
  appNoticeClose?.addEventListener('click', () => appNotice?.classList.add('hidden'));
  window.addEventListener('online', () => {
    recordRuntimeEvent('online');
    showAppNotice('notice.online', { autoHide: 3000 });
  });
  window.addEventListener('offline', () => {
    recordRuntimeEvent('offline');
    showAppNotice('notice.offline');
  });
  if (navigator.onLine === false) showAppNotice('notice.offline');

  let runtimeNoticeShown = false;
  const reportContainedError = (event) => {
    recordRuntimeError(event, event?.type || 'runtime');
    if (runtimeNoticeShown) return;
    runtimeNoticeShown = true;
    showAppNotice('notice.runtimeError');
  };
  window.addEventListener('error', reportContainedError);
  window.addEventListener('unhandledrejection', reportContainedError);
  window.addEventListener('overlogic:update-ready', () => {
    recordRuntimeEvent('update-ready');
    showAppNotice('notice.updateReady', {
      actionKey: 'notice.updateNow',
      onAction: () => window.location.reload(),
    });
  });
  window.addEventListener('overlogic:challenge-complete', () => {
    showAppNotice('notice.challengeComplete', { autoHide: 4200 });
  });
  const externalDataKeys = new Set([
    'overlogic_run_save',
    'overlogic_run_save_backup',
    'overlogic_settings',
    'overlogic_run_history',
    'overlogic_profile',
    'overlogic_live_challenges',
    'overlogic_run_archive',
    'overlogic_loadout_slot_1',
    'overlogic_loadout_slot_2',
    'overlogic_loadout_slot_3',
  ]);
  window.addEventListener('storage', (event) => {
    // `key === null` is emitted by localStorage.clear(); treat it as a
    // complete external data change so another tab cannot silently continue
    // on stale in-memory state.
    if (event.key !== null && !externalDataKeys.has(event.key)) return;
    recordRuntimeEvent(event.newValue ? 'external-data-updated' : 'external-data-cleared');
    showAppNotice('notice.externalSave', {
      actionKey: 'notice.reloadSave',
      onAction: () => window.location.reload(),
    });
  });
  GameState.on('storage', () => {
    if (!GameState.storageStatus.available) showAppNotice('notice.storageUnavailable');
  });
  if (GameState.storageStatus.restoredFromBackup) showAppNotice('notice.saveRestored');
  if (!GameState.storageStatus.available) showAppNotice('notice.storageUnavailable');
}

function registerServiceWorker() {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
  const hadController = Boolean(navigator.serviceWorker.controller);
  navigator.serviceWorker.register('./sw.js').then((registration) => {
    if (registration.waiting && hadController) {
      window.dispatchEvent(new CustomEvent('overlogic:update-ready'));
    }
    registration.addEventListener('updatefound', () => {
      const worker = registration.installing;
      worker?.addEventListener('statechange', () => {
        if (worker.state === 'installed' && hadController) {
          window.dispatchEvent(new CustomEvent('overlogic:update-ready'));
        }
      });
    });
  }).catch(() => {
    // Offline support is progressive enhancement; a blocked registration
    // must never prevent the game from loading.
  });
}

function setupInstallPrompt() {
  const installButton = document.getElementById('btn-install');
  if (!installButton || typeof window === 'undefined') return;
  let deferredPrompt = null;
  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    deferredPrompt = event;
    installButton.classList.remove('hidden');
  });
  installButton.addEventListener('click', async () => {
    if (!deferredPrompt) return;
    const promptEvent = deferredPrompt;
    deferredPrompt = null;
    installButton.classList.add('hidden');
    try {
      await promptEvent.prompt();
      await promptEvent.userChoice;
    } catch {
      // Installation is optional; a dismissed prompt should not affect play.
    }
  });
  window.addEventListener('appinstalled', () => {
    deferredPrompt = null;
    installButton.classList.add('hidden');
  });
}

async function main() {
  const bootStartedAt = Date.now();
  await GameDatabase.loadAll();
  GameState.normalizeAfterDatabaseLoad();
  setLocale(GameState.settings.language, { notify: false });

  // Initialize and run the cyber background animation
  const bgCanvas = document.getElementById('bg-canvas');
  let bgAnim = null;
  if (bgCanvas) {
    bgAnim = new BackgroundAnim(bgCanvas);
    bgAnim.setReducedMotion(GameState.settings.reduceMotion);
    bgAnim.start();
  }

  const mainMenu = new MainMenu();
  const codeModal = new CodeModal();
  const logicEditor = new LogicEditorUI(codeModal);
  const battleHUD = new BattleHUD(null);
  const rewardUI = new RewardUI();
  const reportUI = new PostBattleReportUI();
  const victoryUI = new VictoryUI();

  const canvas = document.getElementById('arena');
  let arena = null;

  GameState.onUpgradeNodeTriggered = () => {
    GameManager.isUpgradeReward = true;
    GameManager.goRewardSelection();
  };

  // Hook GameManager transitions to drive screen-specific setup.
  const origGoCombat = GameManager.goCombat.bind(GameManager);
  const origGoReward = GameManager.goRewardSelection.bind(GameManager);
  const origGoReport = GameManager.goPostBattleReport.bind(GameManager);
  const origGoLogic  = GameManager.goLogicEdit.bind(GameManager);
  const origGoMain   = GameManager.goMainMenu.bind(GameManager);
  const origGoVict   = GameManager.goVictory.bind(GameManager);
  const origGoSandbox = GameManager.goSandbox.bind(GameManager);

  GameManager.goCombat = () => {
    bgAnim?.stop();
    origGoCombat();
    const battle = GameState.getActiveBattle();
    if (!battle) { console.error('No active battle found'); return; }
    if (arena) arena.stop();
    arena = new CombatArena(canvas, battleHUD);
    battleHUD.arena = arena;
    arena.onFinished = (won) => GameManager.onBattleFinished(won);
    arena.start(battle);
  };
  GameManager.goSandbox = () => {
    bgAnim?.stop();
    origGoSandbox();
    const preset = document.getElementById('sandbox-preset')?.value || 'mixed';
    const scenarios = {
      mixed: [
        { enemyId: 'crawler', count: 2, wave: 1 },
        { enemyId: 'shooter', count: 1, wave: 1 },
        { enemyId: 'charger', count: 1, wave: 2 },
      ],
      projectiles: [
        { enemyId: 'shooter', count: 4, wave: 1 },
        { enemyId: 'emp_drone', count: 2, wave: 2 },
      ],
      swarm: [
        { enemyId: 'crawler', count: 8, wave: 1 },
        { enemyId: 'charger', count: 2, wave: 2 },
      ],
      boss: [{ enemyId: 'boss_warden', count: 1, wave: 1 }],
      support: [
        { enemyId: 'crawler', count: 3, wave: 1 },
        { enemyId: 'repair_drone', count: 1, wave: 1 },
        { enemyId: 'charger', count: 1, wave: 2 },
      ],
    };
    const sandboxBattle = {
      id: `sandbox_${preset}`,
      displayName: 'Sandbox Test Simulation',
      enemySpawns: scenarios[preset] || scenarios.mixed,
      hazardPattern: preset === 'swarm' || preset === 'boss' ? 'cross' : null,
      arenaType: 'standard_20x20',
      rewardPool: []
    };
    if (arena) arena.stop();
    arena = new CombatArena(canvas, battleHUD);
    battleHUD.arena = arena;
    arena.onFinished = (won) => {
      // Return straight to editor in sandbox mode
      GameManager.goLogicEdit();
    };
    arena.start(sandboxBattle);
  };
  GameManager.goRewardSelection = () => { bgAnim?.start(); origGoReward(); rewardUI.show(); };
  GameManager.goPostBattleReport = () => { bgAnim?.start(); origGoReport(); reportUI.show(); };
  GameManager.goLogicEdit = () => { bgAnim?.start(); origGoLogic(); logicEditor.show(); };
  GameManager.goMainMenu = () => {
    bgAnim?.start();
    origGoMain();
    if (arena) { arena.stop(); arena = null; }
    mainMenu.render();
  };
  GameManager.goVictory = () => {
    bgAnim?.start();
    origGoVict();
    if (arena) { arena.stop(); arena = null; }
    victoryUI.show();
  };

  let visibilityPausedCombat = false;
  document.addEventListener('visibilitychange', () => {
    if (!arena || GameManager.state !== 'combat') return;
    if (document.hidden && !arena.paused) {
      visibilityPausedCombat = true;
      bgAnim?.stop();
      arena.setPaused(true);
      battleHUD.btnPause.textContent = t('combat.resume');
      battleHUD.btnPause.setAttribute('aria-pressed', 'true');
      battleHUD.btnStep.classList.remove('hidden');
    } else if (!document.hidden && visibilityPausedCombat) {
      visibilityPausedCombat = false;
      bgAnim?.start();
      arena.setPaused(false);
      battleHUD.btnPause.textContent = t('combat.pause');
      battleHUD.btnPause.setAttribute('aria-pressed', 'false');
      battleHUD.btnStep.classList.add('hidden');
    }
  });

  // Settings Overlay Wiring
  const settingsOverlay = document.getElementById('settings-overlay');
  trapDialogFocus(settingsOverlay);
  const btnSettingsMain = document.getElementById('btn-settings');
  const btnSettingsEditor = document.getElementById('btn-editor-settings');
  const btnSettingsCombat = document.getElementById('btn-combat-settings');
  const btnSettingsClose = document.getElementById('btn-settings-close');
  const btnSettingsSave = document.getElementById('btn-settings-save');

  const settingVolume = document.getElementById('setting-volume');
  const settingVolumeVal = document.getElementById('setting-volume-val');
  const settingMute = document.getElementById('setting-mute');
  const settingShake = document.getElementById('setting-shake');
  const settingReduceMotion = document.getElementById('setting-reduce-motion');
  const settingLanguage = document.getElementById('setting-language');
  const btnDataExport = document.getElementById('btn-data-export');
  const btnDataImport = document.getElementById('btn-data-import');
  const btnDataRestore = document.getElementById('btn-data-restore');
  const btnDataSupport = document.getElementById('btn-data-support');
  const dataImportFile = document.getElementById('data-import-file');
  let settingsReturnFocus = null;
  let resumeCombatAfterSettings = false;
  let settingsOriginalVolume = null;

  function openSettings() {
    AudioManager.resume();
    // Load current values from GameState
    settingsOriginalVolume = GameState.settings.volume;
    settingVolume.value = GameState.settings.volume;
    settingVolumeVal.textContent = `${Math.round(GameState.settings.volume * 100)}%`;
    settingMute.checked = GameState.settings.mute;
    settingShake.checked = GameState.settings.screenShake;
    settingReduceMotion.checked = GameState.settings.reduceMotion;
    settingLanguage.value = GameState.settings.language;
    if (btnDataRestore) btnDataRestore.disabled = !GameState.hasBackup();

    settingsReturnFocus = document.activeElement;
    resumeCombatAfterSettings = GameManager.state === 'combat' && arena && !arena.paused;
    if (resumeCombatAfterSettings) {
      arena.setPaused(true);
      battleHUD.btnPause.textContent = t('combat.resume');
      battleHUD.btnPause.setAttribute('aria-pressed', 'true');
      battleHUD.btnStep.classList.remove('hidden');
    }
    settingsOverlay.classList.remove('hidden');
    settingsOverlay.setAttribute('aria-hidden', 'false');
    btnSettingsSave?.focus();
    AudioManager.play('button_click');
  }

  function closeSettings() {
    // Volume is previewed live while the range input moves. Closing without
    // Apply must not leave an unsaved audio change behind.
    if (settingsOriginalVolume !== null) AudioManager.setVolume(settingsOriginalVolume);
    settingsOriginalVolume = null;
    settingsOverlay.classList.add('hidden');
    settingsOverlay.setAttribute('aria-hidden', 'true');
    if (resumeCombatAfterSettings && arena && !arena._finished) {
      arena.setPaused(false);
      battleHUD.btnPause.textContent = t('combat.pause');
      battleHUD.btnPause.setAttribute('aria-pressed', 'false');
      battleHUD.btnStep.classList.add('hidden');
    }
    resumeCombatAfterSettings = false;
    if (settingsReturnFocus instanceof HTMLElement) settingsReturnFocus.focus();
    settingsReturnFocus = null;
    AudioManager.play('button_click');
  }

  if (btnSettingsMain) btnSettingsMain.addEventListener('click', openSettings);
  if (btnSettingsEditor) btnSettingsEditor.addEventListener('click', openSettings);
  if (btnSettingsCombat) btnSettingsCombat.addEventListener('click', openSettings);
  if (btnSettingsClose) btnSettingsClose.addEventListener('click', closeSettings);
  settingsOverlay?.addEventListener('click', (event) => {
    if (event.target === settingsOverlay) closeSettings();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && settingsOverlay && !settingsOverlay.classList.contains('hidden')) {
      event.preventDefault();
      closeSettings();
    }
  });

  if (settingVolume) {
    settingVolume.addEventListener('input', () => {
      settingVolumeVal.textContent = `${Math.round(settingVolume.value * 100)}%`;
      // Real-time preview of volume
      AudioManager.setVolume(settingVolume.value);
    });
  }

  if (btnSettingsSave) {
    btnSettingsSave.addEventListener('click', () => {
      GameState.settings.volume = parseFloat(settingVolume.value);
      GameState.settings.mute = settingMute.checked;
      GameState.settings.screenShake = settingShake.checked;
      GameState.settings.reduceMotion = settingReduceMotion.checked;
      GameState.settings.language = settingLanguage.value;
      GameState.saveSettings();
      settingsOriginalVolume = null;
      setLocale(GameState.settings.language);
      document.documentElement.classList.toggle('reduce-motion', GameState.settings.reduceMotion);
      if (bgAnim) bgAnim.setReducedMotion(GameState.settings.reduceMotion);
      
      closeSettings();
      AudioManager.play('rule_add'); // Success arpeggio
    });
  }

  btnDataExport?.addEventListener('click', () => {
    try {
      const blob = new Blob([GameState.exportSaveData()], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `overlogic-save-${new Date().toISOString().slice(0, 10)}.json`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 0);
      showAppNotice('notice.saveExported', { autoHide: 3500 });
    } catch {
      showAppNotice('notice.exportFailed');
    }
  });

  btnDataSupport?.addEventListener('click', () => {
    try {
      const blob = new Blob([GameState.exportSupportBundle()], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `overlogic-support-${new Date().toISOString().slice(0, 10)}.json`;
      link.className = 'hidden';
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      showAppNotice('notice.supportExported', { autoHide: 3500 });
    } catch {
      showAppNotice('notice.exportFailed');
    }
  });

  btnDataImport?.addEventListener('click', () => dataImportFile?.click());
  dataImportFile?.addEventListener('change', async () => {
    const file = dataImportFile.files?.[0];
    dataImportFile.value = '';
    if (!file || file.size > 1_000_000) {
      showAppNotice('notice.importFailed');
      return;
    }
    const imported = GameState.importSaveData(await file.text());
    if (!imported) {
      showAppNotice('notice.importFailed');
      return;
    }
    showAppNotice('notice.saveImported', {
      actionKey: 'notice.reloadSave',
      onAction: () => window.location.reload(),
    });
  });

  btnDataRestore?.addEventListener('click', () => {
    if (!GameState.restoreBackup()) {
      showAppNotice('notice.restoreFailed');
      return;
    }
    showAppNotice('notice.saveRestored', {
      actionKey: 'notice.reloadSave',
      onAction: () => window.location.reload(),
    });
    btnDataRestore.disabled = !GameState.hasBackup();
  });

  // Global Tooltip Delegator
  const tooltip = document.getElementById('custom-tooltip');
  document.addEventListener('mouseover', (e) => {
    const el = e.target.closest('[data-tooltip-type]');
    if (!el || !tooltip) return;

    const type = el.dataset.tooltipType;
    const id = el.dataset.tooltipId || el.dataset.nodeId;
    let content = '';

    if (type === 'condition') {
      const c = GameDatabase.getCondition(id);
      if (c) {
        content = `<strong style="color:var(--accent); font-size:12px;">${escapeHtml(entity('condition', id, c.displayName))}</strong><br>` +
                  `<span style="color:var(--muted); font-size:10px;">${escapeHtml(t('tooltip.conditionCode'))}: ${escapeHtml(id)}</span><br>` +
                  `<p style="margin:6px 0 0 0; font-size:11px;">${escapeHtml(entity('condition', id, c.description, 'description'))}</p>` +
                  (c.parameterType !== 'none' ? `<span style="color:var(--accent2); font-size:10px; display:block; margin-top:4px;">${escapeHtml(t('tooltip.valueType'))}: ${escapeHtml(c.parameterType)}</span>` : '');
      }
    } else if (type === 'action') {
      const a = GameDatabase.getAction(id);
      if (a) {
        content = `<strong style="color:var(--accent); font-size:12px;">${escapeHtml(entity('action', id, a.displayName))}</strong><br>` +
                  `<span style="color:var(--muted); font-size:10px;">${escapeHtml(t('tooltip.actionCode'))}: ${escapeHtml(id)}</span><br>` +
                  `<p style="margin:6px 0 6px 0; font-size:11px;">${escapeHtml(entity('action', id, a.description, 'description'))}</p>` +
                  `<span style="color:var(--accent2); font-size:10px; display:block;">${escapeHtml(t('tooltip.cooldown'))}: ${escapeHtml(a.cooldown)}s · ${escapeHtml(t('tooltip.cost'))}: ${escapeHtml(a.energyCost)} EN · ${escapeHtml(t('tooltip.range'))}: ${escapeHtml(a.range)}m</span>`;
      }
    } else if (type === 'map-node') {
      // Find the node from GameState mapNodes
      let foundNode = null;
      for (const col of GameState.mapNodes) {
        const n = col.find(node => node.id === id);
        if (n) { foundNode = n; break; }
      }
      if (foundNode) {
        const typeLabels = { combat: t('map.combat'), repair: t('map.repair'), upgrade: t('map.upgrade') };
        let detail = '';
        if (foundNode.type === 'combat') {
          const b = GameDatabase.getBattle(foundNode.battleIndex);
          if (b) {
            detail = `<span style="color:#ff3e3e; display:block; margin-top:4px;">${escapeHtml(t('map.enemies'))}: ${escapeHtml(b.enemySpawns.map(s => `${s.count}× ${entity('enemy', s.enemyId, s.enemyId)}`).join(', '))}</span>`;
          }
        } else if (foundNode.type === 'repair') {
          detail = `<span style="color:#3eff9d; display:block; margin-top:4px;">${escapeHtml(t('map.repairDesc'))}</span>`;
        } else if (foundNode.type === 'upgrade') {
          detail = `<span style="color:var(--accent2); display:block; margin-top:4px;">${escapeHtml(t('map.upgradeDesc'))}</span>`;
        }
        const battle = foundNode.type === 'combat' ? GameDatabase.getBattle(foundNode.battleIndex) : null;
        const nodeName = battle ? entity('battle', battle.id, battle.displayName) : typeLabels[foundNode.type];
        content = `<strong style="color:var(--accent); font-size:12px;">${escapeHtml(nodeName)}</strong><br>` +
                  `<span style="color:var(--muted); font-size:10px;">${escapeHtml(typeLabels[foundNode.type] || foundNode.type)}</span>` +
                  detail;
      }
    }

    if (content) {
      tooltip.innerHTML = content;
      tooltip.classList.remove('hidden');
      tooltip.style.display = 'block';

      // Position tooltip
      const rect = el.getBoundingClientRect();
      const tooltipW = tooltip.offsetWidth;
      const tooltipH = tooltip.offsetHeight;
      
      // Center above element
      let left = window.scrollX + rect.left - tooltipW / 2 + rect.width / 2;
      let top = window.scrollY + rect.top - tooltipH - 8;

      // Keep inside window bounds
      if (left < 10) left = 10;
      if (left + tooltipW > window.innerWidth - 10) left = window.innerWidth - tooltipW - 10;
      if (top < 10) top = window.scrollY + rect.bottom + 8; // flip to bottom if it overflows top

      tooltip.style.left = `${left}px`;
      tooltip.style.top = `${top}px`;
    }
  });

  document.addEventListener('mouseout', (e) => {
    const el = e.target.closest('[data-tooltip-type]');
    if (el && tooltip) {
      tooltip.classList.add('hidden');
      tooltip.style.display = 'none';
    }
  });

  // Module and map tooltips are also useful to keyboard and switch-control
  // users. Reuse the existing hover renderer so focus and pointer input stay
  // visually identical without duplicating positioning logic.
  document.addEventListener('focusin', (e) => {
    const el = e.target.closest?.('[data-tooltip-type]');
    if (el) el.dispatchEvent(new Event('mouseover', { bubbles: true }));
  });
  document.addEventListener('focusout', (e) => {
    const el = e.target.closest?.('[data-tooltip-type]');
    if (el) el.dispatchEvent(new Event('mouseout', { bubbles: true }));
  });

  // Global Hover Audio Feedback Delegator
  document.addEventListener('mouseenter', (e) => {
    const target = e.target;
    if (!target || typeof target.matches !== 'function') return;
    
    const matchesHover = 
      target.matches('.btn, button, select, input[type="range"], input[type="checkbox"], .map-node.unlocked, .module-list li, .combat-rule-item, .reward-card');
      
    if (matchesHover) {
      AudioManager.play('hover_tick');
    }
  }, { capture: true, passive: true });

  // Start at main menu
  document.documentElement.classList.toggle('reduce-motion', GameState.settings.reduceMotion);
  GameManager.goMainMenu();
  markBootComplete(Date.now() - bootStartedAt);
  hideBootStatus();
}

setupRuntimeSafety();
registerServiceWorker();
setupInstallPrompt();
main().catch(err => {
  showBootFailure(err);
});
