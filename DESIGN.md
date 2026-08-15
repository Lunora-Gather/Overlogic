# Overlogic · 设计文档（优化版）

> 2D 俯视角自动战斗策略肉鸽。玩家不操作机器人，而是编辑"逻辑指令"设计机器人大脑，观察其自动战斗，失败后调试逻辑、构筑芯片，击败越来越复杂的敌人。
>
> 本文档基于原始方案进行字段补全、数值统一、状态机工程化、验收 checklist 化的优化。所有核心玩法不变。

---

## 0. 文档约定

- 单位：距离 `m`（地图单位），时间 `s`，伤害 `dmg`，能量 `e`。
- 所有冷却、持续时间为"真实秒"，受战斗速度倍率影响。
- 所有百分比参数在数据层用 `0.0–1.0` 浮点存储，UI 层显示为 `0–100%`。
- 所有 `id` 字段为 snake_case 字符串，全项目唯一。
- 标记 `[扩展]` 的内容 Demo 不实现，但数据结构预留。

---

## 1. 一句话概念与核心体验

**一句话**：玩家不直接操作机器人，而是通过编辑"逻辑指令"设计机器人的战斗大脑。机器人按玩家写好的规则自动战斗。玩家通过观察失败、修改逻辑、优化构筑，击败越来越复杂的敌人。

**核心体验目标**：爽感不来自手速，来自"我设计出来的 AI 变聪明了"。每次失败后玩家应能意识到："我知道哪里有问题了，改一条逻辑就能赢。"

玩家必须感受到的四件事：

1. 我的机器人不是固定 AI，是我亲手设计的大脑。
2. 失败不是惩罚，是调试过程。
3. 每次获得新模块，都能让战斗逻辑产生新可能。
4. 高手玩家能通过复杂逻辑打出漂亮的自动战斗表现。

---

## 2. 游戏类型与关键词

- 类型：2D 俯视角自动战斗策略肉鸽。
- 关键词：自动战斗 / 逻辑编排 / 机器人 AI / 芯片构筑 / 肉鸽成长 / 战斗观察 / 失败复盘 / 高策略上限。

---

## 3. Demo 范围（Vertical Slice）

Demo 必须交付：

| # | 内容 | 数量下限 |
|---|------|---------|
| 1 | 主菜单 | 1 |
| 2 | 逻辑编辑界面 | 1 |
| 3 | 玩家机器人 | 1 |
| 4 | 条件模块 | 5 |
| 5 | 动作模块 | 6 |
| 6 | 普通敌人 | 3 |
| 7 | Boss | 1 |
| 8 | 连续战斗 | 6 |
| 9 | 战斗后奖励选择 | 每场 3 选 1 |
| 10 | 失败复盘界面 | 1 |
| 11 | 可重开一局 | 是 |
| 12 | 基础音效与视觉反馈 | 11 类音效 |

---

## 4. 核心玩法循环

```
MainMenu → LogicEditing → Combat → (Victory?) → RewardSelection → LogicEditing → Combat …
                              ↓
                       (Defeat?) → PostBattleReport → {Edit Logic | Retry Battle | Restart Run}
                              ↓
                       (Final Boss Cleared) → Victory → MainMenu
```

一局完整流程：

1. 主菜单 → 开始游戏
2. 进入逻辑编辑界面 → 配置规则
3. "Run Simulation" → 进入战斗，机器人自动战斗，玩家只能观察/暂停/调速
4. 战斗结束：
   - 胜利 → 奖励界面（3 选 1）→ 回到编辑界面 → 下一场
   - 失败 → 复盘界面 → {重新编辑逻辑 / 重打本场 / 重开整局}
5. 通过 4–5 场普通战斗（路线可包含修复节点）后挑战 Boss `Protocol Warden` 或 `Apex Protocol Warden`
6. Boss 胜利 → Demo 通关 → 回主菜单

**关键约束**：

- 战斗中玩家不可移动机器人、不可改逻辑。
- 战斗中可暂停、可调速（x0.5 / x1 / x2 / x4）。
- 仅战斗结束后可改逻辑。

---

## 5. 核心系统：逻辑规则系统

### 5.1 规则结构

每条规则三部分：`IF 条件 THEN 动作 PRIORITY 优先级`。

示例：

```
IF Enemy Distance < 3      THEN Dash Away      PRIORITY 90
IF HP < 30%                THEN Use Shield     PRIORITY 100
IF Enemy Is Casting        THEN Interrupt Shot PRIORITY 95
IF Energy >= 80%           THEN Use Overdrive  PRIORITY 80
IF Nearest Enemy Exists    THEN Basic Attack   PRIORITY 10
```

### 5.2 Tick 与执行逻辑

机器人每 `0.15s` 检查一次规则（受战斗速度倍率影响）。

伪代码（与原文一致，工程化为可测函数）：

```
function TickLogicBrain(robot, ctx, rules):
    valid = []
    for rule in rules:
        if not rule.enabled: continue
        action = GetAction(rule.actionId)
        if action.IsOnCooldown(robot): continue
        if robot.energy < action.energyCost: continue
        cond = GetCondition(rule.conditionId)
        if cond.Evaluate(robot, ctx, rule.conditionValue):
            valid.append(rule)
    if valid is empty:
        ExecuteDefaultBehavior(robot, ctx)
        return
    valid.sortByPriorityDescending()       # 稳定排序，同优先级按规则添加顺序
    selected = valid[0]
    ExecuteAction(robot, ctx, selected.actionId)
    PushCurrentLogicDisplay(selected)      # 战斗 UI 高亮显示
```

