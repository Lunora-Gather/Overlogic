# Overlogic 运营配置手册

`data/operations.json` 是当前版本的运营清单。它通过正常的代码审查、验证和 Pages 发布链路进入线上，不允许未经校验的运行时对象直接改变战斗规则。

## 当前字段

```json
{
  "schemaVersion": 1,
  "season": { "id": "foundry_protocol", "labelKey": "ops.seasonFoundry" },
  "features": {
    "dailyChallenges": true,
    "weeklyGauntlet": true,
    "sandbox": true,
    "ruleTemplates": true,
    "shieldRelay": true
  },
  "maintenance": { "enabled": false },
  "limits": {
    "recentBattles": 4,
    "archiveEntries": 60,
    "supportErrors": 20
  }
}
```

`src/systems/OperationsConfig.js` 会做白名单和边界归一化：未知字段会被忽略，非法季节 ID 会回退到安全默认值，容量上限会被限制在可接受范围内，清单加载失败时仍使用全部功能开启的默认配置。三个容量字段都直接驱动运行时：`recentBattles` 控制主菜单和支援包的近期战斗条数，`archiveEntries` 控制本机通关档案保留量，`supportErrors` 控制支援包导出的最近错误数量；它们不是仅供文档展示的装饰字段。

## 发布流程

1. 修改 `data/operations.json`，同步更新三语文案或 `DESIGN.md`。
2. 运行 `npm run verify`、`npm run quality-audit`、`npm run build`、`npm run release-audit` 和 `npm run performance-audit`。
3. 在本地页面确认模式选项、模板入口、沙盒入口和维护提示。
4. 推送后等待 Verify 与 deploy 两个作业成功，再检查线上 `meta[name="overlogic-release"]`。

PWA 快捷入口和社区分享链接可以使用 `?launch=standard|daily|weekly`、`?mode=...&difficulty=...&seed=...`，或完整的 `?challenge=OLR1-...`。启动参数只在没有进行中存档时生效，并复用 `GameState.parseRunCode()` 与运营功能开关校验；进行中的运行永远优先，不能被外部链接覆盖。

维护开关只负责提示，不会破坏已有离线内容或进行中的本地存档。功能开关只影响新入口；已有进行中的模式仍可恢复，避免一次运营改动把玩家锁在半局流程之外。

本地产品指标由玩家在设置中明确开启，默认关闭。`src/systems/ProductTelemetry.js` 只接受白名单事件和粗粒度属性，保留最近 40 条，永不主动联网；关闭开关会立即删除对应本地数据，即使当前标签因跨标签冲突已暂停游戏进度写入，撤回同意仍拥有更高优先级。未来的分析服务必须在这一事件契约之外再实现同意记录、鉴权、保留期限和删除请求。

## 后端接入边界

未来接入远程配置时，服务端只需要返回同一份 schema。客户端仍必须经过 `normalizeOperationsConfig`，远程配置不能直接注入条件、动作、奖励数值或支付权益。排行榜、账号、支付和封禁必须由服务端独立鉴权，不能把本清单当成反作弊边界。
