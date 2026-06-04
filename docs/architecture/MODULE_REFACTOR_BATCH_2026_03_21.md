# Module System 下一批重构设计

**制定时间**：2026-03-21  
**目标范围**：`backend/app/api/routes/module_chat.py`、`backend/app/api/routes/modules.py`、`frontend/app/components/map/TacticalMap.client.tsx`  
**当前批次重点**：先把 `module_chat.py` 中 `create-entity` 的主流程继续从 route 拆到 usecase/service 层，并顺手把遭遇创建/落图执行抽出独立 usecase

---

## 0. 当前完成状态（2026-03-21 夜间更新）

这份设计文档对应的第一批实现已经落地，当前已完成：

- Phase 3 的第一批平台化工作已开始反向托底 TacticalMap 和模组链：
  - 后端已新增 token / character / combat runtime schema
  - 前端已新增 `campaign / character / combat / module` 四组 query hooks
  - TacticalMap、CharacterPanel、campaign shell 相关旧 cache 已开始退化成 QueryClient 包装层
  - `drawingsRefresh` 已从 raw DOM 事件切成 `drawingsRefreshVersion` 显式刷新链

- `/create-entity` 的 `npc / monster / shop / item` 收进 `module_chat_usecase_service.py`
- `/create-entity` 的 `encounter` 批量怪物创建与 token 放置收进 `module_encounter_usecase_service.py`
- `/execute-map-encounter` 的结构化区域落图执行收进 `module_encounter_usecase_service.py`
- route 中旧的 `match_monster_by_name` 和 `_search_module_item` 已移除
- `module_chat.py` 的热点已经从“直接实体创建”推进到“encounter planning / AI 编排链”
- `modules.py` 的 `get / export / import` payload 组装已收进 `module_snapshot_service.py`
- `modules.py` 的 `embed / embed status / delete embeddings` 已收进 `module_task_flow_service.py`
- `modules.py` 的 `extract-monsters / extract-items` SSE 包装已收进 `module_extraction_stream_service.py`
- `modules.py` 的 parse task 查询/停止已收进 `module_parse_task_service.py`
- `modules.py` 的语言检测、翻译决策与 parsed module upsert 已开始收进 `module_parse_flow_service.py`
- `modules.py` 的 translate SSE 与单章节翻译已收进 `module_translation_service.py`
- `modules.py` 的 websocket parse 入口头部 task 初始化也开始收进 `module_parse_task_service.py`
- `modules.py` 的 websocket parse 主流程（OCR、图片分类、解析编排与持久化）与 `/ws/parse-v2` 入口边界已收进 `module_parse_websocket_service.py`
- `/ws/parse/{file_id}` 与 `/ws/parse-v2/{file_id}` 的失败/停止 task 状态写回也已收进 `module_parse_websocket_service.py`
- `backend/tests/unit/test_module_parse_websocket_service.py` 已补 fresh PDF / resumed / missing-file / parse-v2 / task-failure 几类单测
- 本批 websocket parse focused backend 回归通过 `22 passed, 1 warning`
- 当前模组线更大一组 focused backend 回归仍保持 `116 passed, 1 warning`
- `TacticalMap.client.tsx` 第一批 controller extraction 已落地：
  - `useMapCombatOverlays.ts` 收走 movement overlay、attack distance line、monster action targeting 与 monster action cursor info
  - `useMapViewportController.ts` 收走 viewport bounds、visible tokens、player companions、zoom avatars 与伙伴 monster_data 预取
  - `mapInteractionUtils.ts` 已收走 selection/context menu 里的 grid 坐标换算、clicked token 判定、玩家 source token 解析与 combat turn gate
  - `useMapInteractionController.ts` 已继续收走 `context menu / long-press / shop-chest modal / interaction resource loading`
  - `useMapTokenInteractionController.ts` 已继续收走 `token select/open/external select` 主控制链
  - `useMapTokenDragController.ts` 已继续收走 token drag 持久化、移动力限制与 zone spell settle 检查
  - `useMapInventoryController.ts` 已继续收走 `item / loot bag / shop token` 这一组异步 inventory 编排
  - `useMapPlacementController.ts` 已继续收走 `place shop / place character / place my token` 这组放置编排
  - `useMapPlayerActionController.ts` 已继续收走 `player move / cast spell / use ability / toggle reaction` 这组玩家动作处理器
  - `useMapStatusController.ts` 已继续收走 `status effect / concentration / ritual casting / casting confirm` 这组状态与确认编排
  - `useMapFocusController.ts` 已继续收走 `minimap navigate / focus token / focus players / anchor jump-clear / avatar click` 这组视角与定位动作
  - `useMapMarkerController.ts` 已继续收走 marker 选中、创建、删除与 marker dialog 状态
  - `useMapViewStateController.ts` 已继续收走 viewport globals、resize、视野状态保存与 beforeunload flush
  - `useMapDueCastResolution.ts` 已继续收走到时施法自动结算与去重触发
  - `useMapCombatRuntimeController.ts` 已继续收走手动反应模式、反应消费后的自动清理、初始回合读取与 active turn 实时跟踪
  - `useMapUiChromeController.ts` 已继续收走 touch-device 检测、right offset 计算与 DM bubble 生命周期
  - `useMapExternalSyncController.ts` 已继续收走角色 feature uses 同步与 roll modifier 外部事件同步，并继续把 `openTokenParamsEditor / tokenHPUpdate / selectTokenByCharacterId / selectCharacterFromMap / removeCharacterTokens / focusOrCreateToken` 这组地图与面板外部桥接也收进同一个 controller
  - `useMapTerrainController.ts` 已继续收走 terrain 本地更新、debounced 持久化与 terrain 广播
  - `useMapTouchGestureController.ts` 已继续收走 native touch listener、iOS gesture pinch 与 ruler multi-touch 手势桥接
  - `useMapTargetingController.ts` 已继续收走 hotbar targeting ESC 取消、hovered token、cursor distance 与 targeting token select
  - `mapTargetingUtils.ts` 已继续收走 hotbar range fallback、range band 判定与 spell range 解析
  - `useMapAreaSpellController.ts` 已继续收走 area spell 的状态机、目标高亮派生、落点确认和 ready-to-cast 判定
  - `useMapAreaSpellPersistence.ts`、`mapAreaSpellRuntimeUtils.ts`、`mapAreaSpellCombatPayload.ts`、`mapAreaSpellCastPrelude.ts`、`useMapAreaSpellNonCombatController.ts`、`useMapAreaSpellResultController.ts`、`useMapAreaSpellCombatDispatchController.ts`、`mapAreaSpellCombatDispatchUtils.ts`、`mapAreaSpellCombatPreparation.ts` 与 `useMapAreaSpellCastExecutionController.ts` 已继续把 `handleAreaSpellCast` 中重复的法术位持久化、持续区域 effect payload、幻术 token payload、caster/targets/request builder、source effect 预处理、utility/empty-ground 前半段分支，以及 control-effect 写回、`spell-area` request dispatch、toast/sound/dice lifecycle、错误分支与高层 execution orchestration 从主组件里收出去
  - `useMapSpellCombatDispatchController.ts`、`mapSpellDispatchUtils.ts`、`mapSpellCombatPreparation.ts`、`mapSpellRangeUtils.ts`、`useMapSpellActionController.ts`、`useMapSidebarSpellController.ts`、`useMapReactionSpellController.ts`、`useMapSupportActionController.ts`、`useMapTargetSaveEffectController.ts`、`useMapBonusActionActivationController.ts`、`useMapBonusActionRoutingController.ts`、`useMapFeatureAdminController.ts`、`useMapManeuverController.ts`、`mapInvokeDuplicityUtils.ts`、`useMapInvokeDuplicityController.ts`、`useMapClericDomainActionController.ts`、`useMapTrickeryLightActionController.ts`、`useMapReadThoughtsActionController.ts`、`useMapChannelDivinityActionController.ts` 与 `useMapBonusUtilityActionController.ts` 这轮继续把单体 `handleSpellAction`、sidebar spell 监听、`Dampen Elements / Wrath of the Storm` 这组 reaction-spell callback、`Preserve Life / Knowledge of the Ages / Visions of the Past / tool check` 这组 support-action modal callback、`target_save_effect` 这类 bonus-action/save-effect 分支、通用资源扣减/旧 `class_feature_uses` 回写/持续效果激活/行动经济广播这条 generic bonus-action activation 链、以及 `transform / execution.openEvent / support-action / domain-action / trickery-light / read-thoughts / channel-divinity` 这整层 special-route 分发链、`effect duration / action uses / ranger ability toggle` 这组地图内状态编辑链、Battle Master 的 `prepared / trigger / secondary-effect` 战技主链、`Invoke Duplicity` 的打开校验/placement/create 流、`Warding Flare / Guided Strike / War God's Blessing / Destructive Wrath` 这组 cleric domain action、`Cloak of Shadows / Blessing of the Trickster / Radiance of the Dawn / Corona of Light` 这组 trickery/light action、`Read Thoughts -> Suggestion` 的二段施放、`Charm Animals and Plants / Master of Nature / Turn Undead` 这组 channel-divinity 主链，以及 `instant self-heal / bardic inspiration` 这组 bonus-action utility 主链从主组件里收出去，并继续把 `combatBonusActionResult` 接回 typed bus；`actionEffectHandlers.ts` 这一轮也把 data-driven bonus action 效果的残余 producer 切到 `publishAppEvent()`
  - `useMapManeuverController.ts` 这一轮还把 Battle Master 的 `superiority_dice` 消耗同步切到 `classFeatureUsesUpdated` typed bus，让战技骰和前面已经收好的 feature-use 更新走同一条边界
  - `useMapExternalSyncController.ts` 这轮继续把本地 feature uses 同步从 `characterFeatureUsesUpdated` 的裸 DOM 监听切回了 typed bus 的 `classFeatureUsesUpdated`
  - `useMapSupportActionController.ts` 这一轮继续补上 `openKnowledgeOfTheAgesModal / openVisionsOfThePastModal` 两个 opener，把 support-action 的 modal 打开与建议焦点派生也从 `handleBonusAction` 里抽成独立边界
  - `BagDialog.tsx` 与 `Hotbar.tsx` 这一轮继续把 `hotbar-add-item / hotbar-drop-to-slot` 切到 typed bus，让背包拖拽和“添加到快捷栏”的桥接不再依赖 raw DOM 事件
  - `openEventBridge.ts`、`FeatureDetailDialog.tsx` 与 `useMapBonusActionRoutingController.ts` 这一轮继续统一 `execution.openEvent` 的桥接规则，让 wild shape / recovery 这组 opener 优先走 typed bus，未知事件才回退 legacy DOM
  - `ClassicCharacterCard.tsx` 这一轮继续把 `equipmentConsumableUse` 的 producer 切到 typed bus，让角色卡的消耗品使用桥接先离开 raw DOM 直发，同时保留对旧 `CharacterPanel` listener 的兼容
  - `LevelUpNotification.tsx` 这一轮继续把 `characterLevelUp` 的 clean consumer 切到 `subscribeAppEvent()`，让升级提示链也开始从 legacy DOM 转向 typed bus
  - `characterBubble.ts` 与 `diceRequestBubble.ts` 这一轮继续把角色气泡、回复消息、私信启动和 DM 骰子请求这组 util 事件桥切到 typed bus，让聊天/投骰辅助链离开 raw DOM 事件
  - `CombatActionModal.tsx` 这一轮继续把 `openCombatActionModal` 的 clean consumer 切到 `subscribeAppEvent()`，让战斗动作弹窗这条链也开始从 legacy DOM 转向 typed bus
  - `sidebarCasting.ts`、`useUnreadChat.ts` 与 `characterResourcesCache.ts` 这一轮继续把 `spellCastStarted`、`ws-chat-message` 与 `classFeatureUsesUpdated` 的 clean producer/consumer 切到 `publishAppEvent()/subscribeAppEvent()`，让长施法起始、未读聊天和角色资源缓存失效离开 legacy DOM 监听，同时继续兼容旧事件名
  - `TacticalMap.client.tsx` 这一轮也把 `anchorPlaced` 的 producer 切到 `publishAppEvent()`，让锚点设置后的 DM 侧联动离开 raw DOM 直发，同时继续兼容旧 listener
  - `campaignRealtimeBridge.ts` 这一轮也把 `combatStorageUpdated / combatStorageDeleted` 的 producer 切到 `publishAppEvent()`；DM/Player route 侧的 `ws-chat-message / sidebarSpellCast / characterLevelUp / tokenHPUpdate` 这几条 clean producer 也开始改走 typed bus，让战役 realtime bridge 和 hotbar 施法桥接少依赖 raw DOM 直发
  - `useMapTransformationController.ts` 后续已继续收口成纯变形 controller；旧的 `handleEnlargeReduceApply`、对应 modal state、地图右键入口和 `EnlargeReduceModal.tsx` 已删除，`变巨 / 缩小术` 只保留统一施法链
  - `useCampaignHotbarBindings.ts` 这一轮也把 `arcaneRecoveryTarget / flexibleCastingTarget / naturalRecoveryTarget` 从裸 DOM 监听切回 `subscribeAppEvent()`，让 TacticalMap 的 `execution.openEvent` 和 campaign-shell hotbar recovery modal 走同一条 typed bus 边界
  - `useMapAttackResultController.ts` 这一轮继续把本地攻击结果 bubble、怪物 DM bubble、`combatAttackResult / combatBonusAttackGranted / promptDivineSmite` 事件发布与 auto-apply HP 写回从 `TacticalMap.client.tsx` 中收成独立 controller；`useMapWebSocket.ts` 也开始把 `combatAttackResult / combatReactionUsed` 改走 `publishAppEvent()`，同时 `CombatPanel.tsx` 与 `useCampaignHotbarBindings.ts` 已切到 `subscribeAppEvent()` 订阅这批攻击结果和 divine smite prompt 边界
  - `useMapMonsterActionController.ts` 与 `mapMonsterActionUtils.ts` 这一轮继续把怪物攻击的命中加值/伤害/射程解析、目标防御快照、`executeMonsterAttack` 请求构造、超射程确认与 `startMonsterAreaAction` 分发从 `TacticalMap.client.tsx` 中收成独立边界，让 `handleSelectionMonsterAction / executeMonsterAttack` 这对高重复链统一收口
  - `useMapAttackEntryController.ts` 与 `mapAttackEntryUtils.ts` 这一轮继续把普通攻击和 blind attack 的共享入口收成独立 entry 层，把 source/target 解析、射程/弹药/附赠动作校验、grapple/shove 分流、roll modifier 清理和 blind miss chat 统一到一个边界里，并顺手清掉了 `SelectionContextMenu.tsx` 里几处旧 `showToast` CustomEvent
  - `useMapWeaponAttackPreparationController.ts` 与 `mapWeaponAttackPreparationUtils.ts` 这一轮继续把 `handleAttackAction` 前半段的攻击资源消耗、目标防御/装备快照、宿敌/幸运/偷袭资格判定、优势/劣势推导和 `attackRequest` 组装收成独立 preparation 层，让武器攻击主链不再同时承担读取、规则推导与请求构造
  - `useMapWeaponAttackExecutionController.ts` 这一轮继续把 `POST /api/combat/attack`、投骰提示、音效、战技命中后续、`combatActionUsed`、GWM 额外攻击、Paladin Divine Smite prompt、HP 自动写回与 cleanup 尾链从 `handleAttackAction` 里抽成独立 execution controller，让武器攻击真正开始形成 `preparation -> execution -> result -> cleanup` 的分层结构
  - `useMapWeaponAttackCleanupController.ts` 这一轮继续把玩家武器攻击命中后的临时 buff 清理、弹药消耗、投掷武器落地与 `Cloak of Shadows` 收尾从 `handleAttackAction` 里抽成独立 cleanup controller，让攻击主链进一步聚焦在请求和结果编排
  - `useMapModalData.ts` 已继续收走 chest/shop/item/note/illusion 这批 modal 派生数据
  - `MapActionMenus.tsx` 已把 DM context menu、mobile action modal、DM token menu、player context menu 抽成独立 render layer
  - `MapTargetingHud.tsx` 已把 hotbar / monster action / area spell / invoke duplicity 这批 targeting HUD 与浮层距离提示抽成独立 render layer
  - `MapTargetingOverlayLayer.tsx` 已把 hotbar / monster action range overlay、invoke duplicity 预览与 area spell targeting canvas overlay 抽成独立 render layer
  - `MapTargetingOverlayLayer.tsx` 这一轮继续接管了 `attackDistanceLine` 的运行时虚线与距离文案，`TacticalMap.client.tsx` 中原先那段内联 targeting canvas 叠层已经删掉
  - `useMapAreaSpellRuntimeController.ts` 这一轮继续收走了 `startBreathWeapon / startMonsterAreaAction / touch preview` 这组三个 area spell 运行时副作用
  - `MapSelectionMenuLayer.tsx` 已把 `SelectionContextMenu` 的派生 props、reaction attack 编排与 `layOnHandsTarget / combatReactionUsed` typed bus 桥接抽成一层
  - `MapPlayerSpellDialog.tsx` 已把玩家施法弹窗的法术位数组、专注/施法中、silence 与 feat 派生收成独立 bridge
  - `MapStatusDialogs.tsx` 已把专注规则、仪式施法、状态效果说明、施法/专注确认这批 info/status dialog 收成独立 render layer
  - `MapMarkerAndConfirmDialogs.tsx` 已把 marker 创建、marker 选中操作、range/move confirm 收成独立 render layer
  - `MapSpecialActionDialogs.tsx` 已把 shop/chest/transformation/enlarge/domain action/tool-check/zone settlement 这批 modal 装配层收成独立桥接组件
  - `MapTokenLayer.tsx` 已把 token render list、marker layer 与 anchor overlay 从主组件里独立出来
  - `__selectToken / handleTokenSelect` 里的 source token 加载与菜单清理已开始复用 controller helper
  - `useMapEvents.ts / useMapInteractionController.ts / TacticalMap.client.tsx` 这轮又把 `openShop/openChest/chestOpen/combatActionUsed` 这一批地图交互事件收进了 `appEventBus`
  - `TacticalMap.client.tsx` 这轮继续把 `spellCastChat / consumeSpellSlot / characterEquipmentUpdated / classFeatureUsesUpdated / combatReactionUsed` 这一批剩余高频事件切到 `publishAppEvent()`，并把装备刷新监听改成 `subscribeAppEvent()`
  - `TacticalMap.client.tsx` 内部剩余的 `combatActionUsed` 直发点现已清零，行动/攻击/移动/疾走 这条高频事件链统一改走 typed bus
  - `SelectionContextMenu.tsx` 里的 chest 交互事件也已接回同一条 typed event bus
  - `token open` 现在也已改成单一路径执行，不再先走一遍泛化 click 再叠加具体 open 动作
  - `frontend/tests/hooks/useMapCombatOverlays.test.ts`、`frontend/tests/hooks/useMapViewportController.test.ts`、`frontend/tests/hooks/mapInteractionUtils.test.ts`、`frontend/tests/hooks/mapMenuUtils.test.ts`、`frontend/tests/hooks/mapTargetingUtils.test.ts`、`frontend/tests/hooks/useMapAreaSpellController.test.ts`、`frontend/tests/hooks/mapPlayerSpellDialog.test.ts`、`frontend/tests/hooks/mapStatusDialogs.test.tsx`、`frontend/tests/hooks/mapMarkerAndConfirmDialogs.test.tsx`、`frontend/tests/hooks/useMapInteractionController.test.ts`、`frontend/tests/hooks/useMapTokenInteractionController.test.ts`、`frontend/tests/hooks/useMapTokenDragController.test.ts`、`frontend/tests/hooks/useMapInventoryController.test.ts`、`frontend/tests/hooks/useMapModalData.test.ts`、`frontend/tests/hooks/useMapStatusController.test.ts`、`frontend/tests/hooks/useMapFocusController.test.ts`、`frontend/tests/hooks/useMapMarkerController.test.ts`、`frontend/tests/hooks/useMapViewStateController.test.ts`、`frontend/tests/hooks/useMapDueCastResolution.test.ts`、`frontend/tests/hooks/useMapCombatRuntimeController.test.ts`、`frontend/tests/hooks/useMapUiChromeController.test.ts`、`frontend/tests/hooks/useMapExternalSyncController.test.ts`、`frontend/tests/hooks/useMapTerrainController.test.ts`、`frontend/tests/hooks/useMapTouchGestureController.test.ts`、`frontend/tests/hooks/useMapTargetingController.test.ts`、`frontend/tests/hooks/useMapEvents.test.ts` 与 `frontend/tests/hooks/useMapData.test.ts`，以及 `frontend/tests/hooks/useUndoRedo.test.ts`、`frontend/tests/hooks/useChatMessages.test.ts` 和 `frontend/tests/events/appEventBus.test.ts` 已纳入当前 focused frontend 回归
  - 本轮新增 `frontend/tests/hooks/useMapAreaSpellRuntimeController.test.ts`、`frontend/tests/hooks/mapAreaSpellCastPrelude.test.ts`、`frontend/tests/hooks/useMapAreaSpellNonCombatController.test.ts`、`frontend/tests/hooks/mapAreaSpellRuntimeUtils.test.ts`、`frontend/tests/hooks/useMapAreaSpellPersistence.test.ts`、`frontend/tests/hooks/mapAreaSpellResultUtils.test.ts`、`frontend/tests/hooks/useMapAreaSpellResultController.test.ts`、`frontend/tests/hooks/mapAreaSpellCombatDispatchUtils.test.ts`、`frontend/tests/hooks/useMapAreaSpellCombatDispatchController.test.ts`、`frontend/tests/hooks/mapAreaSpellCombatPreparation.test.ts`、`frontend/tests/hooks/useMapAreaSpellCastExecutionController.test.ts`、`frontend/tests/hooks/mapSpellDispatchUtils.test.ts`、`frontend/tests/hooks/useMapSpellCombatDispatchController.test.ts`、`frontend/tests/hooks/mapSpellCombatPreparation.test.ts`、`frontend/tests/hooks/mapSpellRangeUtils.test.ts`、`frontend/tests/hooks/useMapSpellActionController.test.ts`、`frontend/tests/hooks/useMapSidebarSpellController.test.ts`、`frontend/tests/hooks/useMapReactionSpellController.test.ts`、`frontend/tests/hooks/useMapSupportActionController.test.ts`、`frontend/tests/hooks/useMapTargetSaveEffectController.test.ts`、`frontend/tests/hooks/useMapBonusActionActivationController.test.ts`、`frontend/tests/hooks/useMapBonusActionRoutingController.test.ts`、`frontend/tests/hooks/useMapFeatureAdminController.test.ts`、`frontend/tests/hooks/useMapManeuverController.test.ts`、`frontend/tests/hooks/useMapAttackResultController.test.ts`、`frontend/tests/hooks/mapMonsterActionUtils.test.ts`、`frontend/tests/hooks/useMapMonsterActionController.test.ts`、`frontend/tests/hooks/mapAttackEntryUtils.test.ts`、`frontend/tests/hooks/useMapAttackEntryController.test.ts`、`frontend/tests/hooks/useMapWeaponAttackPreparationController.test.ts`、`frontend/tests/hooks/mapWeaponAttackPreparationUtils.test.ts`、`frontend/tests/hooks/useMapWeaponAttackExecutionController.test.ts`、`frontend/tests/hooks/useMapWeaponAttackCleanupController.test.ts`、`frontend/tests/hooks/useMapExternalSyncController.test.ts`、`frontend/tests/hooks/useMapInvokeDuplicityController.test.ts`、`frontend/tests/hooks/useMapClericDomainActionController.test.ts`、`frontend/tests/hooks/useMapTrickeryLightActionController.test.ts`、`frontend/tests/hooks/useMapReadThoughtsActionController.test.ts`、`frontend/tests/hooks/useMapChannelDivinityActionController.test.ts`、`frontend/tests/hooks/useMapBonusUtilityActionController.test.ts`、`frontend/tests/hooks/useMapTransformationController.test.ts`、`frontend/tests/hooks/useCampaignHotbarBindings.test.ts` 与 `frontend/tests/events/appEventBus.test.ts`，并把 `mapTargetingUtils.test.ts` 扩到 attack distance cursor presentation；这轮补上 attack entry controller 后，攻击入口/准备/执行/清理/结果 focused 回归通过 `7 files / 15 tests passed`
  - `npm run typecheck` 与这批 TacticalMap focused Vitest 仍保持通过

