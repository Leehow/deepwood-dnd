# Server State Guide

更新时间：2026-03-23

本文件定义 Phase 3 的 server-state 唯一标准。业务主路径不再允许“apiFetch + 本地自建缓存 + 事件重拉”的混合模式。

## 唯一标准

- 传输层：`apiFetch`（bearer 默认注入）。
- 读取层：React Query domain hooks / query-backed cache。
- 失效层：`invalidateQueries()` 或局部乐观同步。
- `typed-api-client.ts` 保留但冻结，不再作为新代码主入口。
- 不再新增新的 TTL/Promise/Map 手写缓存实现。

## 统一入口

- QueryClient：
  - [queryClient.ts](/Users/haoli/leehow/code/dw/frontend/app/queries/queryClient.ts)
- Domain queries：
  - [campaignQueries.ts](/Users/haoli/leehow/code/dw/frontend/app/queries/campaignQueries.ts)
  - [characterQueries.ts](/Users/haoli/leehow/code/dw/frontend/app/queries/characterQueries.ts)
  - [combatQueries.ts](/Users/haoli/leehow/code/dw/frontend/app/queries/combatQueries.ts)
  - [moduleQueries.ts](/Users/haoli/leehow/code/dw/frontend/app/queries/moduleQueries.ts)
  - [chatQueries.ts](/Users/haoli/leehow/code/dw/frontend/app/queries/chatQueries.ts)

## 首屏单 Owner 规则

DM/Player 首屏的高频读取由 campaign shell/query 入口统一 owner，其它组件只消费 query cache：

- `campaign detail`
- `map-settings`
- `storage/combat/current`
- `map-bulk-data`
- `tokens/campaign/map`
- `chat/messages`

已落地关键点：

- [campaignShell.service.ts](/Users/haoli/leehow/code/dw/frontend/app/services/campaignShell.service.ts) 负责首屏预取与 query 注入。
- [useCampaignShellBootstrap.ts](/Users/haoli/leehow/code/dw/frontend/app/campaign-shell/bootstrap/useCampaignShellBootstrap.ts) 通过稳定依赖避免重复 bootstrap。
- [useMapData.ts](/Users/haoli/leehow/code/dw/frontend/app/components/map/hooks/useMapData.ts) 在 bulk 返回后注入 tokens query，避免二次直拉。
- [CombatPanel.tsx](/Users/haoli/leehow/code/dw/frontend/app/components/combat/CombatPanel.tsx) 的 chat/tokens 初始读取改为 query-backed cache。
- [ChatPanel.tsx](/Users/haoli/leehow/code/dw/frontend/app/components/ui/ChatPanel.tsx) 与 [FloatingFilterPanel.tsx](/Users/haoli/leehow/code/dw/frontend/app/components/chat/FloatingFilterPanel.tsx) 统一走 `chatQueries`。

## 预算门槛（首屏 5 秒）

- `campaign/map-settings/combat/map-bulk-data/tokens` 各 `<=1`
- `chat/messages <=2`（普通历史 + dice 历史）

固定 smoke：

- `npx playwright test debug/phase3_budget_smoke.spec.ts --config playwright.config.ts`

## Cache 规则

- 旧 cache util 可以保留文件名，但只能作为 QueryClient wrapper。
- 任何新 server-state 读取，必须先进 domain query，再被组件消费。
- realtime 与 typed bus 只做失效或局部同步，不再触发多处 mount 时并发重拉。

## 验收门槛

- `npm run typecheck`
- focused Vitest（queries / transport / runtime cache wrappers）
- Playwright 首屏预算 smoke（DM + Player）
- 业务主路径不新增 `user_id/role` query 拼接
