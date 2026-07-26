// ConditionEvaluator.js — stateless evaluator. evaluate(robot, ctx, rule) -> bool.
// Supports AND / OR compound conditions.
// Mirrors scripts/logic/ConditionEvaluator.gd.

export class ConditionEvaluator {
  evaluate(robot, ctx, rule) {
    const raw1 = this.evaluateSingle(robot, ctx, rule.conditionId, rule.conditionValue);
    const cond1 = rule.negateCondition1 ? !raw1 : raw1;
    if (rule.operator === 'and' && rule.conditionId2) {
      const raw2 = this.evaluateSingle(robot, ctx, rule.conditionId2, rule.conditionValue2);
      const cond2 = rule.negateCondition2 ? !raw2 : raw2;
      return cond1 && cond2;
    }
    if (rule.operator === 'or' && rule.conditionId2) {
      const raw2 = this.evaluateSingle(robot, ctx, rule.conditionId2, rule.conditionValue2);
      const cond2 = rule.negateCondition2 ? !raw2 : raw2;
      return cond1 || cond2;
    }
    return cond1;
  }

  evaluateSingle(robot, ctx, condId, val) {
    switch (condId) {
      case 'enemy_nearby': {
        const r = +val;
        return ctx.nearestEnemyDistance({ x: robot.x, y: robot.y }) <= r;
      }
      case 'enemy_far': {
        const d = +val;
        const nd = ctx.nearestEnemyDistance({ x: robot.x, y: robot.y });
        return Number.isFinite(nd) && nd >= d;
      }
      case 'projectile_nearby': {
        const radius = +val;
        return ctx.nearestHostileProjectileDistance({ x: robot.x, y: robot.y }) <= radius;
      }
      case 'hp_low': {
        const p = +val;
        return robot.hp / robot.maxHp <= p;
      }
      case 'hp_above': {
        const p = +val;
        return robot.hp / robot.maxHp >= p;
      }
      case 'energy_high': {
        const p = +val;
        return robot.energy / robot.maxEnergy >= p;
      }
      case 'energy_low': {
        const p = +val;
        return robot.energy / robot.maxEnergy <= p;
      }
      case 'battle_time_above':
        return ctx.time >= +val;
      case 'enemy_count_high':
        return ctx.liveEnemies() >= (val | 0);
      case 'enemy_casting':
        return ctx.anyEnemyCasting();
      case 'surrounded': {
        if (!Array.isArray(val) || val.length < 2) return false;
        const radius = +val[0], count = val[1] | 0;
        return ctx.countEnemiesWithin({ x: robot.x, y: robot.y }, radius) >= count;
      }
      case 'enemy_hp_low': {
        const e = ctx.nearestEnemyTo({ x: robot.x, y: robot.y });
        if (!e) return false;
        const p = +val;
        return e.hp / e.maxHp <= p;
      }
      case 'boss_phase': {
        if (!ctx.boss || ctx.boss.dead) return false;
        return ctx.boss.currentPhase === (val | 0);
      }
      case 'on_hazard':
        return ctx.isRobotOnHazard();
      case 'shield_active':
        return robot.shieldActive === true;
      case 'overdrive_ready': {
        // True if overdrive is NOT on cooldown and robot has >= 40 energy
        if (robot.energy < 40) return false;
        // Check via executor stored in ctx if possible
        const executor = ctx.executor;
        if (executor) return !executor.isOnCooldown('overdrive');
        return true;
      }
      case 'enemy_count_low': {
        const n = val | 0;
        return ctx.liveEnemies() <= n;
      }
      default:
        return false;
    }
  }
}