**默认行为**：朝最近敌人缓慢靠近（速度 = `MoveSpeed * 0.6`），若无敌人则原地待机。

**优先级建议区间**（仅引导，不强制）：

| 区间 | 用途 |
|------|------|
| 90–100 | 保命逻辑 |
| 70–89 | 打断、爆发、关键技能 |
| 40–69 | 位移、站位 |
| 10–39 | 普通攻击、默认行为 |

### 5.3 默认起始规则

玩家首次进入游戏自动配置：

| # | Condition | Action | Priority |
|---|-----------|--------|----------|
| 1 | `hp_low` @30% | `shield` | 100 |
| 2 | `enemy_nearby` @2.5m | `dash_away` | 70 |
| 3 | `enemy_nearby` @8m | `basic_attack` | 10 |

后续按教学节点自动追加（见 §10 教学设计）。

---

## 6. 逻辑模块

### 6.1 条件模块（Demo 至少 5 个）

| id | displayName | parameterType | default | min | max | Demo |
|----|-------------|---------------|---------|-----|-----|------|
| `enemy_nearby` | Enemy Nearby | radius(m) | 8 | 1 | 20 | ✅ |
| `enemy_far` | Enemy Far | minDistance(m) | 5 | 2 | 20 | ✅ |
| `hp_low` | HP Low | percent(0–1) | 0.30 | 0.05 | 0.95 | ✅ |
| `energy_high` | Energy High | percent(0–1) | 0.80 | 0.05 | 0.99 | ✅ |
| `enemy_casting` | Enemy Casting | none | — | — | — | ✅ |
| `surrounded` | Surrounded | {radius(m), count} | {4, 3} | — | — | [扩展] |
| `skill_ready` | Skill Ready | actionId | `basic_attack` | — | — | [扩展] |
| `boss_phase` | Boss Phase | phase(int) | 2 | 1 | 4 | ✅ |
| `enemy_hp_low` | Enemy HP Low | percent(0–1) | 0.25 | 0.05 | 0.95 | [扩展] |
| `projectile_nearby` | Projectile Nearby | radius(m) | 2.4 | 0.8 | 8 | ✅ |

**判定语义**（工程化补全）：

- `enemy_nearby`：最近敌人距离 ≤ radius 即成立。
- `enemy_far`：最近敌人距离 ≥ minDistance 即成立（场上无敌人时不成立）。
- `hp_low`：`robot.hp / robot.maxHp ≤ percent`。
- `energy_high`：`robot.energy / robot.maxEnergy ≥ percent`。
- `enemy_casting`：场上任一敌人处于 `Casting`/`Charging` 状态即成立。
- `projectile_nearby`：仅检测正在接近且飞行路径会进入机体附近的敌方弹体。

### 6.2 动作模块（Demo 至少 6 个）

| id | displayName | cooldown(s) | energyCost | range(m) | effectValue | Demo |
|----|-------------|-------------|------------|----------|-------------|------|
| `basic_attack` | Basic Attack | 0.4 | 0 | 8 | dmg=8 | ✅ |
| `dash_toward` | Dash Toward | 3 | 10 | dash=3m | — | ✅ |
| `dash_away` | Dash Away | 3 | 10 | dash=3m | — | ✅ |
| `sidestep` | Evasive Sidestep | 2.5 | 8 | self | dash=2.6m, invuln=0.16s | ✅ |
| `shield` | Shield | 8 | 25 | self | dur=2s, dmgReduce=0.70 | ✅ |
| `interrupt_shot` | Interrupt Shot | 5 | 20 | 8 | dmg=6, interrupts casting | ✅ |
| `overdrive` | Overdrive | 15 | 40 | self | dur=5s, atkSpd+50%, moveSpd+25% | ✅ |
| `repair` | Repair | 12 | 35 | self | heal=25 | [扩展] |
| `drop_mine` | Drop Mine | 6 | 20 | trigger=1.5m, explosion radius=2m | dmg=20 | [扩展] |

**动作执行细则**（工程化补全，避免歧义）：

- **Basic Attack**：选最近敌人，若在 `range` 内发射子弹（子弹速度 `12 m/s`，生命 `2s`），命中造成 `effectValue.dmg`；若不在范围内，执行默认靠近。
- **Dash Toward**：朝最近敌人方向位移 `dash` m，0.15s 内完成，期间无敌（碰撞免伤）。
- **Dash Away**：朝远离最近敌人方向位移 `dash` m；若将撞墙，沿墙切线方向滑动到可行位置。
- **Evasive Sidestep**：根据最近威胁弹体的飞行向量选择横向方向，穿越其弹道并获得短暂无敌。
- **Shield**：开启护盾，持续 `dur` 秒，期间受到伤害 ×`(1 − dmgReduce)`；显示护盾罩特效。
- **Interrupt Shot**：优先瞄准处于 `Casting`/`Charging` 的最近敌人；命中 Casting 敌人立即打断其技能并造成 `dmg`；若无 Casting 敌人则不执行（规则视为不可用，跳过）。
- **Overdrive**：进入超载状态 `dur` 秒；期间攻击冷却 ×`1/1.5`、移动速度 ×`1.25`；期间能量恢复降为 `0`；机器人外观变色。

**子弹参数（统一）**：速度 `12 m/s`，半径 `0.15m`，寿命 `2s`，命中即销毁。

---

## 7. 战斗系统

### 7.1 玩家机器人初始属性

