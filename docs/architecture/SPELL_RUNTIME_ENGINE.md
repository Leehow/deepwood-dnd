# Spell Runtime Engine

**创建时间**：2026-03-23<br>
**适用范围**：`spells.json`、`/api/spells/cast`、`/api/spells/runtime-actions/execute`、地图 token runtime 展示、Hex 纵向试点

## 1. 这轮改动解决什么问题

旧法术系统的真实状态是：

- `frontend/app/data/rules/spells.json` 是唯一法术规则源
- 前后端共享 `effects` pipeline 形状
- 但运行时语义分散在 `spell_cast.py`、`combat.py`、`spell_resolver.py`、前端 `grantedActions.ts` 和 token JSON runtime 里
- 像 `脆弱诅咒（Hex）` 这种需要“选项持久化 + 标记 + 条件额外伤害 + 死亡后解锁转移 + token UI 展示”的法术，已经超出旧 token JSON 拼装模型的可维护边界

这轮重构引入了一个新的中心原则：

- `spells.json` 继续作为唯一规则源
- 活跃法术实例不再只散落在 token JSON 上，而是升级成后端一等 runtime 实体
- 前端继续围绕 token 展示，但展示内容改成后端投影出来的 runtime UI 字段
- 复杂法术优先通过通用 trigger / verb 编排，不再新增按 `spell_id` 写死的 handler

## 2. 新的真相层

新增模型：

- `backend/app/models/spell_runtime_instance.py`

表：`spell_runtime_instances`

核心字段：

- `campaign_id`
- `spell_id`
- `spell_name`
- `caster_token_id`
- `concentration_owner_token_id`
- `primary_target_token_id`
- `linked_target_token_ids`
- `selected_option`
- `params`
- `duration_rounds`
- `current_round`
- `expires_at_round`
- `status`
- `granted_actions`
- `host_entities`
- `ui_projection_version`

这张表是活跃法术的真相层，负责存储：

- 这个法术实例是谁施放的
- 当前主要目标是谁
- 施法时选了哪个 `castOption`
- 运行时参数是什么
- 当前有哪些可用动作
- 是否仍处于 active 状态

token 不再承担这些语义的最终真相，只负责接收投影结果。

## 3. Token 展示投影

新增 schema：

- `backend/app/schemas/spell_runtime.py`

新增 token 投影字段：

- `spell_overlays`
- `spell_badges`
- `granted_actions_ui`
- `attached_runtime_refs`

这些字段通过 `spell_runtime_service.build_token_spell_projection_map()` 投影出来，并通过 realtime `token_update` 推给前端。

这意味着前端不需要再自行推导：

- 某个转移动作当前能不能显示
- 某个 token 身上的法术标签该怎么拼
- 某个 granted action 到底来自静态 JSON 还是运行时实例

前端只负责：

- 展示 token overlay / badge
- 展示 runtime action
- 收集施法或动作执行所需的目标/选项输入

地图 token 左下角的小法术状态图标现在也优先读取这套投影：

- `spell_badges + spell_overlays` 是 runtime spell 的唯一显示真相源
- 旧 `active_effects/spell_buff` 只保留给兼容期内的规则状态、老法术和非 runtime 语义
- 当同一个 runtime spell 同时存在旧 `spell_buff` 与新 `spell_badges` 时，前端会抑制旧图标，避免顶部 overlay 与底部小图标不同步

## 4. 统一 runtime 服务

核心服务：

- `backend/app/services/spell_runtime_service.py`

当前已经落地的职责：

- 判断某个法术是否走新 runtime 引擎：`spell_uses_runtime_engine()`
- 解析基于 slot level 的持续时间：`resolve_spell_duration_rounds()`
- 审计 `spells.json` 当前使用到的 trigger / verb 是否都被执行层支持：`audit_spell_pipeline_support()`
- 创建活跃法术实例：`create_runtime_spell_instance()`
- 生成 token 投影：`build_token_spell_projection_map()`
- 推送投影更新：`publish_runtime_projection_updates()`
- 为属性检定等流程提供 runtime modifier：`get_token_runtime_modifier_effects()`
- 为攻击结算提供 runtime 条件额外伤害：`get_runtime_bonus_damage()`
- 在目标倒地/死亡时驱动 runtime 变化：`notify_target_downed()`
- 执行 granted runtime action：`execute_runtime_action()`
- 在专注结束时关闭 runtime 实例：`end_concentration_runtime_instances()`
- 对 `create_moving_aura` 这类 effect verb，把 spell runtime 同步到 token
  `active_auras`，再由 `aura_service.py` 下发成 aura-applied `active_effects`

