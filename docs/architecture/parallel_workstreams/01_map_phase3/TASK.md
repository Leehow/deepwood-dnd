# 工作包 01：前端地图主线

建议分支：`codex/parallel-map-phase3`

## 目标

继续拆 [TacticalMap.client.tsx](/Users/haoli/leehow/code/dw/frontend/app/components/map/TacticalMap.client.tsx)，但只做地图主线，不碰后端热点。

这一包的核心目标是把 `handleAttackAction` 前半段和剩余 map runtime side-effect 继续收成 controller / util，让主组件继续瘦身。

## 当前状态

当前 TacticalMap 已经拆出了大量 controller，包括但不限于：

- `useMapAttackResultController.ts`
- `useMapMonsterActionController.ts`
- `useMapWeaponAttackCleanupController.ts`
- `useMapManeuverController.ts`
- `useMapSpellActionController.ts`
- `useMapAreaSpellCastExecutionController.ts`
- `useMapTokenInteractionController.ts`
- `useMapTokenDragController.ts`

当前还比较重的区域：

- `handleAttackAction` 前半段的 target snapshot / roll context / request preparation
- `handleSelectionStandardAction`
- `handleUseConsumable`
- `handleBlindAttack`
- `handleSelectionMoveTo / executeMove`

## 允许修改

- `frontend/app/components/map/**`
- `frontend/tests/hooks/**`
- `frontend/tests/events/**`

## 不要修改

- `backend/**`
- `frontend/app/events/appEventBus.ts`，除非你这条链确实必须新增一个 typed 事件
- `frontend/app/campaign-shell/**`
- `docs/architecture/*.md`

## 优先切口

1. 把 `handleAttackAction` 的 request-preparation 抽成独立 util/controller
2. 把 movement result / combat move follow-up 抽成独立 controller
3. 把 consumable / blind attack 这些支线从主组件里继续移走

## 推荐产物

- 新增 `useMapWeaponAttackPreparationController.ts` 或等价命名
- 新增 `useMapMovementActionController.ts` 或等价命名
- 新增针对 request builder / cleanup / move result 的 focused tests

## 验证命令

```bash
cd /Users/haoli/leehow/code/dw/frontend
npm run typecheck
npx vitest run tests/hooks
```

如果改动范围很大，至少要跑与你新增 hook 对应的 focused test 文件。

## 完成标准

- `TacticalMap.client.tsx` 再减少一段明显的高复杂度逻辑
- 新逻辑进入独立 hook / util
- `npm run typecheck` 通过
- 相关 focused Vitest 通过

## 交付格式

- 1 到 3 个逻辑清晰的 commit
- 最终说明里列出：
  - 新增的 hook / util
  - 从 `TacticalMap.client.tsx` 移走了哪几段
  - 实际跑过哪些命令