| 属性 | 值 |
|------|----|
| Max HP | 100 |
| Max Energy | 100 |
| Energy Regen | 8 /s |
| Move Speed | 4 m/s |
| Attack Damage | 8 |
| Attack Cooldown | 0.4 s |
| Dash Distance | 3 m |
| Dash Cooldown | 3 s |
| Shield Duration | 2 s |
| Shield Damage Reduction | 70% |
| Shield Cooldown | 8 s |
| Interrupt Shot Cooldown | 5 s |
| Overdrive Cooldown | 15 s |
| Overdrive Duration | 5 s |
| Logic Tick Interval | 0.15 s |
| Body Radius | 0.4 m |

### 7.2 战斗规则

1. 玩家不可直接移动机器人。
2. 玩家仅在战斗前编辑逻辑。
3. 战斗中可暂停、可调速，不可改逻辑。
4. 战斗结束后可调整逻辑。
5. 机器人 HP ≤ 0 → 失败。
6. 场上所有敌人死亡 → 胜利（Boss 战：Boss 死亡即胜利）。

### 7.3 竞技场

- 场地：`20m × 20m` 正方形，电路纹理金属地面，霓虹边界。
- 摄像机：俯视角固定，轻微跟随玩家（不超过 `±3m`），Boss 阶段切换震屏 `0.3s`。
- 玩家出生点：场地中心 `(0,0)`。
- 敌人出生点：场地边缘环形分布，距中心 `8–9m`。

### 7.4 状态机

#### 机器人动作状态

`Idle → Moving → Attacking → Dashing → Shielding → Overdrive → Dead`

任意非 `Dead` 状态可转 `Dead`；`Dashing`/`Shielding`/`Overdrive` 可叠加（Dashing 期间不可再 Dash，Shielding 与 Overdrive 可共存）。

#### 敌人状态

`Idle → Chasing → Attacking → Casting → Charging → Dead`

#### Boss 状态（阶段机）

`Phase1 (100%–65%) → Phase2 (65%–30%) → Phase3 (30%–15%) → Phase4 (15%–0%) → Dead`

---

## 8. 敌人设计

### 8.1 Crawler（基础近战）

| 属性 | 值 |
|------|----|
| HP | 20 |
| Damage | 8 |
| Move Speed | 2.5 m/s |
| Attack Range | 1 m |
| Attack Cooldown | 1.2 s |
| Body Radius | 0.35 m |

**行为**：`Chasing` 持续追玩家 → 距离 ≤ Attack Range 转 `Attacking` → 攻击后回 `Chasing`。无 Casting 状态。

**设计目的**：教学 Dash Away + Basic Attack。

### 8.2 Shooter（远程）

| 属性 | 值 |
|------|----|
| HP | 18 |
| Damage | 6 |
| Move Speed | 2 m/s |
| Attack Range | 6 m |
| Attack Cooldown | 1.5 s |
| Projectile Speed | 8 m/s |
| Body Radius | 0.35 m |

**行为**：`Chasing` 直到距离 ≤ Attack Range → `Attacking` 发射子弹 → 若玩家距离 < 3m 则后退拉开距离。无 Casting 状态。

**设计目的**：教学 Dash Toward 追击远程。

### 8.3 Charger（蓄力冲锋）

| 属性 | 值 |
|------|----|
| HP | 35 |
| Damage | 18 |
| Move Speed | 1.8 m/s |
| Charge Speed | 7 m/s |
| Charge Telegraph | 1.2 s |
| Charge Distance | 6 m |
| Body Radius | 0.4 m |

**行为**：`Chasing` 接近 → 距离 ≤ 5m 转 `Casting`（红色 telegraph 1.2s）→ `Charging` 直线冲锋 `Charge Distance` → 撞墙或冲完回 `Chasing`。`Casting` 期间被 `interrupt_shot` 命中立即回 `Chasing` 并打断。

**设计目的**：教学 Enemy Casting + Interrupt Shot。

### 8.4 Boss：Protocol Warden（协议看守者）

| 属性 | 值 |
|------|----|
| HP | 250 |
| Move Speed | 1.5 m/s |
| Body Radius | 0.8 m |
| Phase 2 触发 | HP ≤ 65% |
| Phase 3 触发 | HP ≤ 30% |
| Phase 4 触发 | HP ≤ 15% |

#### Phase 1（100%–65%）

- 慢速弹幕：每 `1.8s` 向玩家方向发射 3 发扇形子弹（`6 m/s`，每发 `10 dmg`）。
- 近距离震荡波：玩家距离 < 3m 时释放，`0.6s` telegraph 后造成范围 `15 dmg` 并击退。
- 玩家应：保持距离、Basic Attack 输出、低血量开 Shield。

#### Phase 2（65%–30%）

- 每 `8s` 召唤 2 个 Crawler（场上 Crawler 上限 4）。
- 弹幕频率提升至每 `1.3s` 一次。
- 玩家应：被包围 Dash Away、优先清小怪、合理 Overdrive。

#### Phase 3（30%–15%）

- 每 `5s` 进入 `Casting`（telegraph `1.5s`）释放大范围激光：覆盖前方 `8m × 3m` 矩形，命中 `30 dmg`。
- 激光可被 Interrupt Shot 打断。
- 玩家应：Enemy Casting → Interrupt Shot；Interrupt Shot 冷却中 → Shield。

#### Phase 4（15%–0%）

- Boss 围绕竞技场中心高速环绕，每 `0.55s` 释放 6 发环形弹幕（`7 m/s`，每发 `6 dmg`）。
- 进入最终阶段后不再施放激光，重点考验弹幕规避、护盾与能量循环。