本批实现保持了原有 HTTP 路由、响应结构、数据库 schema 和 WebSocket 消息类型不变。

---

## 1. 为什么先做这一批

当前后端 route 级 realtime 直发广播已经全部收口到 `realtime_publisher.py`，下一阶段最值得投入的，不再是“清广播”，而是继续把超大文件里的**主流程编排**拆薄。

现在最大的 3 个持续热点是：

- `backend/app/api/routes/module_chat.py`
- `backend/app/api/routes/modules.py`
- `frontend/app/components/map/TacticalMap.client.tsx`

其中：

- `module_chat.py` 兼具 AI 交互、实体创建、地图规划、后台任务调度、消息持久化
- `modules.py` 兼具上传、解析、翻译、任务管理、导出、嵌入
- `TacticalMap.client.tsx` 仍然承担大量运行态控制逻辑

所以顺序应当是：

1. 先继续拆 `module_chat.py`
2. 再拆 `modules.py`
3. 当前已进入 `TacticalMap.client.tsx` 的 Phase 3，并先落第一批 controller extraction

---

## 2. 这批具体做什么

### 2.1 本批次已完成

把 `module_chat.py` 中 `/create-entity` 的以下分支抽到独立 usecase/service：

- `npc / monster`
- `shop`
- `item`
- `encounter`

