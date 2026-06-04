# Transport And Auth Guide

更新时间：2026-03-23

本文件是 Phase 3 的强制规范。除测试夹具和明确标注的内部工具外，业务主路径必须遵循本页规则。

## 唯一标准

- HTTP app-facing 接口：仅 `Authorization: Bearer <token>` 作为调用者身份来源。
- WebSocket app-facing 建连：仅 `?token=<jwt>` 作为身份来源。
- `X-User-ID`、`user_id`、`role` 不再承担调用者身份语义。
- 前端传输层统一使用 [api-client.ts](/Users/haoli/leehow/code/dw/frontend/app/utils/api-client.ts)。
- 前端 WebSocket 统一使用 [useWebSocket.ts](/Users/haoli/leehow/code/dw/frontend/app/hooks/useWebSocket.ts) 与 [useReconnectingWebSocket.ts](/Users/haoli/leehow/code/dw/frontend/app/hooks/useReconnectingWebSocket.ts)。

## 后端入口规范

- 认证入口：`require_auth`（定义于 [security.py](/Users/haoli/leehow/code/dw/backend/app/core/security.py)）。
- 战役成员上下文入口：`resolve_campaign_member_context`（定义于 [dependencies.py](/Users/haoli/leehow/code/dw/backend/app/core/dependencies.py)）。
- route 允许职责：鉴权、参数解析、调用 service/usecase、发布 realtime 事件、返回响应。
- route 禁止职责：通过 query/header 信任客户端注入身份。

## Campaign Member 子接口规范（/me）

业务主路径统一使用 `/me` 版本，不再要求前端拼接当前用户 ID：

- `GET/POST /api/campaigns/{campaign_id}/members/me/selected-character`
- `GET/PUT /api/campaigns/{campaign_id}/members/me/notes`
- `GET /api/campaigns/{campaign_id}/members/me/sidebar-state/{role}`
- `POST /api/campaigns/{campaign_id}/members/me/sidebar-state`

`/members/{user_id}/...` 仅作为资源视角接口（例如 DM 查看/操作指定成员），不承担调用者身份解析。

## 前端传输规范

- `apiFetch(..., { userId })` 保留兼容签名，但 `userId` 已是 no-op，不再注入身份头。
- 业务代码不得新增 `?user_id=`、`?role=`、`X-User-ID`。
- 业务代码不得新增 “按 user_id/role 决定是否允许请求” 的客户端语义，权限由服务端上下文决定。

## WebSocket 规范

- 战役 WS 与模块 parse WS 都走 token-only 身份路径。
- 前端不再拼接 `user_id/role` 到 WS URL。
- 角色、权限和成员关系全部在服务端由 token + campaign membership 推导。

## 强制门槛

### grep 门槛

- `rg "X-User-ID|\\?user_id=|&user_id=|\\?role=|&role=" frontend/app backend/app`
  - 预期：业务主路径为空（测试夹具例外）。
- `rg 'alias="X-User-ID"|\\buser_id\\s*:\\s*.*Query\\(|\\brole\\s*:\\s*.*Query\\(' backend/app/api/routes`
  - 预期：app-facing 业务路由为空。

### 行为门槛

- DM/Player 首屏 5 秒预算断言由固定 smoke 执行：
  - `npx playwright test debug/phase3_budget_smoke.spec.ts --config playwright.config.ts`
- 上述 smoke 必须满足：
  - `campaign/map-settings/combat/map-bulk-data/tokens` 各 `<=1`
  - `chat/messages <=2`
  - 网络 URL 不包含 `user_id` 或 `role`
  - console `0 errors`