**阶段切换反馈**：屏幕震动 `0.3s` + UI 提示 `Protocol Warden: Phase N` + 阶段切换音效。

---

## 9. 关卡设计（10 个战斗内容；每局选择 6 个战斗节点）

| # | 名称 | 敌人组成 | 教学目的 | 解锁/奖励 |
|---|------|----------|----------|-----------|
| 1 | Calibration | 3 × Crawler | 普通攻击 + 后撤 | 胜利后奖励 3 选 1 |
| 2 | Distance Test | 2 × Shooter + 2 × Crawler | 突进远程 | 胜利后奖励 3 选 1 |
| 3 | Charge Warning | 2 × Charger + 2 × Crawler | 打断 | 胜利后奖励 3 选 1 |
| 4 | Swarm | 8 × Crawler + 1 × Shooter | 包围逃脱 | 胜利后奖励 3 选 1 |
| 5 | Shadow Grid | 5 × Shooter + 2 × EMP Drone | 弹幕与 EMP | 胜利后奖励 3 选 1 |
| 6 | Iron Tide | 5 × Charger + 3 × Crawler | 多波冲锋 | 胜利后奖励 3 选 1 |
| 7 | Mixed Protocol | 3 × Crawler + 2 × Shooter + 2 × Charger | 综合 | 胜利后奖励 3 选 1 |
| 8 | Crucible | 6 × Crawler + 3 × EMP Drone + 2 × Charger + 3 × Shooter | 全敌人混合 | 胜利后奖励 3 选 1 |
| 9 | Protocol Warden | Boss | 终局标准路线 | 通关 |
| 10 | Apex Protocol Warden | Apex Boss + 2 × EMP Drone | 终局挑战路线 | 通关 |

每场敌人按数据表分 1–3 波生成（避免一开场全挤在场边）；波间隔 `1.15s`。

---

## 10. 教学设计（逐步解锁）

| 节点 | 解锁内容 | 自动追加规则 |
|------|----------|--------------|
| Battle 1 前 | `enemy_nearby`, `basic_attack`, `dash_away`, `hp_low`, `shield` | Rule 1/2/3（见 §5.3） |
| Battle 1 后 | `enemy_far`, `projectile_nearby`, `hp_above`, `dash_toward`, `sidestep` | 自动追加站位与弹幕规避规则 |
| Battle 2 后 | `battle_time_above`, `enemy_count_high`, `enemy_casting`, `interrupt_shot` | 自动追加蓄力打断规则 |
| Battle 3 后 | `energy_high`, `overdrive` | 自动追加 `IF energy_high @80% THEN overdrive PRIORITY 60` |

> Battle 4 之后不再自动追加教学规则，后续通过奖励模块、协同协议与路线选择扩展构筑。

---

## 11. 肉鸽奖励系统

每场战斗胜利后，从 3 个奖励中选 1。

### 11.1 奖励分类

| 类型 | 说明 | Demo |
|------|------|------|
| New Condition | 解锁新条件模块 | 少量 |
| New Action | 解锁新动作模块 | 少量 |
| Passive Upgrade | 永久属性强化 | 主要 |

### 11.2 奖励池

#### Passive Upgrade（Demo 主要）

| id | displayName | effect |
|----|-------------|--------|
| `pu_max_hp` | Max HP +20 | maxHp += 20 |
| `pu_energy_regen` | Energy Regen +20% | energyRegen ×= 1.2 |
| `pu_basic_dmg` | Basic Attack Damage +25% | basicDmg ×= 1.25 |
| `pu_dash_cd` | Dash Cooldown −20% | dashCd ×= 0.8 |
| `pu_shield_dur` | Shield Duration +1s | shieldDur += 1 |
| `pu_overdrive_dur` | Overdrive Duration +2s | overdriveDur += 2 |
| `pu_interrupt_cd` | Interrupt Shot Cooldown −25% | interruptCd ×= 0.75 |

#### New Condition（Demo 少量）

- `surrounded`（Battle 4 后进池）
- `enemy_hp_low`（Battle 5 后进池）
- `boss_phase`（Battle 6 前进池）

#### New Action（Demo 少量）

- `repair`（Battle 3 后进池）
- `drop_mine`（Battle 4 后进池）

### 11.3 奖励生成规则

- 每场生成 3 个不重复奖励。
- 至少 1 个 Passive Upgrade（保证新手也能变强）。
- 已解锁模块不重复出现。
- 奖励池按战斗进度分段解锁（见上）。

---

## 12. 构筑方向（设计目标，非 Demo 必交付）

| 流派 | 核心逻辑 | 关键模块 |
|------|----------|----------|
| 风筝流 | 敌近则撤、保持中远距、地雷惩罚追击 | dash_away, basic_attack, drop_mine, enemy_nearby, surrounded |
| 突进爆发流 | 见远程突进、能量高 Overdrive、优先低血 | dash_toward, overdrive, enemy_far, enemy_hp_low |
| 防御反击流 | 低血开盾、蓄力打断、盾期提输出 | shield, interrupt_shot, hp_low, enemy_casting |
| 召唤流 [扩展] | 部署无人机、无人机自动攻击、逻辑控制目标 | deploy_drone, drone_active, target_priority |

---

## 13. UI 设计

### 13.1 主菜单

```
Overlogic
Start Simulation
Settings
Exit
```

### 13.2 逻辑编辑界面（LogicEditor）

布局：

