// main.js — entry point. Loads data, wires screens, hosts CombatArena lifecycle.

import { GameDatabase } from './core/GameDatabase.js';
import { GameState } from './core/GameState.js';
import { GameManager } from './core/GameManager.js';
import { CombatArena } from './core/CombatArena.js';
import { MainMenu } from './ui/MainMenu.js';
import { LogicEditorUI } from './ui/LogicEditorUI.js';
import { BattleHUD } from './ui/BattleHUD.js';
import { RewardUI } from './ui/RewardUI.js';
import { PostBattleReportUI } from './ui/PostBattleReportUI.js';
import { VictoryUI } from './ui/VictoryUI.js';
import { AudioManager } from './systems/AudioManager.js';
import { BackgroundAnim } from './systems/BackgroundAnim.js';
import { escapeHtml } from './ui/safeHtml.js';

async function main() {
  await GameDatabase.loadAll();
  GameState.normalizeAfterDatabaseLoad();

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

  // Bulletproof viewport scroll locks to prevent browser auto-scroll / bouncing behaviors
  window.addEventListener('scroll', () => {
    window.scrollTo(0, 0);
  }, { passive: true });

  const screenCombat = document.getElementById('screen-combat');
  if (screenCombat) {
    screenCombat.addEventListener('scroll', () => {
      screenCombat.scrollTop = 0;
      screenCombat.scrollLeft = 0;
    }, { passive: true });
  }

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
    origGoSandbox();
    const sandboxBattle = {
      id: 'sandbox',
      displayName: 'Sandbox Test Simulation',
      enemySpawns: [
        { enemyId: 'crawler', count: 2, wave: 1 },
        { enemyId: 'shooter', count: 1, wave: 1 },
        { enemyId: 'charger', count: 1, wave: 2 }
      ],
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
  GameManager.goRewardSelection = () => { origGoReward(); rewardUI.show(); };
  GameManager.goPostBattleReport = () => { origGoReport(); reportUI.show(); };
  GameManager.goLogicEdit = () => { origGoLogic(); logicEditor.show(); };
  GameManager.goMainMenu = () => {
    origGoMain();
    if (arena) { arena.stop(); arena = null; }
  };
  GameManager.goVictory = () => {
    origGoVict();
    if (arena) { arena.stop(); arena = null; }
    victoryUI.show();
  };

  // Settings Overlay Wiring
  const settingsOverlay = document.getElementById('settings-overlay');
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

  function openSettings() {
    AudioManager.resume();
    // Load current values from GameState
    settingVolume.value = GameState.settings.volume;
    settingVolumeVal.textContent = `${Math.round(GameState.settings.volume * 100)}%`;
    settingMute.checked = GameState.settings.mute;
    settingShake.checked = GameState.settings.screenShake;
    settingReduceMotion.checked = GameState.settings.reduceMotion;

    settingsOverlay.classList.remove('hidden');
    AudioManager.play('button_click');
  }

  function closeSettings() {
    settingsOverlay.classList.add('hidden');
    AudioManager.play('button_click');
  }

  if (btnSettingsMain) btnSettingsMain.addEventListener('click', openSettings);
  if (btnSettingsEditor) btnSettingsEditor.addEventListener('click', openSettings);
  if (btnSettingsCombat) btnSettingsCombat.addEventListener('click', openSettings);
  if (btnSettingsClose) btnSettingsClose.addEventListener('click', closeSettings);

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
      GameState.saveSettings();
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
        content = `<strong style="color:var(--accent); font-size:12px;">${escapeHtml(c.displayName)}</strong><br>` +
                  `<span style="color:var(--muted); font-size:10px;">Condition Code: ${escapeHtml(id)}</span><br>` +
                  `<p style="margin:6px 0 0 0; font-size:11px;">${escapeHtml(c.description)}</p>` +
                  (c.parameterType !== 'none' ? `<span style="color:var(--accent2); font-size:10px; display:block; margin-top:4px;">Requires value type: ${escapeHtml(c.parameterType)}</span>` : '');
      }
    } else if (type === 'action') {
      const a = GameDatabase.getAction(id);
      if (a) {
        content = `<strong style="color:var(--accent); font-size:12px;">${escapeHtml(a.displayName)}</strong><br>` +
                  `<span style="color:var(--muted); font-size:10px;">Action Code: ${escapeHtml(id)}</span><br>` +
                  `<p style="margin:6px 0 6px 0; font-size:11px;">${escapeHtml(a.description)}</p>` +
                  `<span style="color:var(--accent2); font-size:10px; display:block;">Cooldown: ${escapeHtml(a.cooldown)}s · Cost: ${escapeHtml(a.energyCost)} EN · Range: ${escapeHtml(a.range)}m</span>`;
      }
    } else if (type === 'map-node') {
      // Find the node from GameState mapNodes
      let foundNode = null;
      for (const col of GameState.mapNodes) {
        const n = col.find(node => node.id === id);
        if (n) { foundNode = n; break; }
      }
      if (foundNode) {
        const typeLabels = { combat: '⚔️ Combat Simulation', repair: '🔧 Nano-Repair Node', upgrade: '💎 Upgrade Vault' };
        let detail = '';
        if (foundNode.type === 'combat') {
          const b = GameDatabase.getBattle(foundNode.battleIndex);
          if (b) {
            detail = `<span style="color:#ff3e3e; display:block; margin-top:4px;">Enemies: ${escapeHtml(b.enemySpawns.map(s => `${s.count}x ${s.enemyId}`).join(', '))}</span>`;
          }
        } else if (foundNode.type === 'repair') {
          detail = `<span style="color:#3eff9d; display:block; margin-top:4px;">Increases Max HP by +25. Instantly restores all HP.</span>`;
        } else if (foundNode.type === 'upgrade') {
          detail = `<span style="color:var(--accent2); display:block; margin-top:4px;">Choose a powerful passive protocol upgrade.</span>`;
        }
        content = `<strong style="color:var(--accent); font-size:12px;">${escapeHtml(foundNode.label)}</strong><br>` +
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
