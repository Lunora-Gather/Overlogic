// LogicRule.js — rule sorting helper. Pure function, mirrors scripts/logic/LogicRule.gd.
import { entity, t } from '../i18n/I18n.js?v=20260725-4';

// Stable sort by priority descending. JS Array.sort is stable in modern engines.
export function sortDesc(rules) {
  return [...rules].sort((a, b) => b.priority - a.priority);
}

export function formatCond(condId, val, db, negated = false) {
  if (!condId) return '';
  const c = db.getCondition(condId);
  const cName = c ? entity('condition', condId, c.displayName) : condId;
  let vStr = '';
  if (typeof val === 'number') {
    vStr = c && c.parameterType === 'percent' ? ` ${Math.round(val * 100)}%` : ` ${val.toFixed(1)}`;
  } else if (Array.isArray(val)) {
    vStr = ` (${val[0].toFixed(1)},${val[1].toFixed(0)})`;
  }
  return `${negated ? `${t('common.not')} ` : ''}${cName}${vStr}`;
}

// Format a rule for HUD display: "[P{n}] IF Cond val THEN Action"
export function formatLabel(rule, db) {
  if (!rule || !rule.conditionId) return t('combat.idle');
  const cond1Str = formatCond(rule.conditionId, rule.conditionValue, db, rule.negateCondition1);
  let condStr = cond1Str;
  if (rule.operator && rule.conditionId2) {
    const cond2Str = formatCond(rule.conditionId2, rule.conditionValue2, db, rule.negateCondition2);
    const opStr = rule.operator.toUpperCase();
    condStr = `${cond1Str} ${opStr} ${cond2Str}`;
  }
  const a = db.getAction(rule.actionId);
  const aName = a ? entity('action', rule.actionId, a.displayName) : rule.actionId;
  const targetStr = rule.targetPriority && rule.targetPriority !== 'nearest' ? ` (${t(`target.${rule.targetPriority}`)})` : '';
  return `[P${rule.priority|0}] ${t('combat.if')} ${condStr} ${t('combat.then')} ${aName}${targetStr}`;
}