```
┌─ 顶部：当前关卡信息 + 敌人预览 ────────────────────────────┐
├─ 左侧：Available Conditions ─┬─ 中间：Active Rules ─┬─ 右侧：Available Actions ─┤
│                              │ [P100] IF HP<30%     │                          │
│  • Enemy Nearby              │      THEN Shield     │  • Basic Attack  cd0.4   │
│  • Enemy Far                 │                      │  • Dash Toward  cd3 e10  │
│  • HP Low                    │ [P70]  IF Nearby 2.5 │  • Dash Away    cd3 e10  │
│  • Energy High               │      THEN Dash Away  │  • Shield       cd8 e25  │
│  • Enemy Casting             │                      │  • Interrupt    cd5 e20  │
│                              │ [P10]  IF Nearby 8   │  • Overdrive   cd15 e40  │
│                              │      THEN Basic Atk  │                          │
├──────────────────────────────┴──────────────────────┴──────────────────────────┤
│ 底部：Unit Stats (HP/Energy/Speed/DMG…)            [Run Simulation]            │
└────────────────────────────────────────────────────────────────────────────────┘
```

每条规则显示：`[P{priority}] IF {condition} {value} THEN {action}`

操作：Add Rule / Delete Rule / 调整 Priority / 修改条件参数 / 更换动作 / 查看动作冷却与能耗。

Demo 用按钮 + 下拉菜单实现，不要求拖拽。

### 13.3 战斗界面（BattleHUD）

显示：

1. 玩家 HP 条
2. 玩家 Energy 条
3. **Current Logic**（当前执行规则，单行高亮，规则切换时短闪 `0.2s`）
4. 当前各动作冷却图标
5. 敌人血条（Boss 顶部大血条）
6. 战斗计时
7. Pause 按钮
8. Speed x0.5 / x1 / x2 / x4 按钮
9. Wave 信息（`Wave 1/2`）
10. Overlogic 值条（见 §15）

**Current Logic 示例**：
```
Current Logic: IF Enemy Casting THEN Interrupt Shot
```

### 13.4 奖励界面（RewardScreen）

```
Protocol Upgrade
Choose One

[ New Condition: Surrounded ]   [ New Action: Repair ]   [ Passive: Max HP +20 ]
```

### 13.5 失败复盘界面（PostBattleReport）

```
Simulation Failed

Damage Report:
- Took 64 dmg from Charger        (top damage source)
- Took 22 dmg from Crawler
- Took 12 dmg from Shooter

Logic Report:
- Most used action: Basic Attack (×42)
- Interrupt Shot: never used
- Shield: used 1 time, activated at 8% HP (too late)
- Energy overflowed for 12.4s total

Suggested Fix:
- Add IF Enemy Casting THEN Interrupt Shot
- Raise priority of defensive rules
- Add Dash Away when surrounded

[ Retry Battle ]   [ Edit Logic ]   [ Restart Run ]
```

### 13.6 胜利界面

```
Simulation Complete
Your Logic Survived
[ Return to Menu ]
```

---

## 14. 失败复盘系统（工程化）

### 14.1 战斗中需记录的统计

| 字段 | 类型 | 说明 |
|------|------|------|
| `damageByEnemyType` | `Map<enemyType, float>` | 每种敌人造成的总伤害 |
| `actionUsageCount` | `Map<actionId, int>` | 每个动作执行次数 |
| `actionLastUsedTime` | `Map<actionId, float>` | 每个动作最后使用时间 |
| `shieldActivatedAtHp` | `float` | Shield 激活时 HP 百分比 |
| `energyOverflowTime` | `float` | 能量满后继续恢复的累计秒数 |
| `deathHp` / `deathEnergy` / `deathNearbyEnemyCount` | `float/float/int` | 死亡瞬间状态 |
| `interruptSuccessCount` | `int` | 打断成功次数 |
| `interruptMissedCount` | `int` | Casting 发生但未打断次数 |

### 14.2 报告生成规则（确定性，可测）

1. Top damage source = `damageByEnemyType` 最大值。
2. Never used actions = `actionUsageCount` 中为 0 且玩家已解锁的动作。
3. Shield too late = `shieldActivatedAtHp < 0.15` 时提示。
4. Energy overflow = `energyOverflowTime > 5s` 时提示。
5. Missing interrupt = `interruptMissedCount ≥ 2` 时建议加 `enemy_casting → interrupt_shot`。

### 14.3 建议模板（确定性拼接，不写自然语言生成）

- 若 `interruptMissedCount ≥ 2` → `Add IF Enemy Casting THEN Interrupt Shot`
- 若 `deathNearbyEnemyCount ≥ 3` → `Add IF Surrounded THEN Dash Away`
- 若 `shieldActivatedAtHp < 0.15` 或 Shield 从未使用 → `Raise priority of defensive rules`
- 若 `energyOverflowTime > 5s` → `Add IF Energy High THEN Overdrive`

---

## 15. Overlogic 值（高风险爆发机制）

### 15.1 数值

- 范围 `0–100`，初始 `0`，战斗结束后清零。
- UI 显示为 CPU 温度条；达阈值 `≥85` 时进入 `Overlogic Active`。

### 15.2 增加规则（Demo）

| 事件 | 增量 |
|------|------|
| 连续快速切换规则（0.5s 内 ≥3 条不同规则触发） | +12 |
| 使用 Overdrive | +18 |
| 精准打断技能成功 | +8 |
| 血量 < 20% 时击杀敌人（反杀） | +12 |
| 短时间（1s 内）多条规则连续触发 | +5 |

### 15.3 阈值效果

达 `≥85` 进入 `Overlogic Active`（持续至值回落 `≤35`）：