并继续把 route 中残余的纯逻辑和后台任务迁出：

- 角色外观推断、怪物/章节匹配、螺旋排布、物品建模纯函数
- 模组头像后台生成任务
- `/execute-map-encounter` 的实体创建、token 放置与结果汇总

### 2.2 TacticalMap 第一批明确已做

- 视口与裁剪控制器抽出到 `useMapViewportController.ts`
- 战斗覆盖层控制器抽出到 `useMapCombatOverlays.ts`
- selection/context menu 的纯判定层抽出到 `mapInteractionUtils.ts`
- `context menu / long-press / shop-chest modal / interaction resource loading` 已抽到 `useMapInteractionController.ts`
- `token select/open/external select` 已抽到 `useMapTokenInteractionController.ts`
- `token drag` 持久化、移动力限制与 zone spell settle 检查已抽到 `useMapTokenDragController.ts`
- `item / loot bag / shop token` 异步 inventory 编排已抽到 `useMapInventoryController.ts`
- token render list、marker layer 与 anchor overlay 已抽到 `MapTokenLayer.tsx`
- `openShopTransaction / openChestInteraction / openChestManagement / chestOpen / combatActionUsed` 已开始统一走 `appEventBus`
- `attackDistanceLine / hotbarAttackExecute` 这一轮也开始统一走 `appEventBus`
- `monsterActionTargeting` 这一轮也开始统一走 `appEventBus`
- `startMonsterAreaAction` 这一轮也开始统一走 `appEventBus`
- `startBreathWeapon` 这一轮也开始统一走 `appEventBus`
- `combatMoveResult` 这一轮也开始统一走 `appEventBus`
- `tokenPerformedAction` 这一轮也开始统一走 `appEventBus`
- `manualReactionModeStart / manualReactionModeEnd / manualReactionModeChanged` 这一轮也开始统一走 `appEventBus`
- `combatMovementChanged / combatTurnChanged / combatTurnStarted` 这一轮也开始统一走 `appEventBus`
- `combatEndTurn / combatRestoreMovement` 这一轮也开始统一走 `appEventBus`
- `combatNewRound / combatTurnNotification` 这一轮也开始统一走 `appEventBus`
- `combatActionUsed` 这一轮的残余 producer/consumer 也开始统一走 `appEventBus`
- `mapTokenSelected / monsterAvatarUpdated` 这一轮也开始统一走 `appEventBus`
- `rollModifierUpdated` 这一轮也开始统一走 `appEventBus`
- `characterHPUpdated / transformationUpdate` 这一轮也开始统一走 `appEventBus`
- `characterActiveEffectsChanged` 这一轮也开始统一走 `appEventBus`
- `tokenPlaced / tokenRemoved / chestCreated / chestStateChanged` 这一轮也开始统一走 `appEventBus`，让地图 token 生命周期和宝箱状态同步离开 `ws:token_placed / ws:token_removed / chest*` 这组 legacy DOM 事件；已无 consumer 的 `characterFeatureUsesUpdated` 裸事件也已删除
- `monsterStatusEffectsChanged / characterStatusEffectsChanged / death_save_update` 这一轮也开始统一走 `appEventBus`
- `characterConcentrationChanged / characterCastingChanged` 这一轮的剩余 consumer 也开始统一走 `subscribeAppEvent()`
- `characterEquipmentUpdated` 这一轮的残余 producer/consumer 也开始统一走 `publishAppEvent()/subscribeAppEvent()`
- `classFeatureUsesUpdated` 这一轮的残余 producer/consumer 也开始统一走 `publishAppEvent()/subscribeAppEvent()`
- `spellSlotsChanged / restGrant` 这一轮也开始统一走 `publishAppEvent()/subscribeAppEvent()`
- `characterUpdated` 这一轮也开始统一走 `publishAppEvent()/subscribeAppEvent()`
- `SelectionContextMenu.tsx` 里的 chest 交互事件也开始统一走 `appEventBus`
- `SelectionContextMenu.tsx`、`FloatingTokenPanel.tsx` 与 `useMapCombatOverlays.ts` 已把攻击距离 hover 预览改成 `publishAppEvent()/subscribeAppEvent()`
- `FloatingTokenPanel.tsx` 与 `useMapCombatOverlays.ts` 已把怪物动作 targeting 预览改成 `publishAppEvent()/subscribeAppEvent()`
- `useMapMonsterActionController.ts` 与 `useMapAreaSpellRuntimeController.ts` 已把怪物范围技的分发桥改成 `publishAppEvent()/subscribeAppEvent()`
- `CharacterPanel.tsx`、DM/Player hotbar 与 `useMapAreaSpellRuntimeController.ts` 已把吐息武器的分发桥改成 `publishAppEvent()/subscribeAppEvent()`
- `TacticalMap.client.tsx` 与 `CombatPanel.tsx` 已把移动结果的分发桥改成 `publishAppEvent()/subscribeAppEvent()`
- `useMapWebSocket.ts` 与 `useMapTokenDragController.ts` 已把攻击/施法后的 zone-spell 触发桥改成 `publishAppEvent()/subscribeAppEvent()`
- `token open` 已收敛为单一路径执行，不再叠加泛化 click 分支
- `TacticalMap.client.tsx` 不再内联这一批 useEffect/useMemo/预取与部分 interaction 判定逻辑

