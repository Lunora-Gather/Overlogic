# Contributing to Overlogic

感谢参与 Overlogic。项目是无第三方运行时依赖的 ES Modules Web 游戏，所有玩法内容优先放在 `data/`，跨界面机制放在 `src/systems/`，不要把远程服务假设写进战斗核心。

## 本地流程

1. 使用 Node.js 24。
2. 运行 `npm run check`。它会串行执行语法、数据契约、玩法、平衡、质量、构建、发布目录、HTTP 和性能门禁。
3. UI 变更需要检查 English、简体中文、繁体中文和移动端；存档变更必须补充旧版本、未来版本和损坏输入测试。
4. 玩法变更必须更新数据契约、确定性平衡门禁和必要的 `DESIGN.md` / `OPERATIONS.md` 说明。

## 提交约束

- 不提交 `dist/`、临时日志、浏览器个人数据或本地支持包。
- 不使用未固定 SHA 的 GitHub Actions。
- 不把客户端收据、回放摘要或本地指标当成服务端反作弊证明。
- 不直接修改用户存档格式而不增加迁移或兼容读取路径。
- 所有静态按钮声明 `type`；所有新弹窗、Canvas、进度条和输入控件提供可访问名称。

## 发布流程

`main` 的 Pages 发布必须经过 Verify job。发布前后都要通过产品质量、发布目录、HTTP 和性能审计；线上验收至少检查完整 release SHA、三语启动、控制台无错误、Service Worker 更新和离线壳层。

未来接入账号、云存档、排行榜或权益服务时，先阅读 [BACKEND_CONTRACT.md](BACKEND_CONTRACT.md)，保持本地优先和服务端权威边界。