## 5. 新 JSON 能力边界

当前 spell runtime engine 明确维护一组支持列表：

- trigger registry
- verb registry

本轮先纳入并用于 Hex 试点的关键 trigger：

- `on_cast`
- `on_hit`
- `on_weapon_hit`
- `on_target_downed`
- `on_concentration_end`
- `on_action_invoked`

本轮先纳入并用于 Hex 试点的关键 verb：

- `apply_mark`
- `conditional_extra_damage`
- `grant_disadvantage`
- `grant_action`
- `retarget_mark`
- `set_runtime_param`
- `clear_runtime_param`
- `end_spell_instance`

同时保留了对更多通用 verb 的注册支持，用于后续把更多法术迁移进 runtime engine。

重要边界：

- 这还不是“任何 JSON 都能自动执行”的纯解释器
- 它是“唯一规则源 + 白名单 trigger/verb + 运行时实例 + token 投影”的声明式编排器
- moving aura 现在已经进入统一 runtime 边界，但像“动作触发治疗”或“命中后反制效果”
  这类更强的 aura trigger 仍然需要按 combat/runtime action 接口继续接入

## 6. Hex 作为首个纵向试点

本轮把 `frontend/app/data/rules/spells.json` 里的 `hex` 升级为 runtime-v2 法术：

- 新增 `runtime.engine = "v2"`
- 新增基于 slot level 的 `durationBySlotLevel`
- 把“属性选择”升级为正式 `castOptions`
- 每个 option 都在 `on_cast` 上声明：
  - `apply_mark`
  - 带 ability 条件的 `grant_disadvantage`
- 在基础 effects 中声明：
  - `grant_action`：转移诅咒
  - `conditional_extra_damage`
  - `on_target_downed -> set_runtime_param(transfer_available=true)`
  - `on_action_invoked -> retarget_mark`
  - `on_concentration_end -> end_spell_instance`

现在 Hex 的关键语义已经闭环：

- 初次施法时必须手选属性
- 被诅咒目标在对应属性检定上承受劣势
- 施法者命中被诅咒目标时追加黯蚀伤害
- 目标死亡后，runtime action 才会显示“转移诅咒”
- 转移不重新施法，不重置持续时间，只重定向当前 runtime instance
- token 上可以看到法术 overlay/badge

## 7. 当前接入点

后端：

- `backend/app/api/routes/spell_cast.py`
  - 新施法链会为 runtime-v2 法术创建 `spell_runtime_instances`
  - 专注被替换或中断时会同步结束 runtime instance
- `backend/app/api/routes/combat.py`
  - 普通攻击与法术攻击都能消费 runtime 条件额外伤害
- `backend/app/api/routes/tokens.py`
  - 专注清除、专注失败等路径会同步结束 runtime instance

前端：

- `frontend/app/components/spell/SpellCastActions.tsx`
  - `castOptions` 改成必须显式选择，避免默认落到第一个属性
- `frontend/app/utils/grantedActions.ts`
  - 开始优先消费 runtime granted actions
  - 对已附着 runtime ref 的法术，抑制旧的静态 JSON granted action 入口
- `frontend/app/components/map/SelectionContextMenu.tsx`
  - 支持 runtime action 入口与目标传递
- `frontend/app/components/hotbar/Hotbar.tsx`
  - 支持读取 token runtime action / attached runtime refs
- `frontend/app/components/map/TokenComponent.tsx`
  - 支持显示 runtime overlay badge
- `frontend/app/components/map/hooks/useMapSidebarSpellController.ts`
  - 可调用 `/api/spells/runtime-actions/execute`

## 8. 迁移口径

当前采用双轨迁移，而不是大爆炸替换：

- 旧 `concentration_spell` / `active_effects` 仍然保留兼容读取
- 新的复杂持续法术优先接入 `spell_runtime_instances`
- 前端逐步从“自己解释法术动作”迁移到“显示后端投影动作”

这意味着当前系统是：

- 旧 runtime 兼容层仍在
- 新 runtime engine 已可承接首个复杂试点
- 后续法术应优先复用通用 trigger / verb，而不是新增 spell-specific handler

当前已经明确收口的一条规则：

- `变巨 / 缩小术` 不再允许走旧的地图 special action 或 `/tokens/{id}/transform`
  快捷链；统一施法链是唯一入口。
- `易容术 / 伪装术` 这类外观幻术的首次施放，也已经并回统一
  `/api/spells/cast`；旧 `/tokens/{id}/disguise` 只保留为施法后的宿主编辑/解除入口，
  不再承担初次施法。
