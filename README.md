<div align="center">

# OVERLOGIC

### 设计机器人的大脑，而不是操控它的双手。

Program the brain. Observe the battle. Debug the logic.

[![Verify and Deploy](https://img.shields.io/github/actions/workflow/status/Lunora-Gather/Overlogic/verify.yml?branch=main&label=verify%20%26%20deploy&style=flat-square)](https://github.com/Lunora-Gather/Overlogic/actions/workflows/verify.yml)
[![License: MIT](https://img.shields.io/github/license/Lunora-Gather/Overlogic?style=flat-square)](LICENSE)
[![Playable Demo](https://img.shields.io/badge/status-playable%20web%20demo-39e6a0?style=flat-square)](https://lunora-gather.github.io/Overlogic/)
[![Languages](https://img.shields.io/badge/languages-简中%20%7C%20繁中%20%7C%20EN-62d9ff?style=flat-square)](#语言)

**[▶ 立即游玩 / Play Online](https://lunora-gather.github.io/Overlogic/)**

[简体中文](#简体中文) · [繁體中文](#繁體中文) · [English](#english) · [设计文档](DESIGN.md)

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
- **以失败推动学习**：伤害分析、动作频率、规则使用率、关键事件时间轴和自动修复建议共同解释失败原因。
- **具有构筑方向的奖励**：动作、条件、被动升级与四套协议协同会改变战斗机制，而不只是提高数值。
- **可重复挑战**：分支路线、持续生命值、危险区域、精英战、双 Boss 路线、每日种子与多种难度。
- **每日目标与长期成长**：每天刷新胜场、伤害和 Boss 目标，完成目标获得 XP；进度可随完整备份迁移。
- **随时验证逻辑**：混合、弹幕、虫群和 Boss 四种沙盒场景，不消耗正式流程进度。
- **跨设备体验**：支持桌面与移动布局、触控排序、键盘操作、减少动态效果及镜头震动设置。
- **三语界面**：完整支持简体中文、繁体中文和英文。

### 一条规则能做什么

```text
优先级 90：如果 敌人正在蓄力 → 打断射击（目标：施法单位）
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

每局都会生成可复现的运行种子。主菜单支持输入数字种子或 `OLR1-STANDARD-VETERAN-…` 挑战码；战斗结束后，最近战斗、操作员等级、XP 与成就进度会保存在本地。设置中的存档工具可以导出包含规则、设置、配置栏、战斗记录和操作员档案的完整 JSON 备份。

---

## 繁體中文

《Overlogic》是一款 2D 俯視角自動戰鬥策略 Roguelite。玩家不直接控制機器人，而是編寫具有優先級的 `如果條件成立 → 執行動作` 規則，觀察戰鬥結果並持續偵錯。

主要特色：

- 使用 `AND`、`OR`、`NOT`、優先級和目標選擇建立戰鬥邏輯。
- 即時顯示規則執行、冷卻、能量與條件診斷。
- 透過傷害報告、關鍵時間軸和規則建議理解失敗原因。
- 分支路線、每日種子、多種難度、沙盒測試與機制型協定協同。
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
- Build around actions, conditions, passive upgrades, and four mechanic-changing protocol synergies.
- Explore branching routes, persistent hull damage, hazards, daily seeds, multiple difficulties, and two boss paths.
- Test logic safely in mixed, projectile, swarm, and boss sandbox scenarios.
- Play in English, Simplified Chinese, or Traditional Chinese on desktop and mobile layouts.
- Reproduce a run with a numeric seed or an `OLR1-…` challenge code, then review recent battle history and operator progression locally.
- Complete three deterministic daily objectives for bonus XP; sandbox runs never advance formal progression.
- Export and restore a verified full save backup, including settings, loadouts, battle history, and profile achievements.

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

也可以使用任何支持 ES Modules 与 JSON MIME 类型的静态服务器运行源码。

## 项目架构 / Architecture

```text
Overlogic/
├─ data/                  # 动作、条件、敌人、战斗与奖励内容
├─ src/
│  ├─ core/              # 游戏状态、存档、地图与战斗生命周期
│  ├─ logic/             # 条件评估、规则选择与动作执行
│  ├─ robot/             # 机器人属性与战斗行为
│  ├─ enemies/           # 敌人与 Boss 行为
│  ├─ systems/           # 音频、统计、奖励、协同协议、档案、每日目标与运行记录
│  ├─ ui/                # 编辑器、HUD、奖励、报告与胜利界面
│  ├─ render/            # 竞技场与镜头渲染
│  ├─ vfx/               # 弹体、地雷、危险区域与粒子效果
│  └─ i18n/              # 简中、繁中与英文文本
├─ scripts/              # 本地服务、构建、验证与平衡模拟
├─ index.html            # 应用结构
├─ style.css             # 响应式视觉系统
├─ manifest.webmanifest  # 可安装 Web App 元数据
├─ sw.js                 # 版本化离线缓存与弱网回退
├─ icon.svg              # 应用图标与分享预览图
└─ DESIGN.md             # 完整设计与维护约束
```

玩法内容优先放在 `data/*.json` 中；跨界面与战斗共享的机制应集中到独立系统模块。例如，协议协同的激活条件统一维护在 `src/systems/ProtocolSynergies.js`。

## 质量与发布 / Quality and deployment

每次推送到 `main` 都必须依次通过：

1. JavaScript 语法与数据契约检查。
2. 存档、奖励、规则分享、战斗流程及本地化验证。
3. 确定性平衡模拟。
4. 运行时内容契约校验（跨表 ID、参数边界、奖励引用与可加载形状）。
5. 版本化构建。
6. 发布产物审计（版本占位符、必需文件、JSON 数据与根目录清洁度）。
7. GitHub Pages 部署。

部署只上传生成的 `dist/` 内容；构建脚本会为模块与数据地址注入提交版本，并给 Service Worker 写入发布缓存版本，避免浏览器混用不同版本的缓存资源。首次成功加载后，浏览器可安装 Overlogic；弱网或短暂断网时会优先恢复最近一次可用的应用壳层。

## 开发状态 / Project status

当前状态：**可完整游玩的 Web 产品基础版本，持续开发中。**

现有版本已经覆盖完整的规则编辑、分支流程、奖励、失败报告、胜利结算、可复现种子/挑战码、战斗记录、操作员档案、成就基础、每日目标、完整存档备份、每日种子、沙盒测试、三语界面、离线缓存与发布审计。后续重点是扩大敌人和 Boss 内容、构筑差异、地图事件、在线排行榜/账号服务与外部玩家验证，而不是改变核心控制方式。

## 语言

- 简体中文：完整
- 繁體中文：完整
- English: Complete

## 设计原则 / Design principle

> 每个系统都应该帮助玩家回答同一个问题：**“我的机器人为什么会这样做？”**

Every system should help the player answer one question: **“Why did my robot do that?”**

## 许可证 / License

[MIT License](LICENSE) © 2026 Sycamore-Grove