### 2.3 下一批明确不做

- `/plan-map-encounter`、`/modify-encounter-plan` 的完整 usecase 化
- `/execute-map-encounter` 中 AI 解析规划文本的前半段
- `TacticalMap.client.tsx` 的 chest/shop modal 派生数据与 panel-body 大拆
- `handleAreaSpellCast` 的 combat request 发起、dice rolling 生命周期与成功/失败响应分发再继续拆薄

原因很简单：遭遇 planning 文本链同时交织 AI prompt 组织、消息持久化和模组上下文拼接，继续往前拆之前，先把实体创建和落图执行这条边界稳定住更划算；而 TacticalMap 这边现在已经拿下 overlays / viewport / interaction controller / token interaction controller / token drag controller / inventory controller / map interaction event bus 这几块切口，后面再顺着 chest/shop modal 派生数据和 panel-body 继续推会更稳。

---

## 3. 目标结构

### 3.1 新增/继续使用的 service

- `module_entity_service.py`
  - 放纯逻辑：外观推断、怪物匹配、章节搜索、螺旋位置、物品建模、token payload
- `module_avatar_generation_service.py`
  - 放后台头像生成副作用
- `module_chat_usecase_service.py`
  - 放 `/create-entity` 的 `npc / shop / item` 主流程编排
