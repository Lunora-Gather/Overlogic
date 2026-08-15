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
import { AudioManager } from './systems/AudioManager.js?v=20260725-4';
import { BackgroundAnim } from './systems/BackgroundAnim.js?v=20260725-4';
import { escapeHtml } from './ui/safeHtml.js?v=20260725-4';
import { entity, setLocale, t } from './i18n/I18n.js?v=20260725-4';
import { trapDialogFocus } from './ui/focusTrap.js?v=20260725-4';

async function main() {
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
  const logicEditor = new LogicEditorUI();
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
      arena.setPaused(true);
      battleHUD.btnPause.textContent = t('combat.resume');
      battleHUD.btnPause.setAttribute('aria-pressed', 'true');
      battleHUD.btnStep.classList.remove('hidden');
    } else if (!document.hidden && visibilityPausedCombat) {
      visibilityPausedCombat = false;
      bgAnim?.stop();
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
  let settingsReturnFocus = null;
  let resumeCombatAfterSettings = false;

  function openSettings() {
    AudioManager.resume();
    // Load current values from GameState
    settingVolume.value = GameState.settings.volume;
    settingVolumeVal.textContent = `${Math.round(GameState.settings.volume * 100)}%`;
    settingMute.checked = GameState.settings.mute;
    settingShake.checked = GameState.settings.screenShake;
    settingReduceMotion.checked = GameState.settings.reduceMotion;
    settingLanguage.value = GameState.settings.language;

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
      setLocale(GameState.settings.language);
      document.documentElement.classList.toggle('reduce-motion', GameState.settings.reduceMotion);
      if (bgAnim) bgAnim.setReducedMotion(GameState.settings.reduceMotion);
      
      closeSettings();
      AudioManager.play('rule_add'); // Success arpeggio
    });
  }

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
}

main().catch(err => {
  console.error('Overlogic boot failed:', err);
  document.body.innerHTML = `<div style="padding:24px;color:#f55;font-family:monospace">Boot failed: ${escapeHtml(err?.message || err)}<br>Run via a local web server (e.g. <code>python -m http.server</code>) — fetch() needs http, not file://.</div>`;
});
