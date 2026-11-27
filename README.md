# Overlogic

[立即游玩 / Play online](https://lunora-gather.github.io/Overlogic/) · [繁體中文](#繁體中文) · [English](#english) · [构建与部署](#构建与部署)

Overlogic 是一款俯视角自动战斗策略 Roguelite。你不操作机器人的方向键，而是决定它什么时候举盾、何时后撤、优先攻击谁。它按优先级执行你的规则；如果打输了，战后报告会告诉你它做了什么，以及哪些规则没有生效。

## 玩第一局

1. 首页的护盾预览可以直接拖动生命值。降到 30% 时护盾会亮起；预览独立于存档。选择「进入逻辑工作台」。第一条规则默认在生命降到 30% 时尝试举盾。点「调至 50% 开盾」，可以看到规则摘要和数值一起更新，也可以撤销这次修改。
2. 点「护盾演练」。机器人以 40% 生命面对两只爬行者，返回工作台时会显示实际举盾次数。演练保留战役生命、胜场和路线进度。
3. 保留一条低优先级的基础攻击，选择「启动战斗模拟」。想看清一次判断，可以暂停后单步推进，查看规则触发或跳过的原因。
4. 失败后先看坚持时间、最大伤害来源和调整建议。可以在报告里添加建议规则，再编辑或重试。胜利后比较升级前后的属性，或查看新动作、新条件的效果。刷新后，首页会显示当前战役和待领升级，点「继续领取奖励」即可回到原来的选项。

| 想做什么 | 去哪里 |
| --- | --- |
| 试另一种策略 | 在工作台组合条件、动作和目标，用优先级决定先后；模板和配置槽可复用整套规则。 |
| 和朋友比同一局 | 分享挑战码，也可尝试每日种子或每周挑战。种子决定战役条件，战绩榜保存在本设备。 |
| 看清一次决策 | 战斗中按 `P` 暂停或继续，暂停时按 `.` 单步，按 `S` 切换速度。也可使用屏幕上的战斗控件。 |
| 换设备或浏览器 | 在系统设置的「存档数据」页签导出完整 JSON 备份，再在目标浏览器导入。规则分享码不是完整存档。 |

点击规则摘要可展开或收起条件与动作，勾选框可直接启停该规则。工作台顶部始终可启动正式战斗，也可展开「测试规则」选择沙盒场景。窄屏工作台先显示规则，路线、准备度和协同可展开查看；模板和已存配置也可以单独打开。战场旁会保留最近实际执行的动作、触发条件和优先级。展开「指令与日志」可查看规则是否满足条件、正在冷却或被更高优先级的规则覆盖。

每场战斗最多进行 240 秒模拟时间，最后 30 秒会显示倒计时。若超时仍有敌人，会进入复盘并保留路线和出战前的生命值。可按建议添加一条低优先级的基础攻击，再重试同一战。后几关可以用「支援集火」优先清掉维修和护盾单位。有修复动作时，试试「生命值 ≤ 75% → 修复」，并保留基础攻击。

存档在当前浏览器，不需要帐号，也不会自动同步。清理网站数据前请先备份。支持安装为 PWA；第一次在线加载并完成缓存后可离线游玩。本地产品指标默认关闭，不会自动上传。

## 繁體中文

首頁可拖動生命值，在 30% 時看到護盾啟動。選「進入邏輯工作臺」，點規則摘要即可展開編輯。按「調至 50% 開盾」，再進入「護盾演練」。機體會以 40% 生命面對兩隻爬行者，演練結束後可看到實際舉盾次數。戰役生命與路線進度會保留。準備好後選「啟動戰鬥模擬」。失敗報告會列出存活時間、主要傷害來源與下一步建議，可直接新增建議規則。勝利後可比較升級前後的屬性，或查看新能力的效果。重新載入後，可從首頁繼續領取獎勵。換裝置前，請從系統設定匯出完整存檔。

每場戰鬥上限為 240 秒模擬時間，最後 30 秒會顯示倒數。若逾時仍有敵人，會進入復盤並保留路線與出戰前的生命值。可依建議新增一條較低優先級的基礎攻擊，再重試同一場戰鬥。

## English

Drag the HP slider on the home screen to trigger the shield at 30%. Choose **Open Logic Workstation**, expand a rule to edit it, then **Set shield to 50%**. The **Shield drill** starts the robot at 40% HP against two crawlers. Back in the editor, check how often the shield activated. The drill preserves campaign HP and route progress. Leave a basic attack enabled and choose **Launch Battle**. After a loss, the report shows how long the robot survived, which source dealt the most damage, and a suggested change. Add a suggested rule from the report, edit your build, or retry. After a win, compare stat changes and new abilities before choosing an upgrade. If you reload, the home screen lets you resume the reward selection. Saves stay in this browser unless you export a backup.

Each battle allows up to 240 seconds of simulation time, with a countdown for the last 30 seconds. If enemies remain at the limit, the report lets you add a fallback basic attack and retry with the same route and starting HP.

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
| `npm run verify` | 检查内容契约、存档和结算、三语 UI，并用真实战斗引擎跑通三种难度的固定种子战役。 |
| `npm run balance` | 运行确定性平衡模拟。 |
| `npm run build` | 生成带版本号和预缓存校验值的 `dist/`。 |
| `npm run layout-audit` | 构建后用 Chrome 检查三语首页、短窗口编辑、操作栏可达性和横竖屏战场遮挡。可用 `CHROME_BIN` 指定 Chromium 可执行文件；CI 会在部署前执行。 |
| `npm run safari-audit` | 在 macOS 上先运行 `npm run build`。系统 Safari 会检查三语引导、规则编辑、路线间距、桌面三栏对齐、沙盒演练、失败复盘、图表缩放、刷新后继续领奖、数字键领奖和首领界面。手机尺寸通过浏览器视口模拟。 |
| `npm run safari-audit -- --campaign` | 在系统 Safari 从新存档打完标准与休闲两条路线，覆盖超时复盘、修复后重试、分支、通关归档和重新开局。 |
| `npm run check` | 不依赖浏览器的本地门禁（发布前另跑 `layout-audit`）：verify → balance → quality-audit → build → release-audit → http-audit → performance-audit。 |

向 `main` 推送后，[Verify 工作流](https://github.com/Lunora-Gather/Overlogic/actions/workflows/verify.yml) 会检查并部署 `dist/` 到 GitHub Pages。用线上 [release.json](https://lunora-gather.github.io/Overlogic/release.json) 的 `release` 与提交 SHA 核对版本。已打开的 PWA 可能仍使用上一套缓存；新版本资源全部校验通过后，再按更新提示重新加载。无需清除存档。

## 项目导航

- `data/`：条件、动作、敌人、战斗、奖励和运营清单。
- `src/logic/`、`src/core/`：规则执行、战役状态和战斗循环；`src/ui/`、`src/i18n/`：界面与三语文案。
- [设计文档](DESIGN.md) · [运营手册](OPERATIONS.md) · [贡献指南](CONTRIBUTING.md) · [安全问题报告](SECURITY.md)
- 帐号、云存档和公开排行榜是[后端接入契约](BACKEND_CONTRACT.md)，不是当前线上功能。

[MIT License](LICENSE) © 2026 Sycamore-Grove