- `module_encounter_usecase_service.py`
  - 放 `/create-entity` 的 `encounter` 主流程和 `/execute-map-encounter` 的结构化落图编排

### 3.2 route 层目标

`module_chat.py` 中的 `/create-entity` 现在已经开始收敛成：

1. 校验 campaign / 请求参数
2. resolve module / preload preset data
3. 调用 usecase service
4. 返回 HTTP 响应

`module_chat.py` 中的 `/execute-map-encounter` 也已经进入同样的收敛方向：

1. 校验 module / 请求参数
2. 调 AI 把规划文本转成结构化 JSON
3. 加载 marker / preset 数据
4. 调 usecase service 执行实体创建和 token 放置
5. 返回 HTTP 响应

也就是说，route 不再自己直接承担：

- 分支优先级决策
- 物品/怪物复用与查找策略
- avatar 后台任务调度细节
- 批量怪物创建与 token 放置编排
- 实体创建后的广播编排

---

## 4. 兼容性约束

本批次必须保持以下约束不变：

- 不改 HTTP 路由路径
- 不改响应字段形状
- 不改 WebSocket 消息类型
- 不改数据库 schema
- 不改 `realtime_publisher` 的既有消息契约

---

## 5. 测试策略

### 5.1 已补测试

- `module_entity_service.py` 纯函数测试
- `module_avatar_generation_service.py` 异步副作用测试
- `module_chat_usecase_service.py` skip path / lightweight orchestration 测试
- `module_encounter_usecase_service.py` 的遭遇 payload 规范化、marker 坐标换算、遭遇创建 usecase、落图执行 usecase 测试
- 扩大后的 `realtime_publisher` 回归继续通过

