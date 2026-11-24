# Overlogic

[立即游玩 / Play online](https://lunora-gather.github.io/Overlogic/) · [繁體中文](#繁體中文) · [English](#english) · [构建与部署](#构建与部署)

Overlogic 是一款俯视角自动战斗策略 Roguelite。你不操作机器人的方向键，而是决定它什么时候举盾、何时后撤、优先攻击谁。它按优先级执行你的规则；如果打输了，战后报告会告诉你它做了什么，以及哪些规则没有生效。

## 玩第一局

1. 在首页保留标准模式和默认难度，选择「进入逻辑工作台」。此时不会开战。
2. 看第一条规则的条件、阈值和动作。例如，把「生命值较低 → 护盾」的阈值调高，机器人就会更早尝试开盾。保留一条低优先级的基础攻击，防御动作冷却时它还有事可做。
3. 选「沙盒测试」可以先试构筑，不消耗路线进度。准备好后选「启动战斗模拟」进入正式战斗。观察当前指令，或暂停查看规则为什么被跳过。
4. 胜利后选择升级，带着剩余生命进入下一节点；失败后读伤害来源和规则使用情况，再回工作台调整。胜利待领奖时刷新，可以从首页继续领取。

| 想做什么 | 去哪里 |
| --- | --- |
| 试另一种策略 | 在工作台组合条件、动作和目标，用优先级决定先后；模板和配置槽可复用整套规则。 |
| 和朋友比同一局 | 分享挑战码，也可尝试每日种子或每周挑战。种子决定战役条件，战绩榜保存在本设备。 |
| 看清一次决策 | 战斗中按 `P` 暂停或继续，暂停时按 `.` 单步，按 `S` 切换速度。也可使用屏幕上的战斗控件。 |
| 换设备或浏览器 | 在系统设置导出完整 JSON 备份，再在目标浏览器导入。规则分享码不是完整存档。 |

窄屏工作台先显示规则，路线、准备度和协同可展开查看；模板和已存配置也可以单独打开。战斗中，状态栏和战场分别占一行，展开指令与日志即可查看每次判断。

存档在当前浏览器，不需要帐号，也不会自动同步。清理网站数据前请先备份。支持安装为 PWA；第一次在线加载并完成缓存后可离线游玩。本地产品指标默认关闭，不会自动上传。

## 繁體中文

你負責編寫規則，機器人負責戰鬥。從首頁選「進入邏輯工作臺」，先調整條件與動作；「沙盒測試」不影響戰役進度，「啟動戰鬥模擬」才會開戰。戰後比較傷害來源與規則使用情況，再決定下一次升級。換裝置前，請從系統設定匯出完整存檔。

## English

Program a robot instead of piloting it. Choose **Open Logic Workstation**, give defensive rules a higher priority than a fallback attack, and try your build in the sandbox without spending campaign progress. **Launch Battle** starts the encounter. Watch the active rule, then use the post-battle report to decide what to change. Seeded daily and weekly runs can be shared; saves and records stay in your browser unless you export a backup.

## 本地运行

使用 Node.js 24（与 CI 一致）。游戏使用原生 JavaScript ES Modules 和 Canvas，不需要安装 npm 依赖。

```sh
git clone https://github.com/Lunora-Gather/Overlogic.git
cd Overlogic
npm run serve
```

打开 http://127.0.0.1:8766 。不要直接双击 `index.html`：模块和 JSON 数据需要通过 HTTP 加载。

## 构建与部署

| 命令 | 用途 |
| --- | --- |
| `npm run verify` | 检查内容契约、存档和结算、无头战斗、三语 UI 与回归用例。 |
| `npm run balance` | 运行确定性平衡模拟。 |
| `npm run build` | 生成带版本号和预缓存校验值的 `dist/`。 |
| `npm run layout-audit` | 构建后用 Chrome 检查三语首页、规则可读性和战场遮挡。可用 `CHROME_BIN` 指定 Chromium 可执行文件；CI 会在部署前执行。 |
| `npm run check` | 不依赖浏览器的本地门禁（发布前另跑 `layout-audit`）：verify → balance → quality-audit → build → release-audit → http-audit → performance-audit。 |

向 `main` 推送后，[Verify 工作流](https://github.com/Lunora-Gather/Overlogic/actions/workflows/verify.yml) 会检查并部署 `dist/` 到 GitHub Pages。用线上 [release.json](https://lunora-gather.github.io/Overlogic/release.json) 的 `release` 与提交 SHA 核对版本。已打开的 PWA 可能仍使用上一套缓存；新版本资源全部校验通过后，再按更新提示重新加载。无需清除存档。

## 项目导航

- `data/`：条件、动作、敌人、战斗、奖励和运营清单。
- `src/logic/`、`src/core/`：规则执行、战役状态和战斗循环；`src/ui/`、`src/i18n/`：界面与三语文案。
- [设计文档](DESIGN.md) · [运营手册](OPERATIONS.md) · [贡献指南](CONTRIBUTING.md) · [安全问题报告](SECURITY.md)
- 帐号、云存档和公开排行榜是[后端接入契约](BACKEND_CONTRACT.md)，不是当前线上功能。

[MIT License](LICENSE) © 2026 Sycamore-Grove