- 攻击与技能冷却 ×`0.5`
- 弹体与地雷伤害 ×`1.5`
- 每秒承受最大生命 `5%` 的过热伤害
- UI 出现视觉扰动（扫描线、轻微色偏）
- Current Logic 显示变为 `Overlogic Active: {rule}`

### 15.4 衰减

战斗中每秒自然衰减 `−3`；激活后每秒衰减 `−9`，形成可预测的短爆发窗口；脱战时衰减 `−10/s`。

### 15.5 失控代价

过热伤害迫使玩家在爆发效率与机体安全之间权衡；热能回收协议可通过持续执行规则主动降温。

---

## 16. 视觉与音效

### 16.1 视觉

- 风格：2D 俯视角科幻机械竞技场，冷酷干净精密。
- 背景：深色电路纹理金属地面 + 霓虹边界。
- 玩家机器人：蓝白色。
- 敌人警告：红橙色。
- 能量特效：绿/青色。
- 反馈：技能释放有明显特效；Dash 残影/速度线；Shield 罩子；Interrupt 命中 Casting 敌人清晰反馈；Overdrive 期间机器人变色；命中轻微震屏；Boss 阶段切换明显震屏。

### 16.2 音效（11 类，Demo 必备）

| # | 事件 | 用途 |
|---|------|------|
| 1 | button_click | UI 点击 |
| 2 | rule_add | 规则添加 |
| 3 | battle_start | 战斗开始 |
| 4 | basic_attack | 普通攻击 |
| 5 | shield_on | 护盾开启 |
| 6 | dash | 冲刺 |
| 7 | interrupt_success | 打断成功 |
| 8 | enemy_death | 敌人死亡 |
| 9 | boss_phase | Boss 阶段切换 |
| 10 | defeat | 失败 |
| 11 | victory | 胜利 |

音乐方向：主菜单冷静电子神秘 / 编辑界面低强度合成器 / 战斗节奏更强电子 / Boss 压迫工业电子。Demo 可用临时音效，代码结构（`AudioManager`）便于替换。

---

## 17. 数据结构（统一字段规范）

### 17.1 ConditionModule

```json
{
  "id": "enemy_nearby",
  "displayName": "Enemy Nearby",
  "description": "A nearby enemy exists within radius.",
  "parameterType": "float",
  "defaultValue": 8.0,
  "minValue": 1.0,
  "maxValue": 20.0
}
```

`parameterType` ∈ `{none, float, percent, int, actionId, vec2}`。

### 17.2 ActionModule

```json
{
  "id": "basic_attack",
  "displayName": "Basic Attack",
  "description": "Fire a bullet at the nearest enemy.",
  "cooldown": 0.4,
  "energyCost": 0,
  "range": 8.0,
  "effectValue": { "dmg": 8 }
}
```

### 17.3 LogicRule

```json
{
  "id": "rule_1",
  "conditionId": "hp_low",
  "conditionValue": 0.30,
  "actionId": "shield",
  "priority": 100,
  "enabled": true
}
```

### 17.4 EnemyData

```json
{
  "id": "crawler",
  "displayName": "Crawler",
  "maxHp": 20,
  "moveSpeed": 2.5,
  "damage": 8,
  "attackRange": 1.0,
  "attackCooldown": 1.2,
  "behaviorType": "melee_chase"
}
```

`behaviorType` ∈ `{melee_chase, ranged_keep_distance, charge_caster, boss_warden}`。

### 17.5 BattleData

```json
{
  "id": "battle_1",
  "displayName": "Calibration",
  "enemySpawns": [
    { "enemyId": "crawler", "count": 3, "wave": 1 }
  ],
  "rewardPool": ["pu_max_hp", "pu_basic_dmg", "pu_dash_cd"],
  "arenaType": "standard_20x20"
}
```

### 17.6 RewardData

```json
{
  "id": "pu_max_hp",
  "displayName": "Max HP +20",
  "rewardType": "passive",
  "targetId": "max_hp",
  "value": 20
}
```

`rewardType` ∈ `{new_condition, new_action, passive}`。

---

## 18. 代码架构

### 18.1 类职责

| 类 | 职责 |
|----|------|
| `GameManager` | 全局状态机：MainMenu / LogicEditing / Combat / RewardSelection / PostBattleReport / Victory |
| `GameState` | 一局流程状态：战斗进度、奖励累积、失败重开、存档与迁移 |
| `BattleContext` | 战斗中共享上下文：所有敌人、子弹、地雷、时间、统计 |
| `LogicBrain` | 读取玩家规则，Tick 判断应执行动作 |
| `ConditionEvaluator` | 条件判定（按 conditionId 分派） |
| `ActionExecutor` | 动作执行（按 actionId 分派） |
| `RobotController` | 玩家机器人：移动、攻击、受伤、能量、冷却、状态机 |
| `RobotStats` | 机器人属性（含被动强化累积） |
| `EnemyBase` | 敌人基类：状态机、HP、移动、受伤 |
| `CrawlerEnemy` / `ShooterEnemy` / `ChargerEnemy` | 三种普通敌人 |
| `BossProtocolWarden` | Protocol Warden 四阶段与阶段技能 |
| `Projectile` | 子弹：移动、命中、销毁 |
| `CombatArena` | 生成敌人、竞技场边界、波次、碰撞与战斗循环 |
| `RewardManager` | 奖励生成、解锁分段、应用 |
| `CombatStatsTracker` | 战斗统计记录（供复盘） |
| `PostBattleReportBuilder` | 复盘报告生成（确定性） |
| `LogicEditorUI` | 逻辑编辑界面 |
| `BattleHUD` | 战斗界面 |
| `RewardUI` | 奖励界面 |
| `PostBattleReportUI` | 复盘界面 |
| `AudioManager` | 音效音乐管理 |
| `OverlogicSystem` | Overlogic 值计算与效果 |
| `GameDatabase` | 加载并校验 `data/*.json`，向运行时提供统一内容契约 |
| `ProtocolSynergies` / `RunModifiers` | 协同协议与难度/路线修正 |
| `RunHistory` / `RunArchive` / `ProfileProgression` / `LiveChallenges` | 本地战斗记录、完整通关档案、个人最佳、等级、成就、每日目标与可迁移的运营数据骨架；默认不向外发送遥测 |