### 5.2 本批次验收信号

完成后应满足：

- `module_chat.py` 的 `/create-entity` 和 `/execute-map-encounter` 明显缩短
- 纯逻辑 helper 不再留在 route
- `py_compile` 通过
- 相关 pytest 通过

---

## 6. 2026-03-21 深夜批次：`modules.py` 任务流收边界

在 `module_chat.py` 第一批落稳之后，`modules.py` 成为后端剩余最重的模组热点之一。它当前同时承担：

- 解析与翻译任务编排
- 向量化启动、进度追踪、状态查询、删除
- 怪物与物品抽取的 SSE 包装
- 导出/导入与兼容 payload 整形

其中“导出/导入与兼容 payload 整形”已经先落到 `module_snapshot_service.py`，而下面两条明显重复且副作用边界清晰的链也已经在这一轮落地：

1. `embed_module / get_embedding_status / delete_module_embeddings`
2. `extract_monsters / extract_items`

### 6.1 本批已落地

新增两层服务，把 route 中重复的任务流编排抽出来：

- `module_task_flow_service.py`
  - 管理 embedding 进度状态
  - 统一启动后台 embedding 任务
  - 统一构造 embedding status 响应
  - 统一做 module 存在性与 creator 约束检查

- `module_extraction_stream_service.py`
  - 统一 monster/item 抽取的 SSE 事件流包装
  - 统一 `progress / complete / error` 事件形状
  - 让 route 不再内联 `asyncio.Queue + task + yield` 这套样板

