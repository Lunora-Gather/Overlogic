// GameManager.js — top-level FSM: MainMenu / LogicEditing / Combat / RewardSelection
// / PostBattleReport / Victory. Single-page screen switching.
// Mirrors scripts/core/GameManager.gd.

import { GameState } from './GameState.js?v=20260725-4';

const State = {
  MainMenu: 'main', LogicEditing: 'editor', Combat: 'combat',
  RewardSelection: 'reward', PostBattleReport: 'report', Victory: 'victory',
};

class GameManagerClass {
  constructor() {
    this.state = State.MainMenu;
    this.lastBattleWon = false;
    this._cancelPendingFocus = null;
  }

  _show(id) {
    const target = document.getElementById('screen-' + id);
    if (!target) return;
    for (const screen of document.querySelectorAll('.screen')) {
      const active = screen === target;
      screen.classList.toggle('hidden', !active);
      screen.setAttribute('aria-hidden', active ? 'false' : 'true');
      screen.inert = !active;
    }
    target.dataset.enteredAt = String(Date.now());
    const browserWindow = globalThis.window;
    if (typeof browserWindow?.dispatchEvent === 'function' && typeof globalThis.CustomEvent === 'function') {
      browserWindow.dispatchEvent(new globalThis.CustomEvent('overlogic:screenchange', { detail: { id } }));
    }

    // A fast route change can queue multiple animation frames. Cancel the old
    // focus job so a hidden screen never steals focus back from the new one.
    this._cancelPendingFocus?.();
    const scheduleFocus = typeof globalThis.requestAnimationFrame === 'function'
      ? (fn) => {
        const id = globalThis.requestAnimationFrame(fn);
        this._cancelPendingFocus = () => globalThis.cancelAnimationFrame?.(id);
        return id;
      }
      : (fn) => {
        const id = globalThis.setTimeout(fn, 0);
        this._cancelPendingFocus = () => globalThis.clearTimeout?.(id);
        return id;
      };
    scheduleFocus(() => {
      this._cancelPendingFocus = null;
      const preferred = target.querySelector('[data-autofocus], .screen-primary, #btn-new-run, #btn-continue, #btn-add-rule, #btn-pause, #btn-retry');
      if (preferred && typeof preferred.focus === 'function' && !preferred.disabled) preferred.focus({ preventScroll: true });
    });
  }

  goMainMenu() {
    GameState.recordRunCompletion();
    this.state = State.MainMenu;
    this._show('main');
  }
  goLogicEdit()   { this.state = State.LogicEditing;    this._show('editor'); }
  goCombat()      { this.state = State.Combat;          this._show('combat'); }
  goRewardSelection() { this.state = State.RewardSelection; this._show('reward'); }
  goPostBattleReport() { this.state = State.PostBattleReport; this._show('report'); }
  goVictory()     { this.state = State.Victory;         this._show('victory'); }
  goSandbox()     { this.state = State.Combat;          this._show('combat'); }

  resumePendingBattle() {
    if (GameState.hasPendingUpgradeReward()) {
      this.goRewardSelection();
      return true;
    }
    if (!GameState.hasPendingBattleResolution()) return false;
    const endHp = Number(GameState.lastReport?._endHp) || null;
    if (GameState.isPendingFinalBattle()) {
      GameState.onBattleWon('', endHp);
      GameState.recordRunCompletion();
      this.goVictory();
    } else {
      this.goRewardSelection();
    }
    return true;
  }

  // Called by CombatArena when a battle ends.
  onBattleFinished(won) {
    this.lastBattleWon = won;
    if (won) {
      this.resumePendingBattle();
    } else {
      this.goPostBattleReport();
    }
  }

  // Called by RewardScreen after player picks a reward.
  onRewardChosen(rewardId) {
    const applied = GameState.hasPendingUpgradeReward()
      ? GameState.onUpgradeNodeChosen(rewardId)
      : GameState.hasPendingBattleResolution() && GameState.onBattleWon(rewardId, GameState.lastReport._endHp);
    if (applied) this.goLogicEdit();
  }

  // Called by PostBattleReport buttons.
  onReportRetryBattle() { this.goCombat(); }
  onReportEditLogic()   { this.goLogicEdit(); }
  onReportRestartRun()  { GameState.resetRun(); this.goLogicEdit(); }
}

export const GameManager = new GameManagerClass();
export { State };
