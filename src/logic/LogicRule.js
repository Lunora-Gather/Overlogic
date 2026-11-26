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
  let clause = cName;
  const key = `rule.condition.${condId}`;
  const round = value => Number(value.toFixed(2));
  if (Number.isFinite(val)) {
    const percent = c?.parameterType === 'percent';
    const value = percent ? round(val * 100) : round(val);
    clause = t(key, { value });
    if (clause === key) clause = `${cName} ${value}${percent ? '%' : ''}`;
  } else if (Array.isArray(val) && Number.isFinite(val[0]) && Number.isFinite(val[1])) {
    const radius = round(val[0]);
    const count = Math.trunc(val[1]);
    clause = t(key, { radius, count });
    if (clause === key) clause = `${cName} (${radius}, ${count})`;
  }
  return negated ? `${t('common.not')} (${clause})` : clause;
}

// Format a rule for HUD display: "[P{n}] IF Cond val THEN Action"
export function formatLabel(rule, db) {
  if (!rule || !rule.conditionId) return t('combat.idle');
  const { condition, action } = describeRule(rule, db);
  return `[P${rule.priority|0}] ${t('combat.if')} ${condition} ${t('combat.then')} ${action}`;
}

export function describeRule(rule, db) {
  const cond1Str = formatCond(rule.conditionId, rule.conditionValue, db, rule.negateCondition1);
  let condStr = cond1Str;
  if (rule.operator && rule.conditionId2) {
    const cond2Str = formatCond(rule.conditionId2, rule.conditionValue2, db, rule.negateCondition2);
    const opStr = t(`rule.${rule.operator}`);
    condStr = `${cond1Str} ${opStr} ${cond2Str}`;
  }
  const a = db.getAction(rule.actionId);
  const aName = a ? entity('action', rule.actionId, a.displayName) : rule.actionId;
  const targetStr = rule.targetPriority && rule.targetPriority !== 'nearest' ? ` (${t(`target.${rule.targetPriority}`)})` : '';
  return { condition: condStr, action: aName + targetStr };
}