### 6.2 route 层结果

本批完成后，`modules.py` 中这几个 endpoint 应收敛为：

1. 校验 header / request body
2. 加载 `ParsedModule`
3. 调 service
4. 返回响应或 `StreamingResponse`

route 不再自己承担：

- `_embedding_progress` 的原地状态写入
- 嵌套 background coroutine 定义
- `extract_monsters/items` 的重复 SSE 事件生成器实现

### 6.3 当前验收结果

当前已经满足：

- `modules.py` 中 embedding 与 extraction 两条链明显缩短
- `_embedding_progress` 从 route 移出
- `extract_monsters` / `extract_items` 不再各自复制一套 SSE 包装
- `/ws/parse/{file_id}` 任务流已进一步收进 `module_parse_websocket_service.py`
- `py_compile` 通过
- `test_module_task_flow_service.py`、`test_module_extraction_stream_service.py`、`test_module_snapshot_service.py` 通过
- `tests/unit/test_module_*.py tests/unit/test_realtime_publisher.py` focused 回归通过

## 7. 完成本批后的下一步

完成这一批后，后续顺序固定为：

1. 把 `module_chat.py` 的 `plan-map-encounter / modify-encounter-plan / execute-map-encounter(AI parse 前半段)` 继续往 usecase 层收
2. `/ws/parse/{file_id}` 的失败回写与任务失败状态同步边界已收口并补齐单测；下一步转 `modules.py` 解析相关 translate 编排残留
3. 继续收拢 `modules.py` 的翻译编排残留
4. 继续推进 `TacticalMap.client.tsx` 的控制器拆分，下一刀优先继续收剩余散落 modal callback/side-effect 编排，再继续 panel-body

这样做能确保我们不是“哪里大就改哪里”，而是按边界稳定性从后端编排层一路推进到前端运行态热点。

## 8. 下一批设计：`parse / translate` 主流程收边界

在 `modules.py` 的 snapshot / embedding / extraction 任务流收口之后，下一段最值得继续下刀的是旧 `parse_raw_file_ws` 里的长主流程。当前它仍然同时承担：

- 任务查询/恢复判断
- OCR 后语言检测与翻译分支
- OCR 结果与翻译结果的状态落库
- parsed module 的 upsert 与 raw file 状态写回

### 8.1 当前已落地

这段已完成两层切片：

- `module_parse_task_service.py`
  - 管理 `task -> dict` 序列化
  - 统一 `get_parse_task / get_task_by_task_id / stop_parse_task`
  - 让 route 不再重复数据库/JSON 双路径查询与停止逻辑

- `module_parse_flow_service.py`
  - 管理 `detect + translate` 决策与进度映射
  - 管理 parsed module upsert 与 raw file 状态写回

- `module_parse_websocket_service.py`
  - 收进 `parse_raw_file_ws` 的编排主干：任务恢复、OCR、图片分类、翻译、解析与持久化
  - 保留 `task_created / resume / progress / complete / error` 现有消息形态，避免前端契约变更

### 8.2 本批兼容性约束

- 不改 websocket 路径
- 不改 websocket 消息类型
- 不改 parse task 返回字段
- 不改 `RawModuleFile / ParsedModule / ModuleParseTask` schema

### 8.3 当前验收结果

