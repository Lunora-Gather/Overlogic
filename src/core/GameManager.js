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
    this.isUpgradeReward = false;
  }

  _show(id) {
    for (const s of document.querySelectorAll('.screen')) s.classList.add('hidden');
    document.getElementById('screen-' + id).classList.remove('hidden');
  }

  goMainMenu()    { this.state = State.MainMenu;        this._show('main'); }
  goLogicEdit()   { this.state = State.LogicEditing;    this._show('editor'); }
  goCombat()      { this.state = State.Combat;          this._show('combat'); this.isUpgradeReward = false; }
  goRewardSelection() { this.state = State.RewardSelection; this._show('reward'); }
  goPostBattleReport() { this.state = State.PostBattleReport; this._show('report'); }
  goVictory()     { this.state = State.Victory;         this._show('victory'); }
  goSandbox()     { this.state = State.Combat;          this._show('combat'); this.isUpgradeReward = false; }

  resumePendingBattle() {
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
      // Final boss cleared?
      const isLast = GameState.currentMapColumn >= GameState.mapNodes.length - 1;
      if (isLast) {
        const endHp = GameState.lastReport._endHp || null;
        GameState.onBattleWon('', endHp);
        GameState.recordRunCompletion();
        this.goVictory();
      } else {
        this.goRewardSelection();
      }
    } else {
      this.goPostBattleReport();
    }
  }

  // Called by RewardScreen after player picks a reward.
  onRewardChosen(rewardId) {
    const endHp = GameState.lastReport._endHp || null;
    if (this.isUpgradeReward) {
      GameState.onUpgradeNodeChosen(rewardId);
      this.isUpgradeReward = false;
    } else {
      GameState.onBattleWon(rewardId, endHp);
    }
    if (GameState.isDemoCleared()) {
      GameState.recordRunCompletion();
      this.goVictory();
    }
    else this.goLogicEdit();
  }

  // Called by PostBattleReport buttons.
  onReportRetryBattle() { this.goCombat(); }
  onReportEditLogic()   { this.goLogicEdit(); }
  onReportRestartRun()  { GameState.resetRun(); this.goLogicEdit(); }
}

export const GameManager = new GameManagerClass();
export { State };
