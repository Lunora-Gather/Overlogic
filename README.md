<div align="center">

# OVERLOGIC

### 设计机器人的大脑，而不是操控它的双手。

Program the brain. Observe the battle. Debug the logic.

[![Verify and Deploy](https://img.shields.io/github/actions/workflow/status/Lunora-Gather/Overlogic/verify.yml?branch=main&label=verify%20%26%20deploy&style=flat-square)](https://github.com/Lunora-Gather/Overlogic/actions/workflows/verify.yml)
[![License: MIT](https://img.shields.io/github/license/Lunora-Gather/Overlogic?style=flat-square)](LICENSE)
[![Playable Demo](https://img.shields.io/badge/status-playable%20web%20demo-39e6a0?style=flat-square)](https://lunora-gather.github.io/Overlogic/)
[![Languages](https://img.shields.io/badge/languages-简中%20%7C%20繁中%20%7C%20EN-62d9ff?style=flat-square)](#语言)

**[▶ 立即游玩 / Play Online](https://lunora-gather.github.io/Overlogic/)**

[简体中文](#简体中文) · [繁體中文](#繁體中文) · [English](#english) · [设计文档](DESIGN.md) · [运营手册](OPERATIONS.md)

</div>

---

## 简体中文

《Overlogic》是一款 2D 俯视角自动战斗策略 Roguelite。你不直接操作机器人移动或攻击，而是为它编写具有优先级的 `如果条件成立 → 执行动作` 规则，让机器人依据你的逻辑自主战斗。

失败不是终点，而是一份调试报告：观察机器人执行了什么、为什么跳过其他规则、伤害从哪里产生，然后修改逻辑再次运行。

### 核心循环

```text
编写规则 → 选择路线 → 运行战斗 → 阅读诊断 → 获得升级 → 重构逻辑
```

### 为什么值得玩

- **真正影响战斗的逻辑编程**：组合 `AND`、`OR`、`NOT`、优先级与目标选择。
- **可解释的自动战斗**：实时高亮执行规则，并显示冷却、能量不足、条件不成立等诊断状态。
- **会反制构筑的敌人**：维修无人机会公开蓄力、恢复受损单位；护盾中继会公开蓄力并为目标提供短时减伤；玩家可以编写“存在支援单位 → 优先锁定支援”的规则，或在蓄力窗口打断它们；失败报告会显示敌方维修与护盾遥测。
- **以失败推动学习**：伤害分析、动作频率、规则使用率、关键事件时间轴和自动修复建议共同解释失败原因。
- **具有构筑方向的奖励**：动作、条件、被动升级与四套协议协同会改变战斗机制，而不只是提高数值。
- **可复用的构筑模板**：包含支援集火模板，自动组合支援锁定、蓄力打断、防御和基础攻击，锁定模块会安全跳过。
- **可重复挑战**：分支路线、持续生命值、危险区域、双 Boss 门、首领后升阶分支、奇点核心终局、每日种子、每周挑战与多种难度。
- **每日目标与长期成长**：每天刷新胜场、伤害和 Boss 目标，完成目标获得 XP 并累积连续完成天数；进度可随完整备份迁移。
- **操作员档案与本地榜单**：查看等级、胜率、每日/每周战绩、全部成就，并在分模式、分难度筛选后比较本设备上的前五名运行收据。
- **每日战术协议**：每日种子同时决定一条公开的战斗变体（信号涌动、玻璃回路或强化中继），在敌方节奏、机体速度与能量恢复之间制造可解释的策略取舍；标准模式不受影响。
- **每周挑战**：UTC ISO 周种子决定一条更强的共享战役协议（追猎矩阵、攻城中继或易变网格），适合玩家在一周内反复优化同一套规则并分享挑战码；历史周挑战仍可复现。
- **可验证的个人纪录**：每次完整通关只结算一次，保存模式、难度、种子、总时间、伤害、规则数、模拟版本和固定步长，为未来排行榜提供规范数据。
- **随时验证逻辑**：混合、弹幕、虫群、支援和 Boss 五种沙盒场景，不消耗正式流程进度。
- **跨设备体验**：支持桌面与移动布局、触控排序、键盘操作、减少动态效果及镜头震动设置。
- **三语界面**：完整支持简体中文、繁体中文和英文。
- **隐私优先诊断**：可选择在本地记录白名单试玩事件；默认关闭、永不自动上传，关闭后立即清空。

### 一条规则能做什么

```text
优先级 90：如果 敌人正在蓄力 → 打断射击（目标：施法单位）
优先级 85：如果 存在支援单位 → 基础攻击（目标：支援单位）
优先级 80：如果 来袭弹体接近 → 规避侧闪
优先级 70：如果 敌人在附近 AND 生命值较低 → 后撤冲刺
优先级 10：如果 敌人在攻击范围 → 基础攻击
```

机器人每 0.15 秒重新评估规则，并执行当前优先级最高且有效的动作。

### 操作

| 场景 | 操作 |
|---|---|
| 规则编辑 | 点击模块、编辑参数、拖动排序或调整优先级 |
| 暂停 / 继续 | `P` |
| 暂停时单步执行 | `.` |
| 切换模拟速度 | `S` |
| 撤销 / 重做 | `Ctrl + Z` / `Ctrl + Y` |
| 快速保存配置 | `Ctrl + S` |

规则配置保存在浏览器本地，也可以生成版本化分享代码进行导入和导出。

每局都会生成可复现的运行种子。主菜单支持输入数字种子或 `OLR1-STANDARD-VETERAN-…`、`OLR1-WEEKLY-STANDARD-…` 等挑战码；每日和每周模式会公开固定周期种子与协议，历史周期仍可通过代码复现。正式战斗使用固定 1/60 秒模拟步长，渲染刷新率不会改变核心战斗时序；运行收据会记录模拟版本和步长。战斗结束后，最近战斗、完整通关纪录、个人最佳、操作员等级、XP 与成就进度会保存在本地。设置中的存档工具可以导出包含规则、设置、配置栏、战斗记录、通关档案和操作员档案的完整 JSON 备份；新备份带有完整性摘要，导入过程会先验摘要再按事务回滚，不会留下半套数据。

胜利结果会先写入存档，再进入奖励页；如果在奖励选择前刷新页面，主菜单会显示“继续领取奖励”，只结算一次，不会重打已胜战斗或重复累计进度。

支援包仅在玩家主动下载时生成，包含当前版本、运营清单、存档状态、启动耗时、长帧统计、最近的受限错误摘要，以及玩家明确开启后的本地产品指标摘要；这些信息不会自动上传。产品指标默认关闭，只记录白名单事件和粗粒度属性，不包含规则代码、挑战种子或身份数据，关闭时会立即删除。

---

## 繁體中文

《Overlogic》是一款 2D 俯視角自動戰鬥策略 Roguelite。玩家不直接控制機器人，而是編寫具有優先級的 `如果條件成立 → 執行動作` 規則，觀察戰鬥結果並持續偵錯。

主要特色：

- 使用 `AND`、`OR`、`NOT`、優先級和目標選擇建立戰鬥邏輯。
- 即時顯示規則執行、冷卻、能量與條件診斷。
- 透過傷害報告、關鍵時間軸和規則建議理解失敗原因。
- 分支路線、每日種子、每週挑戰、多種難度、沙盒測試與機制型協定協同。
- 保存每日目標連續天數、完整通關紀錄與個人最佳，並可隨完整備份遷移。
- 完整支援繁體中文、簡體中文、英文及行動裝置版面。

**[▶ 開始線上模擬](https://lunora-gather.github.io/Overlogic/)**

---

## English

Overlogic is a 2D top-down auto-combat strategy roguelite. You do not steer the robot by reflexes. You program its combat brain with prioritized `IF condition → THEN action` rules, run the simulation, study the diagnostics, and refine the stack.

### Core loop

```text
Program rules → Choose a route → Run combat → Read diagnostics → Upgrade → Refactor
```

### Highlights

- Compose combat logic with `AND`, `OR`, `NOT`, priorities, and target selection.
- See the active rule and every blocked state in real time.
- Debug defeats through damage analysis, rule usage, action frequency, a critical-event timeline, and contextual fixes.
- Detect and explicitly prioritize Repair Drones and Shield Relays, or interrupt their casting windows before they restore or protect enemy hull; failed-run reports expose both support telemetry.
- Build around actions, conditions, passive upgrades, and four mechanic-changing protocol synergies.
- Start from curated build templates, including a support-focus protocol that safely skips modules you have not unlocked yet.
- Explore branching routes, persistent hull damage, hazards, daily seeds, weekly gauntlets, multiple difficulties, a post-boss ascension branch, and the Singularity Core finale.
- Test logic safely in mixed, projectile, swarm, support, and boss sandbox scenarios.
- Play in English, Simplified Chinese, or Traditional Chinese on desktop and mobile layouts.
- Reproduce a run with a numeric seed or an `OLR1-…` challenge code, then review recent battle history and operator progression locally.
- Complete three deterministic daily objectives for bonus XP and build a completion streak; sandbox runs never advance formal progression.
- Daily runs reveal one deterministic tactical protocol for the seed, while Weekly Gauntlet runs rotate a stronger shared protocol for the ISO week; standard runs remain unchanged.
- Keep a deduplicated local archive of completed campaigns and personal-best times, ready for a future opt-in leaderboard.
- Review a full operator dossier with rank progress, achievements, career statistics, and a receipt-backed top-five local leaderboard.
- Export and restore a verified full save backup, including settings, loadouts, battle history, and profile achievements.
- Resume a persisted win safely after a refresh: pending rewards are settled once instead of replaying the cleared battle.
- Download a privacy-safe support bundle with bounded runtime diagnostics; diagnostics stay in memory and are never uploaded automatically.
- Optionally keep a bounded, whitelisted product-metrics log in the current browser; it is disabled by default, never auto-uploaded, and deleted when switched off.

**[▶ Play the live demo](https://lunora-gather.github.io/Overlogic/)**

---

## 本地运行 / Run locally

要求：Node.js 24（与持续集成环境一致）。项目没有第三方运行时依赖，无需执行 `npm install`。

```bash
git clone https://github.com/Lunora-Gather/Overlogic.git
cd Overlogic
npm run serve
```

然后访问 [http://127.0.0.1:8766](http://127.0.0.1:8766)。

### 可用命令

| 命令 | 用途 |
|---|---|
| `npm run serve` | 启动本地开发服务器 |
| `npm run verify` | 检查语法、数据契约、存档迁移、玩法流程、UI安全与无头战斗 |
| `npm run balance` | 运行确定性战斗和平衡门禁 |
| `npm run build` | 生成带版本化资源地址的 `dist/` 发布目录 |
| `npm run release-audit` | 检查发布目录、版本占位符、资源完整性与数据 JSON |
| `npm run http-audit` | 启动本地静态服务器，冒烟验证发布资源的 HTTP 状态码、MIME、版本化模块与数据加载 |
| `npm run quality-audit` | 检查静态壳层的可访问性、对话框、PWA 元数据与运行时安全钩子 |
| `npm run performance-audit` | 对发布文件数、总大小、JS、CSS、HTML、JSON 和最大模块执行性能预算 |
| `npm run check` | 串行执行完整本地发布门禁，避免构建与发布审计并发竞态 |

也可以使用任何支持 ES Modules 与 JSON MIME 类型的静态服务器运行源码。

## 项目架构 / Architecture

```text
Overlogic/
├─ data/                  # 动作、条件、敌人、战斗、奖励与运营清单
├─ src/
│  ├─ core/              # 游戏状态、存档、地图与战斗生命周期
│  ├─ logic/             # 条件评估、规则选择与动作执行
│  ├─ robot/             # 机器人属性与战斗行为
│  ├─ enemies/           # 敌人与 Boss 行为
│  ├─ systems/           # 音频、统计、奖励、协同协议、档案、每日目标、通关纪录、运行记录、回放摘要、诊断与存档写入闸门
│  ├─ ui/                # 编辑器、HUD、奖励、报告与胜利界面
│  ├─ render/            # 竞技场与镜头渲染
│  ├─ vfx/               # 弹体、地雷、危险区域与粒子效果
│  └─ i18n/              # 简中、繁中与英文文本
├─ scripts/              # 本地服务、构建、验证与平衡模拟
├─ OPERATIONS.md         # 运营清单、功能开关与后端接入边界
├─ BACKEND_CONTRACT.md   # 账号、云存档、排行榜、重放与权益接口契约
├─ CONTRIBUTING.md       # 本地验证、提交和发布协作规范
├─ index.html            # 应用结构
├─ style.css             # 响应式视觉系统
├─ manifest.webmanifest  # 可安装 Web App 元数据
├─ sw.js                 # 版本化离线缓存与弱网回退
├─ icon.svg              # 应用图标与分享预览图
├─ SECURITY.md           # 漏洞报告入口与客户端安全边界
└─ DESIGN.md             # 完整设计与维护约束
```

玩法内容优先放在 `data/*.json` 中，所有内容表都带 `schemaVersion` 并在运行时拒绝未知版本；运营开关和容量边界统一维护在 `data/operations.json` 与 `src/systems/OperationsConfig.js`；跨界面与战斗共享的机制应集中到独立系统模块。例如，协议协同的激活条件统一维护在 `src/systems/ProtocolSynergies.js`。检测到其他标签页改写持久化数据后，`StorageWriteGate` 会阻止当前标签继续写入，必须刷新后重新载入权威存档。

## 质量与发布 / Quality and deployment

每次推送到 `main` 都必须依次通过：

1. JavaScript 语法与数据契约检查。
2. 存档、奖励、规则分享、战斗流程及本地化验证。
3. 确定性平衡模拟。
4. 运行时内容契约校验（跨表 ID、参数边界、奖励引用与可加载形状）。
5. 版本化构建。
6. 发布产物审计（版本占位符、必需文件、JSON 数据与根目录清洁度）。
7. 产品质量审计（显式按钮类型、ARIA 对话框/Tab/进度条、PWA 元数据、离线与运行时安全钩子）。
8. 运营清单 schema、安全默认值与运行时保留策略接线检查。
9. 首屏资源、模块体积与发布总量性能预算。
10. GitHub Pages 部署。

部署只上传生成的 `dist/` 内容；构建脚本会为模块、数据与 Service Worker 注册地址注入提交版本，自动把全部运行时模块和数据表写入预缓存，并给缓存写入加配额失败保护。带版本的运行时资源在线时优先取得最新发布，离线时忽略查询参数命中完整预缓存，既避免新 HTML 与旧模块混载，也保证首次成功安装后断网仍能恢复完整运行时，而不只是应用壳层。

## 开发状态 / Project status

当前状态：**可完整游玩的 Web 产品基础版本，持续开发中。**

现有版本已经覆盖完整的规则编辑、分支流程、奖励、失败报告、胜利结算、可复现种子/挑战码、固定步长战斗、数据驱动危险区、13 个战斗内容、战斗记录、通关档案、个人最佳、操作员档案、成就基础、每日目标、事务化完整存档备份、每日种子、每周挑战、首领后升阶路线、沙盒测试、三语界面、离线缓存、护盾中继支援敌人、版本化运营清单、显式内容 schema、本地可选产品指标与发布审计。后续重点是扩大敌人行为、构筑差异、地图事件、在线排行榜/账号服务与外部玩家验证，而不是改变核心控制方式。

PWA 安装后的标准与每周快捷入口，以及 `?challenge=OLR1-...` 分享链接，会在没有进行中存档时预填对应模式、难度与种子；外部链接不能覆盖正在进行的运行。

## 语言

- 简体中文：完整
- 繁體中文：完整
- English: Complete

## 设计原则 / Design principle

> 每个系统都应该帮助玩家回答同一个问题：**“我的机器人为什么会这样做？”**

Every system should help the player answer one question: **“Why did my robot do that?”**

## 许可证 / License

[MIT License](LICENSE) © 2026 Sycamore-Grove
