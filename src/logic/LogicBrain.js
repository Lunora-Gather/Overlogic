// LogicBrain.js — tick-driven brain. Every tickInterval seconds, gathers valid rules,
// picks highest priority, executes via ActionExecutor, emits current-logic label.
// Mirrors scripts/logic/LogicBrain.gd.

import { GameState } from '../core/GameState.js?v=20260725-4';
import { GameDatabase } from '../core/GameDatabase.js?v=20260725-4';
import { ConditionEvaluator } from './ConditionEvaluator.js?v=20260725-4';
import { sortDesc, formatLabel } from './LogicRule.js?v=20260725-4';
import { t } from '../i18n/I18n.js?v=20260725-4';

const TICK_INTERVAL = 0.15;     // seconds (DESIGN.md §5.2)

export class LogicBrain {
  constructor() {
    this.robot = null;
    this.ctx = null;
    this.executor = null;
    this.tracker = null;
    this.evaluator = new ConditionEvaluator();
    this.tickTimer = 0;
    this.currentRule = null;
    this.currentLabel = t('combat.idle');
    // overlogic fast-switch detection
    this.recentRuleIds = [];
    this.recentRuleWindow = 0;
    this.onLabel = null;        // callback(label, rule, diagnostics, diagnosticReasons)
  }

  setup(robot, ctx, executor, tracker) {
    this.robot = robot;
    this.ctx = ctx;
    this.executor = executor;
    this.tracker = tracker;
    this.tickTimer = 0;
    this.currentRule = null;
    this.recentRuleIds = [];
    this.recentRuleWindow = 0;
  }

  // dt is already combat-speed-scaled.
  tick(dt) {
    if (!this.robot || this.robot.dead) return;
    this.tickTimer += dt;
    this.recentRuleWindow += dt;
    if (this.recentRuleWindow >= 0.5) {
      this.recentRuleWindow = 0;
      this.recentRuleIds = [];
    }
    if (this.tickTimer >= TICK_INTERVAL) {
      this.tickTimer = 0;
      this._tick();
    }
  }

  _tick() {
    const rules = GameState.rules;
    const valid = [];
    const diagnostics = {};
    const diagnosticReasons = {};

    // Default movement: pursue nearest enemy at 60% speed.
    // If a rule changes movement (like dash or pursue out-of-range basic attack), it will override this.
    // This prevents the robot from drifting in a stale direction when casting non-movement skills like Shield or Repair.
    const nearestEnemy = this.ctx.nearestEnemyTo({ x: this.robot.x, y: this.robot.y });
    if (nearestEnemy) {
      const dx = nearestEnemy.x - this.robot.x;
      const dy = nearestEnemy.y - this.robot.y;
      const len = Math.hypot(dx, dy) || 1;
      this.robot.moveIntent = {
        x: (dx / len) * this.robot.moveSpeed * 0.6,
        y: (dy / len) * this.robot.moveSpeed * 0.6
      };
    } else {
      this.robot.moveIntent = { x: 0, y: 0 };
    }

    for (const r of rules) {
      if (r.enabled === false) {
        diagnostics[r.id] = 'disabled';
        continue;
      }
      const actId = r.actionId;
      if (this.executor.isOnCooldown(actId)) {
        diagnostics[r.id] = 'cooldown';
        continue;
      }
      if (this.robot.energy < this.executor.energyCost(actId)) {
        diagnostics[r.id] = 'energy';
        continue;
      }
      const unavailableReason = this.executor.unavailableReason(actId, r);
      if (unavailableReason) {
        diagnostics[r.id] = 'action_unavailable';
        diagnosticReasons[r.id] = unavailableReason;
        continue;
      }
      if (actId === 'interrupt_shot' && this.ctx.castingEnemies().length === 0) {
        diagnostics[r.id] = 'condition_false';
        continue;
      }
      if (this.evaluator.evaluate(this.robot, this.ctx, r)) {
        valid.push(r);
        diagnostics[r.id] = 'overridden';
      } else {
        diagnostics[r.id] = 'condition_false';
      }
    }

    if (valid.length === 0) {
      this.robot.aimTarget = null;
      this.executor.executeDefault();
      if (this.tracker) this.tracker.recordDiagnostics(diagnostics);
      this._emit(null, t('combat.idle'), diagnostics, diagnosticReasons);
      return;
    }

    const sorted = sortDesc(valid);
    const chosen = sorted[0];
    diagnostics[chosen.id] = 'executing';

    // Store target for laser aiming visual pointer (Task 4)
    const priority = chosen.targetPriority || 'nearest';
    if (['basic_attack', 'interrupt_shot'].includes(chosen.actionId)) {
      this.robot.aimTarget = this.executor._resolveTarget(priority);
    } else {
      this.robot.aimTarget = null;
    }

    const ok = this.executor.execute(chosen.actionId, chosen);
    if (ok) {
      this._trackAndOverlogic(chosen);
      this._emit(chosen, formatLabel(chosen, GameDatabase), diagnostics, diagnosticReasons);
    } else {
      if (['basic_attack', 'interrupt_shot', 'dash_through'].includes(chosen.actionId)) {
        diagnostics[chosen.id] = 'pursuing';
        this._emit(chosen, t('combat.pursuingLabel', {
          label: formatLabel(chosen, GameDatabase),
        }), diagnostics);
      } else {
        diagnostics[chosen.id] = 'action_unavailable';
        diagnosticReasons[chosen.id] = this.executor.unavailableReason(chosen.actionId, chosen) || 'unknown';
        this.robot.aimTarget = null;
        this.executor.executeDefault();
        this._emit(null, t('combat.idle'), diagnostics, diagnosticReasons);
      }
    }
    if (this.tracker) this.tracker.recordDiagnostics(diagnostics);
  }

  _trackAndOverlogic(rule) {
    if (this.tracker) this.tracker.recordAction(rule.actionId, rule.id);
    if (!this.recentRuleIds.includes(rule.id)) {
      this.recentRuleIds.push(rule.id);
      if (this.recentRuleIds.length >= 3) {
        this.ctx.overlogic.addEvent('fast_switch', 12);
      }
    }
  }

  _emit(rule, label, diagnostics = null, diagnosticReasons = null) {
    this.currentRule = rule;
    this.currentLabel = label;
    if (this.onLabel) this.onLabel(label, rule, diagnostics, diagnosticReasons);
  }
}