### 18.2 主状态机

```
MainMenu → LogicEditing → Combat → RewardSelection → LogicEditing …
                              ↓
                        PostBattleReport → {LogicEditing | Combat(retry) | MainMenu(restart)}
                              ↓
                          Victory → MainMenu
```

### 18.3 文件结构（Web / ES Modules）

```
Overlogic/
  index.html / style.css      # 应用壳层与响应式视觉系统
  manifest.webmanifest        # 可安装 Web App 元数据
  sw.js / icon.svg            # 版本化离线缓存、应用图标
  data/                       # 条件、动作、敌人、战斗、奖励内容
  src/
    core/                     # GameManager、GameState、CombatArena、BattleContext、GameDatabase
    logic/                    # LogicBrain、LogicRule、ConditionEvaluator、ActionExecutor
    robot/                    # RobotController、RobotStats
    enemies/                  # EnemyBase、普通敌人、BossProtocolWarden
    render/                   # ArenaRenderer、Camera
    vfx/                      # Projectile、Mine、HazardTile、ParticleSystem
    systems/                  # 奖励、协同协议、统计、报告、音频、战斗/通关记录、档案与每日目标
    ui/                       # 主菜单、编辑器、HUD、奖励、报告与胜利界面
    i18n/                     # 简体中文、繁體中文、English 文案
  scripts/                    # serve、build、verify、balance
  DESIGN.md / README.md       # 设计约束、架构说明与发布指引
```

发布层约束：`scripts/build.mjs` 只将上述运行时文件复制到 `dist/`，并为模块、数据、HTML 与 Service Worker 注入提交版本。Service Worker 只处理同源 GET 请求，导航使用 network-first，静态资源使用 stale-while-revalidate；任何离线能力都不能阻塞首屏启动。`GameDatabase` 的数据契约校验与 `scripts/release-audit.mjs` 必须在发布前通过。

---

## 19. MVP 开发里程碑

| 步骤 | 内容 | 验收 |
|------|------|------|
| 1 | 基础战斗场景：竞技场 + 玩家 + 敌人生成 + 自动寻敌 + 敌人攻击 + 胜负判断 | 机器人死亡=失败，敌人全灭=胜利 |
| 2 | 逻辑规则系统：Rule 数据 + Condition 判定 + Action 执行 + Priority 排序 + 当前规则显示 | 改规则→机器人行为明显改变 |
| 3 | 逻辑编辑 UI：规则列表 + 增删 + 改优先级 + 改条件参数 + 开始战斗按钮 | 不写代码即可配置机器人行为 |
| 4 | 敌人类型：Crawler / Shooter / Charger | 三种行为明显不同，需不同逻辑应对 |
| 5 | 奖励系统：胜利后 3 选 1，奖励影响后续战斗 | 每场后构筑变强或产生新策略 |
| 6 | Boss：Protocol Warden 四阶段 + 血量切换 + 通关 | Boss 逼迫玩家综合使用前述逻辑 |
| 7 | 复盘系统：失败原因 + 伤害来源 + 最常用动作 + 建议 | 玩家失败后能知道如何调整逻辑 |
| 8 | 表现增强：粒子 + 音效 + UI 动画 + 震屏 + 阶段提示 + 开始/胜利反馈 | 基本完成度，不像纯测试项目 |

**里程碑依赖**：1 → 2 → 3 → 4 → 5 → 6 → 7 → 8。步骤 8 可穿插在 4–7 中逐步做。

---

## 20. 平衡原则

难度来自：敌人行为差异 / 玩家逻辑合理性 / 技能冷却冲突 / 能量管理 / 多条件同时成立时的优先级选择。

**禁止**：敌人血量无限变厚 / 子弹速度过快无法理解 / Boss 随机秒杀。

**正确示例**：

- Charger 蓄力明显，没写打断逻辑就吃大伤害。
- Shooter 拉开距离，需突进逻辑。
- Swarm 包围，需逃脱逻辑。
- Boss Phase 3 强迫处理打断与防御优先级。

---

## 21. 世界观与文本风格

**设定**：人类消失后的自动化战争时代，所有战斗单位由逻辑协议驱动。玩家是被唤醒的旧时代工程核心，通过修改机器人行为逻辑，在失控战争系统中寻找最终协议。

**Overlogic**：一种超出原本限制的逻辑状态。机器人被写入过多互相冲突、强化的规则时，可能突破预设行为边界，产生接近自我意识的战斗判断。

**主线悬念**：玩家以为在控制机器人，但随着推进，机器人开始记录玩家的逻辑偏好，并在某些情况下预测玩家会写什么规则。

**文本风格**：短、冷、科技感强、克制。示例：

- `Simulation Ready`
- `Logic Chain Updated`
- `Directive Conflict Detected`
- `Combat Unit Online`
- `Overlogic Threshold Rising`
- `Protocol Warden Awakened`
- `Your logic survived`
- `Your logic failed`
- `The machine learned from you`