- `朦胧术 / 隐形术 / 镜影术` 这类视觉型 spell effect 已不再由前端直接读取
  `active_effects.tokenFilter` 渲染；地图改为统一读取后端投影的 `spell_visuals`。
  `active_effects.tokenFilter` 仍可作为兼容输入存在，但只允许后端投影层读取，
  不再允许新增任何前端直读或 spell-specific 渲染分支。

## 9. Structured Zone Settlement Bridge

`蛛网术 / 油腻术 / 月华之光` 这类持续区域控制法术，还没有整体迁进
`spell_runtime_instances`，但这一轮先把最容易断链的“区域结算时机”收回了统一
`effects` 语义：

- `frontend/app/components/map/hooks/useMapTokenDragController.ts`
  - 进入区域时发送 `timing="enter"`
  - 回合开始时发送 `timing="start_turn"`
  - 回合结束时发送 `timing="end_turn"`
- `backend/app/api/routes/combat.py`
  - `POST /api/combat/zone-spell-settle` 新增 `timing`
  - 对已经在 `spells.json` 声明 `on_enter_zone / start_of_target_turn / end_of_target_turn`
    的法术，优先按 phase trigger 结算，而不是只看旧 `controlEffect`
- `backend/app/services/spell_resolver.py`
  - 对同一 `spell_id + source_token_id + condition` 的重复区域状态改成覆盖式写入，
    防止区域持续结算把同一控制效果无限叠加
- `frontend/app/components/map/ZoneSpellSettlementModal.tsx`
  - 手动环境结算入口现在也支持选择“进入 / 回合开始 / 回合结束”
  - 非专注但仍然挂在 `active_effects` 上的区域法术，也重新出现在 DM 的手动结算列表里
- `frontend/app/data/rules/spells.json`
  - `蛛网术 / 油腻术` 已移除旧 `controlEffect` 和 `zoneEffects.settlement`
  - 这两个法术的结算时机、状态名称、挣脱提示都改为直接从 structured `effects` 推导

这意味着当前区域法术进入了一个“桥接阶段”：

- 规则仍然来自 `spells.json`
- 执行入口暂时还在旧 `/api/combat/zone-spell-settle`
- 但结算时机已经开始回到共享 `effects` trigger，而不是继续把每个区域法术的时机写死在前端/route 分支里

这一步还不是完整 runtime 化，但已经先解决了最容易出现的断链：

- `进入区域` 和 `回合开始/结束` 混用导致时机错乱
- `蛛网术 / 油腻术` 这类 spell phase 明明已写进 JSON，却仍然被旧 `zoneEffects.settlement`
  模糊映射吞掉
- 重复区域结算把同一控制状态越挂越多

下一步如果继续收这条线，优先顺序应是：

- 把 `ongoing_save` 从 `combat.py` route 分支迁成共享 runtime phase
- 把区域法术实例本身从 `concentration_spell.area_effect / active_effects.area_effect`
  抬升成正式 runtime host entity
- 让 `zone-spell-settle` 只保留为 runtime trigger 的 transport 入口，而不是继续承载大块规则判定

## 10. 当前仍然刻意保留的限制

这一轮还没有试图一次性统一所有法术执行入口。

当前仍然保留的现实边界：

- area / zone / summon / illusion 等宿主型法术还未全面迁入新 runtime engine
- `notify_target_downed()` 当前仍然是“面向通用 trigger 的轻量实现”，不是完整相位执行器
- combat 旧链路、token 旧 runtime 字段与前端部分兼容逻辑仍然存在

这不是倒退，而是迁移策略的一部分：先用 Hex 打通纵向主链，再把更多复杂法术逐批迁移。

## 11. 本轮最小验收

已执行的聚焦校验：

- `python -m py_compile` 覆盖本轮主要后端文件
- `cd backend && PYTHONPATH=. pytest --noconftest tests/unit/test_spell_runtime_service.py`
- `cd backend && PYTHONPATH=. pytest --noconftest tests/unit/test_zone_spell_settlement_timing.py`
- `cd frontend && npm run typecheck`
- `cd frontend && npx vitest run tests/hooks/useMapTokenDragController.test.ts tests/utils/grantedActions.test.ts`

其中 `tests/unit/test_spell_runtime_service.py` 负责保护：

- Hex runtime trigger / verb 已被注册支持
- Hex runtime 元数据与按槽位持续时间正确
- Hex 转移动作的显示条件受 runtime params 控制
