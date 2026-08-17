# Overlogic 后端接入契约 / Backend Contract

Overlogic 当前是静态、本地优先的 Web 游戏。本文定义未来账号、云存档、排行榜、重放验证和商业权益服务的最小契约，不能被解释为当前已经存在的服务器能力。

## 设计原则

- 客户端可以离线游玩；服务器能力是渐进增强，不得阻塞标准离线战斗。
- 客户端存档、`OLR1` 挑战码、`RPL1` 回放摘要和 `SAV1` 导出摘要都是输入提示，不是反作弊边界。
- 所有远程响应都必须经过客户端 schema 校验；未知版本 fail closed。
- 竞争排名、付费权益和封禁状态必须由服务器权威判定。
- 每个写请求都支持幂等键、版本号和条件写入，避免重复结算或覆盖新数据。

## 通用响应包

```json
{
  "schemaVersion": 1,
  "requestId": "req_01J...",
  "serverTime": "2026-08-17T00:00:00.000Z",
  "data": {},
  "error": null
}
```

错误必须包含稳定的 `code`、面向日志的 `requestId` 和可本地化的客户端文案键；不得把堆栈、令牌或数据库字段返回给客户端。

## 账号与会话

| Endpoint | 用途 | 必要约束 |
| --- | --- | --- |
| `POST /v1/session` | 建立短期会话 | SameSite、CSRF、短时 access token、可撤销 refresh token |
| `GET /v1/me` | 获取最小账号档案 | 不返回支付敏感字段 |
| `DELETE /v1/me` | 注销并删除账号 | 异步删除任务、确认状态、审计记录 |
| `GET /v1/me/export` | 导出个人数据 | 受限频率、一次性下载签名 |

客户端不得把邮箱、账号 ID 或 token 写入 `ProductTelemetry`、回放摘要或公开挑战码。

## 云存档

`PUT /v1/me/save` 接收经过 schema 校验的完整存档包：

```json
{
  "saveVersion": 7,
  "clientRelease": "<sha>",
  "baseRevision": 42,
  "payload": {},
  "clientIntegrity": "SAV1-XXXXXXXX"
}
```

- 服务端生成单调递增 `revision`，使用 `If-Match` 或 `baseRevision` 拒绝陈旧覆盖。
- 保存和奖励领取必须使用 `idempotencyKey`；重复请求返回同一结算结果。
- 服务端保留最近若干版本和审计摘要，客户端冲突时提供“服务器版 / 本机版 / 合并前备份”。
- 客户端仍可在无网络时使用本地 `StorageWriteGate`，联网后再同步。

## 挑战与排行榜

- `GET /v1/operations/current` 返回与 `data/operations.json` 同形状的签名配置；客户端仍执行 `normalizeOperationsConfig`。
- `POST /v1/challenges/validate` 校验挑战定义、赛季窗口和版本兼容性。
- `POST /v1/runs/submit` 只接收完整回放事件、种子、固定步长、模拟版本和客户端收据；服务端重算关键结果。
- `GET /v1/leaderboards/{season}/{mode}` 只返回已验证记录，带 `revision`、分页游标和地区/难度筛选。
- 未通过重算的记录只能进入个人本地历史，不能进入公开榜单或发放竞争奖励。

## 重放验证

服务端必须以 `simulationVersion + simulationStep + seed + normalized content revision` 重建战斗，不信任客户端的最终胜负、伤害、时间或奖励列表。验证失败返回稳定错误码，不透露具体反作弊规则。

## 商业权益

权益服务与战斗内容解耦：

- `GET /v1/entitlements` 返回已签名的权益快照和过期时间。
- 支付平台 webhook 是权益真相来源，客户端回调不能授予权益。
- 退款、撤销、地区限制和重复订单必须幂等处理。
- 任何付费内容都必须有离线降级文案，不得让静态客户端因为权益服务不可用而卡死已有单机进度。

## 迁移顺序

1. 先接账号会话和云存档，复用当前 `GameState.exportSaveData()` / `importSaveData()`。
2. 再接远程运营清单，保留本地静态清单作为签名失败时的安全回退。
3. 最后接回放验证、公开排行榜和付费权益；任何一步都不能把本地客户端完整性摘要当作服务器证明。