- `get_parse_task / get_task_by_task_id / stop_parse_task` 已不再内联 DB/JSON 双路径逻辑
- `parse_raw_file_ws` 的语言检测、翻译决策、OCR 快照落库、translated markdown 落库、parsed module upsert、图片分类与 OCR 分支编排已走 `module_parse_websocket_service`
- `/ws/parse-v2/{file_id}` 与 `/ws/parse/{file_id}` 的失败/中断任务状态同步也已走 `module_parse_websocket_service`
- `module_parse_websocket_service` 修复了 OCR 已返回 `markdown_content` 时仍错误读取临时 markdown 文件的 bug
- `/parsed/{module_id}/translate` 和 `/translate-chapter` 已不再主要堆在 `modules.py` route 内部
- `test_module_parse_task_service.py`、`test_module_parse_flow_service.py` 与 `test_module_parse_websocket_service.py` 通过
- `tests/unit/test_module_*.py tests/unit/test_realtime_publisher.py` focused 回归通过
- 前端地图线这轮又继续把 `grantedActions.ts / sidebarCasting.ts / FloatingCharacterPanel.tsx / useMapSidebarSpellController.ts` 上的 `startSpellTargeting` 从 raw DOM 事件桥切回 typed bus，让授予动作、侧边栏施法、浮动角色面板自动最小化与地图侧 spell targeting 桥接共享同一条事件边界
- `ClassicCharacterCard.tsx / useCampaignHotbarBindings.ts` 这轮也把 `equipmentWeaponUse` 切到 typed bus，让角色卡装备菜单到 hotbar 武器 targeting 的桥接离开 legacy DOM 事件
- `TokenModal.tsx / useCampaignPanelOrchestration.ts` 这轮也把 `openRightPanelTab` 切到 typed bus，让地图 token 互动后跳到聊天侧栏的桥接离开 legacy DOM 事件
- `Toast.tsx / HotbarSlotItem.tsx / ClassicCharacterCard.tsx / useKeyboardMovement.ts / useMapTokenDragController.ts` 这轮也开始把 `showToast` 切到 typed bus，让键盘移动、token drag、快捷栏和角色卡的高频提示桥逐步离开 raw DOM 事件
- `campaign.$id.dm.tsx / CombatPanel.tsx / CharacterPanel.tsx / useMapWebSocket.ts` 这轮也继续把 clean `showToast` producer 切到 typed bus，让 DM 回合结算、战斗持续效果提示、角色面板提示与地图 websocket 生成物提示继续离开 raw DOM 事件
- `campaign.$id.player.tsx` 这轮也继续把 `spellSlotsChanged / layOnHandsTarget / tokenRemoved` 的 clean producer 切到 typed bus，让玩家页的法术位同步、圣疗 targeting 与角色 token 删除刷新继续离开 raw DOM 事件
- `campaign.$id.player.tsx` 这轮也把自闭环的 `characterCreated / aiGenerateProgress` 切到 typed bus，让玩家页角色创建与 AI 生成进度提示继续离开 raw DOM 事件
- `campaign.$id.dm.tsx / campaign.$id.player.tsx / CharacterPanel.tsx / ChatPanel.tsx / CharacterDisplay.tsx` 这轮也继续把 `characterSelected / spellSlotsUpdate / characterLevelChanged` 这组 producer 与 clean consumer 切到 typed bus，让角色选择、法术位后端回写桥和玩家页等级变化提示继续离开 raw DOM 事件
- `campaign.$id.dm.tsx / CharacterPanel.tsx` 这轮也继续把 `dm_generate_progress -> ws_message` 这条专用桥收成 `dmGenerateProgress` typed bus，让 DM AI 角色生成进度继续离开 raw DOM 事件
- `CharacterPanel.tsx / campaign.$id.player.tsx` 这轮也继续把 `equipmentConsumableUse / rewardUpdate / characterLevelUp` 的 clean consumer 切到 `subscribeAppEvent()`，让角色面板与玩家页的物品使用、奖励刷新和升级刷新继续离开 raw DOM 监听
- `CharacterPanel.tsx` 这轮也继续把 `startAbilityTargeting / removeCharacterTokens / selectTokenByCharacterId / focusOrCreateToken` 这几条已有 typed 契约的 producer 切到 `publishAppEvent()`，让角色面板到地图/热栏的外部桥继续离开 raw DOM 事件
- `campaign.$id.player.tsx` 这轮也继续把 `classFeatureUsesUpdated / characterConcentrationChanged / characterCastingChanged / restGrant / characterUpdated / characterEquipmentUpdated` 的 clean consumer 切到 `subscribeAppEvent()`，并把 `trade_confirm` 后的角色刷新改成 `publishAppEvent("characterUpdated")`
- `CombatActionModal.tsx / InitiativeTracker.tsx / CombatTurnOverlay.tsx / useMapCombatRuntimeController.ts` 这轮也把 `combatStorageUpdated / combatStorageDeleted` 的 consumer 切到 `subscribeAppEvent()`，为后续把 realtime bridge 彻底收进 typed bus 先铺平消费边界
- `campaign.$id.dm.tsx / ChatPanel.tsx` 这轮也把 `restGrant / combatNewRound / anchorPlaced / selectCharacterFromMap / openRightPanelTab` 这组 clean producer 与 consumer 切到 `publishAppEvent()/subscribeAppEvent()`，让 DM route 的休息广播、战斗回合同步、锚点联动、地图选角和聊天侧栏跳转继续离开 raw DOM 事件桥
- `campaignRealtimeBridge.ts / campaign.$id.player.tsx` 这轮也把 `characterListNeedsRefresh` 和 `player-main restGrant` 收到 `publishAppEvent()/subscribeAppEvent()`，让玩家页角色创建后的列表刷新与休息广播继续离开 raw DOM 事件桥
- `campaign.$id.player.tsx` 这轮也把 companion 检测里的 `ws:token_placed / ws:token_removed` consumer 切到 `subscribeAppEvent("tokenPlaced" / "tokenRemoved")`，让玩家页 token 放置/删除同步继续离开 raw DOM 事件桥
- `CombatPanel.tsx` 这轮也把 `combatStorageUpdated / combatStorageDeleted` 的残余 raw consumer 切到 `subscribeAppEvent()`，让战斗面板的战斗存储同步和 typed bus 完全对齐
- `CharacterPanel.tsx / useMapWebSocket.ts` 这轮也把圣击 targeting 入口统一回 `startAbilityTargeting`，并退役了 `spellCastResult / shopInventoryUpdated` 这两条已经没有 consumer 的 runtime 死桥，让地图 websocket 到面板/热栏的边界继续收薄
- `CombatPanel.tsx` 这轮也把 `sendWebSocketMessage` 死桥改成了显式 `sendMessage` prop；同时 `campaign.$id.dm.tsx` 撤销绘图成功后不再派发 `drawingsRefresh` 自定义事件，而是通过 `drawingsRefreshVersion -> TacticalMap -> useMapData.ts` 的显式刷新路径重载绘图数据
- `TacticalMap.client.tsx` 这轮继续把剩余顶层 heavy handler 收进了 `useMapMovementRuntimeController.ts`、`useMapInventoryAndPlacementController.ts` 与 `useMapSelectionActionController.ts`，把 move confirm / move-to / spell-area 拖拽、pickup-use consumable-place monster/currency/item/NPC，以及 dodge / contested check / escape-save / wake-up / stand-up 这组选择型动作从主组件里拆平
- 对应 focused 前端校验现已覆盖 `useMapMovementRuntimeController.test.ts`、`useMapInventoryAndPlacementController.test.ts` 与 `useMapSelectionActionController.test.ts`，并继续保持 `npm run typecheck` 通过
