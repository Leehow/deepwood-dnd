# Runtime Schema Catalog

更新时间：2026-03-23

本文件定义 Phase 3 的 runtime 边界标准：高频 JSON 运行态必须通过统一 schema 入口读写，不再允许主链路裸 `Dict[str, Any]` 穿透。

## 唯一标准

- 后端 runtime schema 文件固定在：
  - [token_runtime.py](/Users/haoli/leehow/code/dw/backend/app/schemas/token_runtime.py)
  - [character_runtime.py](/Users/haoli/leehow/code/dw/backend/app/schemas/character_runtime.py)
  - [combat_runtime.py](/Users/haoli/leehow/code/dw/backend/app/schemas/combat_runtime.py)
- 统一 normalize/validate 入口：
  - [runtime_schema_service.py](/Users/haoli/leehow/code/dw/backend/app/services/runtime_schema_service.py)
- 前端镜像类型唯一入口：
  - [runtime.ts](/Users/haoli/leehow/code/dw/frontend/app/types/runtime.ts)

## Token Runtime

核心字段：

- `active_effects`
- `active_auras`
- `transformation_data`
- `concentration_spell`
- `casting_in_progress`
- `death_saves`
- `disguise_data`

主链接入：

- [tokens.py](/Users/haoli/leehow/code/dw/backend/app/api/routes/tokens.py)
- [spell_cast.py](/Users/haoli/leehow/code/dw/backend/app/api/routes/spell_cast.py)
- [combat.py](/Users/haoli/leehow/code/dw/backend/app/api/routes/combat.py)

补充口径：

- `active_auras` 不再只是地图可视化元数据；当前也承载 moving aura 的机械真相层，
  包括半径、阵营过滤、条件免疫、modifier、bonus damage、selected targets 等 aura
  runtime 片段。
- `aura_service.py` 负责把 source token 的 `active_auras` 重算成目标 token 的
  `aura_applied active_effects`，战斗与法术结算统一消费后者。

## Character Runtime

核心字段：

- `class_feature_uses`
- `status_effects`
- `spell_slots_state`
- `hotbar`
- `currency`
- `equipment`

主链接入：

- [character_action_service.py](/Users/haoli/leehow/code/dw/backend/app/services/character_action_service.py)
- [characters.py](/Users/haoli/leehow/code/dw/backend/app/api/routes/characters.py)
- [spell_cast.py](/Users/haoli/leehow/code/dw/backend/app/api/routes/spell_cast.py)
- [combat.py](/Users/haoli/leehow/code/dw/backend/app/api/routes/combat.py)

## Combat Runtime

核心字段：

- 攻击结果摘要
- 移动结果摘要
- 当前回合运行态
- 战斗存储核心片段

主链接入：

- [campaign_storage.py](/Users/haoli/leehow/code/dw/backend/app/api/routes/campaign_storage.py)
- [combat.py](/Users/haoli/leehow/code/dw/backend/app/api/routes/combat.py)

## 宽校验策略

- Phase 3 维持 `extra="allow"` 的宽 schema 原则，先稳住边界与兼容性。
- 字段裁剪与严格收缩不在本轮执行范围。
- 新增高频 runtime 字段必须先入 schema，再进入 route/service 主链写回。

## 验收门槛

- touched files `python -m py_compile`
- focused pytest（runtime_schema_service + 对应 route/service）
- 前端 typecheck（`runtime.ts` 消费链无新增 `any` 漏口）
