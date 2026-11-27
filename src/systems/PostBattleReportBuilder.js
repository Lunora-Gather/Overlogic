// PostBattleReportBuilder.js — deterministic report text from a tracker snapshot.
import { GameDatabase } from '../core/GameDatabase.js?v=20260725-4';
import { entity, t } from '../i18n/I18n.js?v=20260725-4';

export function damageSourceLabel(source) {
  if (source === 'plasma_hazard') return t('report.plasmaHazard');
  if (source === 'overlogic_heat') return t('report.overlogicHeat');
  return entity('enemy', source, GameDatabase.getEnemy(source)?.displayName || source);
}

export function buildReport(report, availableActionIds, availableConditionIds = []) {
  const damageBySource = report.damage_by_source || {};
  const actionUsage = report.action_usage || {};
  const timedOut = report._timedOut === true;
  const shieldActivatedAtHp = report.shield_activated_at_hp ?? -1;
  const energyOverflowTime = report.energy_overflow_time ?? 0;
  const deathHp = report.death_hp ?? 0;
  const deathEnergy = report.death_energy ?? 0;
  const deathNearbyEnemyCount = report.death_nearby_enemy_count ?? 0;
  const interruptMisses = report.interrupt_misses ?? 0;
  const hasAction = (id) => availableActionIds.includes(id);
  const hasCondition = (id) => availableConditionIds.includes(id);

  // Damage lines (sorted desc by amount)
  const damageLines = [];
  const sources = Object.keys(damageBySource)
    .sort((a, b) => damageBySource[b] - damageBySource[a]);
  for (const s of sources) {
    damageLines.push(t('report.tookDamage', {
      value: Math.round(damageBySource[s]),
      source: damageSourceLabel(s),
    }));
  }
  if (damageLines.length === 0) damageLines.push(t('report.noDamage'));

  // Most used action
  let mostUsed = '', mostUsedCount = 0;
  for (const [act, n] of Object.entries(actionUsage)) {
    if (n > mostUsedCount) { mostUsedCount = n; mostUsed = act; }
  }
  const mostUsedName = mostUsed
    ? entity('action', mostUsed, GameDatabase.getAction(mostUsed)?.displayName || mostUsed) : t('common.none');
  const mostUsedLine = t('report.mostUsed', { name: mostUsedName, count: mostUsedCount });

  // Older reports predate the equipped-action snapshot.
  const neverUsed = [];
  const equipped = Array.isArray(report.equipped_actions) ? report.equipped_actions : null;
  for (const act of equipped ?? availableActionIds) {
    if (!actionUsage[act] || actionUsage[act] === 0) {
      neverUsed.push(entity('action', act, GameDatabase.getAction(act)?.displayName || act));
    }
  }
  const neverUsedLine = t('report.neverUsed', { names: neverUsed.length > 0 ? neverUsed.join(', ') : t('common.none') });

  // Shield
  let shieldLine = t('report.shieldNever');
  if (shieldActivatedAtHp >= 0) {
    const pct = Math.round(shieldActivatedAtHp * 100);
    shieldLine = pct < 15
      ? t('report.shieldLate', { pct })
      : t('report.shieldAt', { pct });
  }

  const energyLine = t('report.energyOverflow', { seconds: energyOverflowTime.toFixed(1) });
  const endLine = t(timedOut ? 'report.atTimeLimit' : 'report.death', {
    hp: Math.round(deathHp), energy: Math.round(deathEnergy), count: deathNearbyEnemyCount,
  });

  // Suggestions (deterministic with auto-add metadata)
  const suggestions = [];
  
  const offense = ['basic_attack', 'interrupt_shot', 'dash_through', 'drop_mine'];
  if ((timedOut || (equipped && !equipped.some(id => offense.includes(id)))) &&
      hasAction('basic_attack') && hasCondition('enemy_nearby')) {
    suggestions.push({ text: t(timedOut ? 'report.suggestFallbackAttack' : 'report.suggestAttack'),
      rule: { conditionId: 'enemy_nearby', conditionValue: 8, actionId: 'basic_attack', priority: 10 } });
  }
  if (interruptMisses >= 2 && hasCondition('enemy_casting') && hasAction('interrupt_shot')) {
    suggestions.push({
      text: t('report.suggestInterrupt'),
      rule: { conditionId: 'enemy_casting', conditionValue: null, actionId: 'interrupt_shot', priority: 90 }
    });
  }
  if (deathNearbyEnemyCount >= 3 && hasCondition('surrounded') && hasAction('dash_away')) {
    suggestions.push({
      text: t('report.suggestSurrounded'),
      rule: { conditionId: 'surrounded', conditionValue: [4, 3], actionId: 'dash_away', priority: 85 }
    });
  } else if (deathNearbyEnemyCount >= 3 && hasCondition('enemy_nearby') && hasAction('dash_away')) {
    suggestions.push({
      text: t('report.suggestNearby'),
      rule: { conditionId: 'enemy_nearby', conditionValue: 3.5, actionId: 'dash_away', priority: 85 }
    });
  }
  if (shieldActivatedAtHp < 0.15 && (!equipped || equipped.includes('shield'))) {
    suggestions.push({
      text: t('report.shieldThreshold')
    });
  }
  if (energyOverflowTime > 5 && hasCondition('energy_high') && hasAction('overdrive')) {
    suggestions.push({
      text: t('report.suggestEnergy'),
      rule: { conditionId: 'energy_high', conditionValue: 0.8, actionId: 'overdrive', priority: 60 }
    });
  }
  
  if (suggestions.length === 0) {
    suggestions.push({
      text: t('report.reviewRules')
    });
  }

  const outcome = timedOut
    ? t('report.timedOut', { seconds: Math.round(report.battle_time) })
    : sources.length && Number.isFinite(report.battle_time)
      ? t('report.damageSummary', { seconds: report.battle_time.toFixed(1),
        source: damageSourceLabel(sources[0]), amount: Math.round(damageBySource[sources[0]]) })
      : t('report.subtitle');
  return {
    damage_lines: damageLines,
    logic_lines: [mostUsedLine, neverUsedLine, shieldLine, energyLine, endLine],
    suggestions,
    outcome,
  };
}
