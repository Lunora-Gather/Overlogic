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

`src/systems/OperationsConfig.js` 会做白名单和边界归一化：未知字段会被忽略，非法季节 ID 会回退到安全默认值，容量上限会被限制在可接受范围内，清单加载失败时仍使用全部功能开启的默认配置。

## 发布流程

1. 修改 `data/operations.json`，同步更新三语文案或 `DESIGN.md`。
2. 运行 `npm run verify`、`npm run quality-audit`、`npm run build` 和 `npm run release-audit`。
3. 在本地页面确认模式选项、模板入口、沙盒入口和维护提示。
4. 推送后等待 Verify 与 deploy 两个作业成功，再检查线上 `meta[name="overlogic-release"]`。

维护开关只负责提示，不会破坏已有离线内容或进行中的本地存档。功能开关只影响新入口；已有进行中的模式仍可恢复，避免一次运营改动把玩家锁在半局流程之外。

## 后端接入边界

未来接入远程配置时，服务端只需要返回同一份 schema。客户端仍必须经过 `normalizeOperationsConfig`，远程配置不能直接注入条件、动作、奖励数值或支付权益。排行榜、账号、支付和封禁必须由服务端独立鉴权，不能把本清单当成反作弊边界。