---

## 22. 可扩展系统（已实现与后续方向）

已实现：高级条件组合 AND / OR、每场战斗时间轴复盘、每日种子、Veteran 难度、沙盒场景、构筑代码导入/导出。

后续方向：

1. 多机器人小队
2. 规则链条与逻辑冲突系统（`Directive Conflict Detected`）
3. 敌人弱点识别
4. 无人机流派与玩家自定义机器人外观
5. 日志回放系统
6. 创意工坊与在线构筑分享
7. B 面高难挑战与无限模式

**Overlogic 失控（预留）**：冲突越多 Overlogic 越高 → 爆发提升 → 过高则短暂失控（忽略低优先级规则）。Demo 仅正向，`OverlogicValue` 字段与失控挂钩点预留。

---

## 23. 验收 Checklist

- [x] 玩家可进入游戏。
- [x] 玩家可编辑逻辑规则。
- [x] 机器人按规则自动战斗。
- [x] 修改规则明显影响战斗结果。
- [x] ≥3 种普通敌人。
- [x] ≥1 个 Boss。
- [x] ≥6 场战斗。
- [x] 战斗胜利后可选奖励。
- [x] 失败后有复盘信息。
- [x] 游戏可完整通关一次。
- [x] 核心系统代码结构清晰、可扩展。
- [x] 无导致游戏无法运行的 TODO。
- [x] 不是 UI 假界面，有真实战斗逻辑。
- [x] 玩家不可直接控制机器人移动。
- [x] 标题显示为 `Overlogic`。
- [x] 战斗中显示 Current Logic。
- [x] 失败复盘含伤害来源、最常用动作、建议。
- [x] 11 类音效到位。
- [x] 教学逐步解锁（4 个节点）。
- [x] Overlogic 值条显示，达阈值有效果。

---

## 24. 最高优先级（取舍时不可妥协）

1. **逻辑编辑真的能改变机器人行为。**
2. **战斗失败后玩家能理解该如何调整。**
3. **机器人自动战斗看起来足够清晰、聪明、有反馈。**

---

## 25. 禁止清单

1. 不做平台跳跃。
2. 不做开放世界。
3. 不做复杂剧情演出。
4. 不做大量装备数值堆叠。
5. 不让玩家手动操作机器人移动。
6. 不做成普通塔防。
7. 不做成纯编程教学游戏。
8. 不让 UI 复杂到玩家看不懂。
9. 不只做概念没有可玩战斗。
10. 不牺牲核心逻辑系统去做装饰内容。

---

## 26. 最终目标

做出小而精的《Overlogic》Demo。让玩家在 10 分钟内理解："我不是在操作机器人，我是在设计机器人的大脑。"让玩家在失败后自然产生："我再改一条规则肯定能过。"

这就是《Overlogic》的核心。

---

## 27. 协议协同与战斗时间轴

构筑协同由 `src/systems/ProtocolSynergies.js` 统一推导。界面预览与战斗效果必须查询该模块，不得分别复制激活条件。

1. **堡垒循环：**反射装甲 + 护盾持续时间升级。额外获得 25% 反射。
2. **动能突破：**重击 + 穿越冲刺。穿越冲刺获得 50% 伤害加成和短暂眩晕。
3. **凤凰网络：**紧急召回 + 纳米修复。召回恢复 45 生命，低血量纳米修复翻倍。
4. **热能电网：**超导体 + 热能回收。熔毁期间回收热量时额外恢复 4 点能量。

失败报告保存有上限且经过合并的关键事件时间轴。时间轴仅用于诊断，不得影响确定性战斗模拟。

## 28. 每日目标与运营边界

`src/systems/LiveChallenges.js` 为正式战斗提供三类每日目标：胜场、累计伤害与 Boss 击破。目标按 UTC 日期确定性轮换档位，同一天离线玩家得到相同目标；目标状态、完成时间、连续完成天数与奖励可随完整存档迁移。页面跨过 UTC 零点时只安排一次定时刷新，不使用高频轮询。

- 沙盒、调试和演示战斗不得推进目标、XP、成就或正式战斗记录。
- 目标完成奖励只在首次完成时发放，重复刷新页面或重复导入备份不得重复结算。
- 连续完成天数只在当天三项目标全部完成时结算；漏掉任意完整自然日后，下一次完成会从 1 天重新开始，并仅保留最近 30 个完成日期。
- 若浏览器存储失败，目标完成状态不会发放 XP；这样刷新后不会出现重复领取，设置页仍可导出支援诊断包。
- 当前实现只在本地保存，不上传行为数据；未来接入账号、赛季或排行榜时，必须在明确同意后再发送最小化的归一化记录。

## 29. 通关档案与事务化存档

`src/systems/RunArchive.js` 保存最近 40 次完整通关，字段限制为运行 ID、完成时间、模式、难度、种子、胜场、总伤害、总战斗时间、最终生命、规则数与升级数。运行 ID 在新开流程时生成，同一流程无论胜利界面重复显示、跨标签同步或异常重试，都只能结算一次。

- 主菜单展示完整通关次数和个人最佳；胜利页展示当前累计通关与最佳时间。
- 完整备份包含通关档案。导入任一步骤失败时，主存档、设置、配置栏、战斗历史、档案、每日目标与通关记录必须整体回滚。
- “重置进度”必须同时清除运行、配置栏、战斗历史、档案、每日目标与通关记录，但保留语言、音量和无障碍设置。
- 通关档案不包含规则内容、自由文本或设备标识；未来上传排行榜必须继续采用明确同意和最小数据原则。
