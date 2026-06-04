# 架构文档目录

这个目录集中存放项目的架构分析与治理文档。

当前包含：

- `ARCHITECTURE_REVIEW_2026.md`：从当前源码实况出发，对系统结构、热点区域、主要风险和优化优先级做审计分析
- `REFACTORING_ROADMAP_2026.md`：基于架构审计结果整理的增量重构路线图，强调分阶段推进而不是大爆炸重写
- `MODULE_REFACTOR_BATCH_2026_03_21.md`：记录 `module_chat.py / modules.py / TacticalMap.client.tsx` 这一批热点治理的设计边界、已完成项和下一步切口
- `REFACTOR_AUTOPILOT_2026_03_21.md`：记录长重构自动续跑的 driver/skill/AGENTS 协议与 stop/continue 判定
- `RUNTIME_SCHEMA_CATALOG.md`：记录 Phase 3 runtime schema 的唯一入口、接入链路与验收门槛
- `SPELL_RUNTIME_ENGINE.md`：记录法术 runtime 实例表、token 投影、trigger/verb 注册表与 Hex 试点的落地口径
- `SERVER_STATE_GUIDE.md`：记录 Phase 3 server-state 的唯一标准、首屏单 owner 规则与预算门槛
- `TRANSPORT_AND_AUTH_GUIDE.md`：记录 Phase 3 transport/auth 的唯一标准（HTTP bearer-only、WS token-only）与硬门槛
- `DW_HEALTH_SNAPSHOT_2026_03_23.md`：可复现的健康快照（复杂度/测试/性能预算/实时边界/仓库卫生）
- `DW_OPTIMIZATION_AUDIT_AND_BACKLOG_2026_03_23.md`：评分模型 + Top 20 优化队列 + 2 周/6-8 周执行板

当前推进状态（2026-03-23）：

- 第一轮增量重构已经实做了前端事件总线、campaign shell 第一批抽取、后端 `realtime_publisher` 收口、`characters/combat` 第一批 service 化。
- Phase 3 已正式启动，不再只是“后续阶段”：
  - 后端已新增 token / character / combat 三组 runtime schema，并开始在 `tokens.py`、`characters.py`、`campaign_storage.py`、`character_action_service.py`、`combat_check_usecase_service.py` 做读时 normalize / 写时 validate
  - 后端已新增 `spell_runtime_instances` 作为活跃法术真相层，并开始把 Hex 这类复杂持续法术迁到 runtime engine + token projection 模式
  - 区域控制法术也开始进入桥接迁移：`zone-spell-settle` 已新增 `enter / start_turn / end_turn` 时机分流，`蛛网术 / 油腻术` 已删除旧 `controlEffect` / `zoneEffects.settlement`，转为完全按 `effects` trigger 推导结算
  - 前端已新增 `frontend/app/queries/` 统一入口，第一批覆盖 `campaign / character / combat / module`
  - 旧 `characterResourcesCache / combatStateCache / moduleMapsCache / campaignMembersCache / characterCache` 已开始退化成 QueryClient 包装层，而不是继续维护第二套手写缓存
  - DM / Player 首屏预算 smoke 已固化为 `debug/phase3_budget_smoke.spec.ts`（含网络预算断言 + console 0 error 断言）
- 后端以下热点路由已经清掉直接 `broadcast_to_campaign/send_to_recipients`：
  `combat.py`、`characters.py`、`tokens.py`、`campaign_storage.py`、`spell_cast.py`、`chat.py`、`map_markers.py`、`chests.py`、`campaigns.py`、`character_crud.py`、`voice.py`、`resource_chat.py`、`monster_instances.py`、`module_chat.py`、`websocket_simplified.py`
- 截至当前这轮重构，`backend/app/api/routes/` 已经没有剩余的 route 级直发广播；后续热点主要转向超大文件拆分、service 深化和前端地图/面板壳层继续瘦身。
- `module_chat.py` 已开始第二阶段瘦身，纯逻辑与副作用正逐步收进 `module_entity_service.py`、`module_avatar_generation_service.py`、`module_chat_usecase_service.py`、`module_encounter_usecase_service.py`、`module_encounter_planning_service.py`。
- `/create-entity` 的 `npc / monster / shop / item / encounter` 和 `/execute-map-encounter` 的实体创建/落图编排，已经不再主要堆在 `module_chat.py` route 内部。
- `modules.py` 也已开始第二批 route-to-service 收口：
  `get / export / import` 相关的 payload 组装与快照构造已收进 `module_snapshot_service.py`；
  `embed / embed status / delete embeddings` 已收进 `module_task_flow_service.py`；
  `extract-monsters / extract-items` 的 SSE 包装已收进 `module_extraction_stream_service.py`；
  `parse task` 查询/停止已收进 `module_parse_task_service.py`；
  `parse_raw_file_ws` 中语言检测/翻译/parsed module 落库已开始收进 `module_parse_flow_service.py`；
  `/ws/parse-v2/{file_id}` parse-v2 入口已加入 `module_parse_websocket_service.py` 的控制入口，并收口 resume/error 边界；
  `/ws/parse/{file_id}` 失败回写与任务失败状态同步也已收口到 `module_parse_websocket_service.py`。
  `parse_raw_file_ws` 的 OCR/图片分类/解析主流程收进 `module_parse_websocket_service.py`；
  `/parsed/{module_id}/translate*` 的翻译编排已收进 `module_translation_service.py`；
  websocket parse 入口头部的 file/task 初始化也开始收进 `module_parse_task_service.py`。
- 当前模组线此前更大一组 focused backend 回归可稳定通过 `116 passed, 1 warning`，说明 `module_chat / modules / realtime_publisher` 这条连续拆分链已有基础保护网。
- 本轮 `modules.py websocket parse` 收口相关的 focused backend 回归通过 `22 passed, 1 warning`，并顺手修掉了 OCR 已返回 markdown 时仍错误读取临时文件的 bug。
- `TacticalMap.client.tsx` 已进入第一批 controller extraction：
  `useMapCombatOverlays.ts` 收口了 movement overlay、attack distance line、monster action targeting 与 cursor info；
  `useMapViewportController.ts` 收口了 viewport culling、visible tokens、player companions、zoom avatars 与伙伴 monster_data 预取；
  `mapInteractionUtils.ts` 已接管右键菜单里的 grid 命中、clicked token 判定、玩家 source token 解析与回合 gate；
  `useMapInteractionController.ts` 继续收走了 `context menu / long-press / shop-chest modal / interaction resource loading` 这一整块 controller；
  `useMapTokenInteractionController.ts` 又继续收走了 `token select/open/external select` 主控制链；
  `useMapTokenDragController.ts` 已把 token drag 持久化、移动力限制与 zone spell settle 检查从 `useMapEvents.ts` 中独立出来；
  `useMapInventoryController.ts` 已把 `item / loot bag / shop token` 这一组异步 inventory 编排从主组件里收出去；
  `useMapPlacementController.ts` 已把 `place shop / place character / place my token` 这组放置编排从主组件里收出去；
  `useMapPlayerActionController.ts` 已把 `player move / cast spell / use ability / toggle reaction` 这组玩家动作处理器从主组件里收出去；
  `useMapStatusController.ts` 已把 `status effect / concentration / ritual casting / casting confirm` 这组状态与确认编排从主组件里收出去；
  `useMapFocusController.ts` 已把 `minimap navigate / focus token / focus players / anchor jump-clear / avatar click` 这组视角与定位动作从主组件里收出去；
  `useMapMarkerController.ts` 已把 marker 选中、创建、删除与 marker dialog 状态从主组件里收出去；
  `useMapViewStateController.ts` 已把 viewport globals、resize、视野状态保存与 beforeunload flush 从主组件里收出去；
  `useMapDueCastResolution.ts` 已把到时施法自动结算与去重触发逻辑从主组件里收出去；
  `useMapCombatRuntimeController.ts` 已把手动反应模式、反应消费后的自动清理、初始回合读取与 active turn 实时跟踪从主组件里收出去；
  `useMapUiChromeController.ts` 已把 touch-device 检测、right offset 计算与 DM bubble 生命周期从主组件里收出去；
  `useMapExternalSyncController.ts` 已把角色 feature uses 同步和 roll modifier 外部事件同步从主组件里收出去；
  `useMapTerrainController.ts` 已把 terrain 本地更新、debounced 持久化与 terrain 广播从主组件里收出去；
  `useMapTouchGestureController.ts` 已把 native touch listener、iOS gesture pinch 与 ruler multi-touch 手势桥接从主组件里收出去；
  `useMapTargetingController.ts` 已把 hotbar targeting ESC 取消、hovered token、cursor distance 与 targeting token select 逻辑从主组件里收出去；
  `mapTargetingUtils.ts` 已把 hotbar range fallback、range band 判定与 spell range 解析抽成共享 targeting 工具；
  `useMapAreaSpellController.ts` 已把 area spell 的状态机、目标高亮派生、落点确认和 ready-to-cast 判定从主组件里收出去；
  `useMapAreaSpellRuntimeController.ts` 这一轮又继续收走了 `startBreathWeapon / startMonsterAreaAction / touch preview` 这组三个 area spell 运行时副作用；
  `useMapAreaSpellPersistence.ts`、`mapAreaSpellRuntimeUtils.ts`、`mapAreaSpellCombatPayload.ts`、`mapAreaSpellCastPrelude.ts`、`useMapAreaSpellNonCombatController.ts`、`useMapAreaSpellResultController.ts`、`useMapAreaSpellCombatDispatchController.ts`、`mapAreaSpellCombatDispatchUtils.ts`、`mapAreaSpellCombatPreparation.ts` 与 `useMapAreaSpellCastExecutionController.ts` 这一轮继续把 `handleAreaSpellCast` 里的法术位持久化、持续区域 effect payload、幻术 token payload、caster/targets/request builder、source effect 预处理、utility/empty-ground 前半段分支、control-effect 写回、`spell-area` request dispatch、toast/sound/dice lifecycle、错误分支以及高层 execution orchestration 抽成独立 hook/utils；
  `useMapSpellCombatDispatchController.ts`、`mapSpellDispatchUtils.ts`、`mapSpellCombatPreparation.ts`、`mapSpellRangeUtils.ts`、`useMapSpellActionController.ts`、`useMapSidebarSpellController.ts`、`useMapReactionSpellController.ts`、`useMapSupportActionController.ts`、`useMapTargetSaveEffectController.ts`、`useMapBonusActionActivationController.ts`、`useMapBonusActionRoutingController.ts`、`useMapFeatureAdminController.ts`、`useMapManeuverController.ts`、`mapInvokeDuplicityUtils.ts`、`useMapInvokeDuplicityController.ts`、`useMapClericDomainActionController.ts`、`useMapTrickeryLightActionController.ts`、`useMapReadThoughtsActionController.ts`、`useMapChannelDivinityActionController.ts` 与 `useMapBonusUtilityActionController.ts` 已继续把单体 `handleSpellAction`、sidebar spell 监听、`Dampen Elements / Wrath of the Storm` 这组 reaction-spell callback、`Preserve Life / Knowledge of the Ages / Visions of the Past / tool check` 这组 support-action modal callback、`target_save_effect` 这类 bonus-action/save-effect 分支、通用资源扣减/旧 `class_feature_uses` 回写/持续效果激活/行动经济广播这条 generic bonus-action activation 链、以及 `transform / execution.openEvent / support-action/domain-action/trickery-light/read-thoughts/channel-divinity` 这一整层 special-route 分发链、`effect duration / action uses / ranger ability toggle` 这组地图内状态编辑链、Battle Master 的 `prepared / trigger / secondary-effect` 战技主链、`Invoke Duplicity` 的打开校验/placement/create 流、`Warding Flare / Guided Strike / War God's Blessing / Destructive Wrath` 这组 cleric domain action、`Cloak of Shadows / Blessing of the Trickster / Radiance of the Dawn / Corona of Light` 这组 trickery/light action、`Read Thoughts -> Suggestion` 的二段施放、`Charm Animals and Plants / Master of Nature / Turn Undead` 这组 channel-divinity 主链，以及 `instant self-heal / bardic inspiration` 这组 bonus-action utility 主链从主组件里收成独立边界；`combatBonusActionResult` 也继续回收到 typed bus，并由 `CombatPanel.tsx` 订阅新边界；战技骰 `superiority_dice` 的消耗同步这一轮也开始走 `classFeatureUsesUpdated` typed bus；
  `useMapExternalSyncController.ts` 这一轮把本地 `sourceCharacterData` 的 feature uses 同步从裸 `characterFeatureUsesUpdated` 监听切到了 typed bus 的 `classFeatureUsesUpdated`，同时保留 `rollModifierUpdated` 这条 legacy DOM 同步；随后又继续把 `openTokenParamsEditor / tokenHPUpdate / selectTokenByCharacterId / selectCharacterFromMap / removeCharacterTokens / focusOrCreateToken` 这组地图与面板外部桥接收进同一个 controller，让参数编辑、角色选中、角色 HP 写回、角色踢出后的 token 删除，以及角色面板双击后的聚焦/补建 token 都离开 `TacticalMap.client.tsx` 里的散落 `useEffect`；
  `useMapSupportActionController.ts` 这一轮继续补上 `openKnowledgeOfTheAgesModal / openVisionsOfThePastModal` 两个 opener，把 support-action 的 modal 打开与建议焦点派生也从 `handleBonusAction` 里挪了出来；
  `useMapTransformationController.ts` 已收口为纯 `wild shape / polymorph` 变形边界；旧的 `变巨 / 缩小术` 专门 modal、右键入口和 `/tokens/{id}/transform` 快捷链已经删除，相关 spell effect 只允许走统一施法链；`易容术 / 伪装术` 这类外观幻术的首次施放也已经并回统一 `/api/spells/cast`，旧 `/tokens/{id}/disguise` 仅保留为施法后的编辑/解除宿主动作；地图上 `朦胧术 / 隐形术 / 镜影术` 这类视觉效果也已切到后端 `spell_visuals` 投影，不再由前端直读 `active_effects.tokenFilter`；`wildShapeTarget` 也已接回 typed bus；
  `useCampaignHotbarBindings.ts` 这一轮也把 `arcaneRecoveryTarget / flexibleCastingTarget / naturalRecoveryTarget` 从裸 DOM 监听切回 `subscribeAppEvent()`，让 TacticalMap 的 `execution.openEvent` 和 campaign-shell hotbar recovery modal 走同一条 typed bus 边界；
  `useMapAttackResultController.ts` 这一轮继续把本地攻击结果的 bubble 文案、怪物 DM bubble、`combatAttackResult / combatBonusAttackGranted / promptDivineSmite` 事件发布，以及 auto-apply HP 写回从 `TacticalMap.client.tsx` 中收成独立 controller；`useMapWebSocket.ts` 也开始把 `combatAttackResult / combatReactionUsed` 改走 `publishAppEvent()`，同时 `CombatPanel.tsx` 与 `useCampaignHotbarBindings.ts` 已切到 `subscribeAppEvent()` 订阅这批攻击结果和 divine smite prompt 边界；
  `useMapMonsterActionController.ts` 与 `mapMonsterActionUtils.ts` 这一轮继续把怪物攻击的命中加值/伤害/射程解析、目标防御快照、`executeMonsterAttack` 请求构造、超射程确认与 `startMonsterAreaAction` 分发从 `TacticalMap.client.tsx` 中收出去，让 `handleSelectionMonsterAction / executeMonsterAttack` 这一对高重复链统一落到一个 controller；
  `useMapAttackEntryController.ts` 与 `mapAttackEntryUtils.ts` 这一轮继续把普通攻击与 blind attack 的共享入口收成独立 entry 层，把 source/target 解析、射程/弹药/附赠动作校验、grapple/shove 分流、roll modifier 清理和 blind miss chat 统一到一个边界里，同时顺手把 `SelectionContextMenu.tsx` 中几处老 `showToast` CustomEvent 改成了直接 toast 调用；
  `useMapHotbarAttackBridge.ts` 这一轮继续把 hotbar confirm modal 发起的 `hotbarAttackExecute` 从裸 DOM 事件切到 typed bus，并把 DM/Player 页的确认回调和 TacticalMap 侧的订阅桥接成同一条攻击入口；
  `useMapWeaponAttackPreparationController.ts` 与 `mapWeaponAttackPreparationUtils.ts` 这一轮继续把 `handleAttackAction` 前半段的攻击资源消耗、目标防御/装备快照、宿敌/幸运/偷袭资格判定、优势/劣势推导和 `attackRequest` 组装从主组件里收成独立 preparation 层，让武器攻击主链不再同时承担读取、规则推导与请求构造；
  `useMapWeaponAttackExecutionController.ts` 这一轮继续把 `POST /api/combat/attack`、投骰提示、音效、战技命中后续、`combatActionUsed`、GWM 额外攻击、Paladin Divine Smite prompt、HP 自动写回和 cleanup 尾链从 `handleAttackAction` 中收出去，让武器攻击真正开始形成 `preparation -> execution -> result -> cleanup` 的分层结构；
  `useMapWeaponAttackCleanupController.ts` 这一轮继续把玩家武器攻击命中后的临时 buff 清理、弹药消耗、投掷武器落地与 `Cloak of Shadows` 收尾从 `handleAttackAction` 里收成独立 cleanup controller，让攻击主链更聚焦在请求和结果编排；
  `useMapModalData.ts` 已把 chest/shop/item/note/illusion 这批 modal 派生 token 与 chest characters 数据从主组件里收出去；
  `MapActionMenus.tsx` 已把 DM context menu、mobile action modal、DM token menu、player context menu 合成独立 render layer；
  `MapTargetingHud.tsx` 已把 hotbar / monster action / area spell / invoke duplicity 这批 targeting HUD 与浮层距离提示从主组件里收出去；
  `MapTargetingOverlayLayer.tsx` 已把 hotbar / monster action range overlay、invoke duplicity 预览、`attackDistanceLine` 运行时虚线和 area spell targeting canvas overlay 从主组件里收出去；
  `MapSelectionMenuLayer.tsx` 已把 `SelectionContextMenu` 的派生 props、reaction attack 编排与 `layOnHandsTarget/combatReactionUsed` 事件桥接收进一层；
  `MapPlayerSpellDialog.tsx` 已把玩家施法弹窗的法术位数组、专注/施法中状态、silence 与 feat 派生收成独立 bridge；
  `MapStatusDialogs.tsx` 已把专注规则、仪式施法、状态效果说明、施法/专注确认这批 info/status dialog 收成独立 render layer；
  `MapMarkerAndConfirmDialogs.tsx` 已把 marker 创建、marker 选中操作、range/move confirm 收成独立 render layer；
  `MapSpecialActionDialogs.tsx` 已把 shop/chest/transformation/enlarge/domain action/tool-check/zone settlement 这批 modal 装配层收成独立桥接组件；
  `useMapEvents.ts / useMapInteractionController.ts / TacticalMap.client.tsx` 这轮又把 `openShop/openChest/chestOpen/combatActionUsed` 这一批地图交互事件收进了 `appEventBus`；
  `TacticalMap.client.tsx` 这轮继续把 `spellCastChat / consumeSpellSlot / characterEquipmentUpdated / classFeatureUsesUpdated / combatReactionUsed` 这一批剩余高频事件切到 `publishAppEvent()`，并把角色装备刷新监听改成 `subscribeAppEvent()`；
  `TacticalMap.client.tsx` 里的 `combatActionUsed` 直发点现已清零，行动/疾走/攻击/移动 这条高频战斗资源事件链已统一改走 typed bus；
  `SelectionContextMenu.tsx` 里的 chest 交互事件也已接回同一条 typed event bus；
  `SelectionContextMenu.tsx`、`FloatingTokenPanel.tsx` 与 `useMapCombatOverlays.ts` 这一轮又把 `attackDistanceLine` 的 hover 预览从裸 DOM 事件切回 `publishAppEvent()/subscribeAppEvent()`，让攻击距离虚线与文案也回到统一事件边界；
  `FloatingTokenPanel.tsx` 与 `useMapCombatOverlays.ts` 这一轮也把 `monsterActionTargeting` 切回 typed bus，让怪物动作 targeting 提示、距离预览和 ESC 取消逻辑不再依赖裸 DOM 事件；
  `useMapMonsterActionController.ts` 与 `useMapAreaSpellRuntimeController.ts` 这一轮也把 `startMonsterAreaAction` 切回 typed bus，让怪物范围技从动作分发到 area spell 运行时选择的桥接链不再依赖裸 DOM 事件；
  `CharacterPanel.tsx`、DM/Player hotbar 与 `useMapAreaSpellRuntimeController.ts` 这一轮也把 `startBreathWeapon` 切回 typed bus，让角色吐息武器从 UI 发起到 area spell runtime 的桥接链不再依赖裸 DOM 事件；
  `TacticalMap.client.tsx` 与 `CombatPanel.tsx` 这一轮也把 `combatMoveResult` 切回 typed bus，让地图移动结果到战斗日志的桥接链不再依赖裸 DOM 事件；
  `useMapWebSocket.ts` 与 `useMapTokenDragController.ts` 这一轮也把 `tokenPerformedAction` 切回 typed bus，让攻击/施法后的 zone-spell 二次结算触发链不再依赖裸 DOM 事件；
  `CombatPanel.tsx` 与 `useMapCombatRuntimeController.ts` 这一轮继续把 `manualReactionModeStart / manualReactionModeEnd / manualReactionModeChanged` 收到 typed bus，让手动反应模式的开启、关闭和状态同步链不再依赖裸 DOM 事件；
  `CombatPanel.tsx`、`TokenComponent.tsx`、`useMapCombatOverlays.ts` 与 `useMapTokenDragController.ts` 这一轮继续把 `combatMovementChanged / combatTurnChanged / combatTurnStarted` 收到 typed bus，让移动范围 overlay、token turn re-render 与 turn-start zone settle 这组 combat runtime 刷新链不再依赖裸 DOM 事件；
  `InitiativeTracker.tsx`、`CombatPanel.tsx` 与 `TacticalMap.client.tsx` 这一轮继续把 `combatEndTurn / combatRestoreMovement` 收到 typed bus，让回合结束触发、撤回移动和 cloak-of-shadows turn-end 清理这组跨面板运行时桥接不再依赖裸 DOM 事件；
  `CombatPanel.tsx`、`InitiativeTracker.tsx`、`CombatTurnOverlay.tsx` 与 `ChatPanel.tsx` 这一轮继续把 `combatNewRound / combatTurnNotification` 收到 typed bus，让新回合聊天重置、回合提示和战斗轮次通知链不再依赖裸 DOM 事件；
  `ReactionButtons.tsx`、`useKeyboardMovement.ts`、`CombatPanel.tsx`、`ChatPanel.tsx` 与 `TokenComponent.tsx` 这一轮继续把 `combatActionUsed` 的残余 producer/consumer 全部收回 typed bus，让反应、键盘移动、行动经济同步和 token combat re-render 这条高频链不再依赖裸 DOM 事件；
  `TacticalMap.client.tsx`、`CombatPanel.tsx`、`useMapCombatOverlays.ts`、`FloatingTokenPanel.tsx` 与 `useMapWebSocket.ts` 这一轮继续把 `mapTokenSelected / monsterAvatarUpdated` 收到 typed bus，让 DM 选中 token 的资源面板同步和怪物头像热刷新链不再依赖裸 DOM 事件；
  `useMapWebSocket.ts` 与 `useMapExternalSyncController.ts` 这一轮继续把 `rollModifierUpdated` 收到 typed bus，让地图本地的优势/劣势标记同步不再依赖裸 DOM 事件；
  `useMapWebSocket.ts`、`CharacterPanel.tsx`、`CharacterDisplay.tsx` 与 `CharacterDisplay/hooks/useEquipment.ts` 这一轮继续把 `characterHPUpdated / transformationUpdate` 收到 typed bus，让地图 WebSocket、角色面板和角色卡片之间的生命值/变形同步链不再依赖裸 DOM 事件；
  `useMapWebSocket.ts`、`FloatingTokenPanel.tsx`、`Hotbar.tsx` 与 `ClassicCharacterCard.tsx` 这一轮继续把 `characterActiveEffectsChanged` 收到 typed bus，让 spell buff/active effects 的跨组件同步链不再依赖裸 DOM 事件；
  `useMapWebSocket.ts`、`useMapData.ts`、`useMapToken.ts`、`CharacterPanel.tsx`、`ClassicCharacterCard.tsx`、`GroundItemsSection.tsx`、`ChestInteractionModal.tsx`、`ChestInventoryModal.tsx` 与 `ChestsTab.tsx` 这一轮继续把 `tokenPlaced / tokenRemoved / chestCreated / chestStateChanged` 收到 typed bus，让地图 token 生命周期与宝箱状态同步不再依赖 `ws:token_placed`、`ws:token_removed` 和 `chest*` 这组 legacy DOM 事件；同时把已无 consumer 的 `characterFeatureUsesUpdated` 裸事件从 `useMapWebSocket.ts` 中移除；
  `useMapWebSocket.ts`、`FloatingTokenPanel.tsx` 与 `DeathSavePanel.tsx` 这一轮继续把 `monsterStatusEffectsChanged / characterStatusEffectsChanged / death_save_update` 收到 typed bus，让怪物状态面板同步、角色状态效果广播和死亡豁免更新离开 legacy DOM 事件桥；
  `CharacterPanel.tsx`、`ClassicCharacterCard.tsx` 与 `Hotbar.tsx` 这一轮也把 `characterConcentrationChanged / characterCastingChanged` 的剩余 consumer 切到 `subscribeAppEvent()`，让角色面板、经典卡片和 hotbar 的专注/施法中同步回到统一事件边界；
  `CharacterDisplay.tsx`、`CharacterPanel.tsx`、`useEquipment.ts`、`BagDialog.tsx`、`EquipDialog.tsx`、`GroundItemsSection.tsx` 与 `ShopTransactionModal.tsx` 这一轮继续把 `characterEquipmentUpdated` 的残余 producer/consumer 切到 `publishAppEvent()/subscribeAppEvent()`，让角色装备/货币刷新、商店交易、地面拾取与装备弹窗回到统一事件边界；
  `CharacterPanel.tsx`、`Hotbar.tsx` 与 `ClassicCharacterCard.tsx` 这一轮也把 `classFeatureUsesUpdated` 的残余 producer/consumer 切到 `publishAppEvent()/subscribeAppEvent()`，让职业资源刷新不再夹在 typed bus 和 raw DOM 之间；
  `useCharacterSpellcasting.ts`、`Hotbar.tsx` 与 `CharacterPanel.tsx` 这一轮也把 `spellSlotsChanged / restGrant` 切到 `publishAppEvent()/subscribeAppEvent()`，让法术位同步和休息广播离开 legacy DOM 事件桥；
  `CharacterPanel.tsx` 与 `ClassicCharacterCard.tsx` 这一轮也把 `characterUpdated` 切到 `publishAppEvent()/subscribeAppEvent()`，让角色经验/头像等通用刷新通知回到统一事件边界；
  `grantedActions.ts`、`sidebarCasting.ts`、`FloatingCharacterPanel.tsx` 与 `useMapSidebarSpellController.ts` 这一轮也把 `startSpellTargeting` 切到 `publishAppEvent()/subscribeAppEvent()`，让授予动作、侧边栏施法、浮动角色面板自动最小化与地图侧施法 targeting 桥接回到统一事件边界；
  `useMapSidebarSpellController.ts` 这一轮也把 `sidebarSpellCast` 的 consumer 切到 `subscribeAppEvent()`，让 DM/Player route 侧边栏施法对 TacticalMap 的桥接先脱离 raw DOM 监听；
  `actionEffectHandlers.ts` 这一轮也把 `combatBonusActionResult` 的残余 producer 切到 `publishAppEvent()`，让 data-driven bonus action 效果链不再自己直发 raw DOM 事件；
  `BagDialog.tsx` 与 `Hotbar.tsx` 这一轮也把 `hotbar-add-item / hotbar-drop-to-slot` 切到 `publishAppEvent()/subscribeAppEvent()`，让背包拖拽/添加到快捷栏的桥接离开 legacy DOM 事件；
  `openEventBridge.ts`、`FeatureDetailDialog.tsx` 与 `useMapBonusActionRoutingController.ts` 这一轮也统一了 `execution.openEvent` 的桥接规则，让 `wildShapeTarget / arcaneRecoveryTarget / flexibleCastingTarget / naturalRecoveryTarget` 这批 opener 优先走 typed bus，未知事件再回退 legacy DOM；
  `ClassicCharacterCard.tsx` 这一轮也把 `equipmentConsumableUse` 的 producer 切到 `publishAppEvent()`，让角色卡的消耗品使用桥接离开 raw DOM 直发，同时继续兼容老的 `CharacterPanel` consumer；
  `LevelUpNotification.tsx` 这一轮也把 `characterLevelUp` 的 clean consumer 切到 `subscribeAppEvent()`，让升级提示这条链先回到统一事件边界，同时继续兼容老 route 和角色面板的 legacy producer/consumer；
  `characterBubble.ts` 与 `diceRequestBubble.ts` 这一轮也把角色头像气泡、引用消息、私信启动、DM 骰子请求/响应/忽略 这组 util 事件桥切到 `publishAppEvent()/subscribeAppEvent()`，让聊天/投骰辅助链离开 raw DOM 事件；
  `campaign.$id.dm.tsx`、`CombatPanel.tsx`、`CharacterPanel.tsx` 与 `useMapWebSocket.ts` 这一轮也把 `showToast` 的 clean producer 切到 `publishAppEvent()`，让 DM 回合结算、战斗持续效果提示、角色面板提示与地图 websocket 生成物提示继续回到统一事件边界；
  `campaign.$id.player.tsx` 这一轮也把 `spellSlotsChanged / layOnHandsTarget / tokenRemoved` 的 clean producer 切到 `publishAppEvent()`，让玩家页的法术位同步、圣疗 targeting 与角色 token 删除刷新继续回到统一事件边界；
  `campaign.$id.player.tsx` 这一轮也把 `characterCreated / aiGenerateProgress` 这对自闭环桥切到 `publishAppEvent()/subscribeAppEvent()`，让玩家页角色创建与 AI 生成进度提示离开 raw DOM 事件；
  `campaign.$id.dm.tsx / campaign.$id.player.tsx / CharacterPanel.tsx / ChatPanel.tsx / CharacterDisplay.tsx` 这一轮也把 `characterSelected / spellSlotsUpdate / characterLevelChanged` 这组 producer 与 clean consumer 切到 `publishAppEvent()/subscribeAppEvent()`，让角色选择、法术位后端回写桥和玩家页等级变化提示继续离开 raw DOM 事件；
  `campaign.$id.dm.tsx / CharacterPanel.tsx` 这一轮也把 `dm_generate_progress -> ws_message` 这条专用桥收成 `dmGenerateProgress` typed bus，让 DM AI 角色生成进度离开专用 raw DOM 事件；
  `CharacterPanel.tsx / campaign.$id.player.tsx` 这一轮也把 `equipmentConsumableUse / rewardUpdate / characterLevelUp` 的 clean consumer 切到 `subscribeAppEvent()`，让角色面板与玩家页的物品使用、奖励刷新和升级刷新离开 raw DOM 监听；
  `CharacterPanel.tsx` 这一轮也把 `startAbilityTargeting / removeCharacterTokens / selectTokenByCharacterId / focusOrCreateToken` 这几条已有 typed 契约的 producer 切到 `publishAppEvent()`，让角色面板到地图/热栏的外部桥继续离开 raw DOM 事件；
  `campaign.$id.player.tsx` 这一轮也把 `classFeatureUsesUpdated / characterConcentrationChanged / characterCastingChanged / restGrant / characterUpdated / characterEquipmentUpdated` 的 clean consumer 切到 `subscribeAppEvent()`，并把 `trade_confirm` 后的角色刷新改成 `publishAppEvent("characterUpdated")`，让玩家页这批资源/专注/施法/奖励/交易刷新桥继续离开 raw DOM；
  `campaign.$id.dm.tsx / ChatPanel.tsx` 这一轮也把 `restGrant / combatNewRound / anchorPlaced / selectCharacterFromMap / openRightPanelTab` 这组 clean producer 与 consumer 切到 `publishAppEvent()/subscribeAppEvent()`，让 DM route 的休息广播、战斗回合同步、锚点联动、地图选角和聊天侧栏跳转继续离开 raw DOM 事件桥；
  `campaignRealtimeBridge.ts / campaign.$id.player.tsx` 这一轮也把 `characterListNeedsRefresh` 和 `player-main restGrant` 收到 `publishAppEvent()/subscribeAppEvent()`，让玩家页角色创建后的列表刷新与休息广播继续离开 raw DOM 事件桥；
  `campaign.$id.player.tsx` 这一轮也把 companion 检测里的 `ws:token_placed / ws:token_removed` consumer 切到 `subscribeAppEvent("tokenPlaced" / "tokenRemoved")`，让玩家页 token 放置/删除同步继续离开 raw DOM 事件桥；
  `CombatPanel.tsx` 这一轮也把 `combatStorageUpdated / combatStorageDeleted` 的残余 raw consumer 切到 `subscribeAppEvent()`，让战斗面板的战斗存储同步和 typed bus 完全对齐；
  `CharacterPanel.tsx / useMapWebSocket.ts` 这一轮也把圣击 targeting 入口统一回 `startAbilityTargeting`，并退役了 `spellCastResult / shopInventoryUpdated` 这两条已经没有 consumer 的 runtime 死桥，让地图 websocket 到面板/热栏的边界继续收薄；
  `CombatPanel.tsx` 这一轮也把 `sendWebSocketMessage` 死桥改成了显式 `sendMessage` prop，同时 `campaign.$id.dm.tsx -> TacticalMap -> useMapData.ts` 这条链也用 `drawingsRefreshVersion` 替代了 `drawingsRefresh` raw DOM 事件，让战斗奖励发放和 DM 撤销绘图都回到显式数据流；
  `TacticalMap.client.tsx` 这一轮继续把剩余顶层 heavy handler 收进了 `useMapMovementRuntimeController.ts`、`useMapInventoryAndPlacementController.ts` 与 `useMapSelectionActionController.ts`，把 movement runtime、pickup/use consumable/place monster-currency-item-NPC，以及 dodge / contested check / escape-save / wake-up / stand-up 这组选择型动作从主组件里拆平；对应 focused Vitest 也已补上；
  后端第二批 route-thinning 这轮也开始继续推进：`combat.py` 的 `perform_ability_check / perform_contest` 已收进 `combat_check_usecase_service.py`，`characters.py` 的 `feature-uses / resources/restore / resources/set` 已收进 `character_action_service.py`，并补上了 focused pytest；
  `CombatActionModal.tsx` 这一轮也把 `openCombatActionModal` 的 clean consumer 切到 `subscribeAppEvent()`，让战斗动作弹窗这条链开始从 raw DOM 事件桥回到统一事件边界；
  `sidebarCasting.ts`、`useUnreadChat.ts` 与 `characterResourcesCache.ts` 这一轮也把 `spellCastStarted`、`ws-chat-message` 和 `classFeatureUsesUpdated` 的 clean producer/consumer 切到 `publishAppEvent()/subscribeAppEvent()`，让长施法起始、未读聊天和角色资源缓存失效离开 legacy DOM 监听，同时继续兼容旧事件名；
  `TacticalMap.client.tsx` 这一轮也把 `anchorPlaced` 的 producer 切到 `publishAppEvent()`，让锚点设置后的 DM 侧联动离开 raw DOM 直发，同时继续兼容旧 listener；
  `campaignRealtimeBridge.ts` 这一轮也把 `combatStorageUpdated / combatStorageDeleted` 的 producer 切到 `publishAppEvent()`；DM/Player route 侧的 `ws-chat-message / sidebarSpellCast / characterLevelUp / tokenHPUpdate` 这几条 clean producer 也开始改走 typed bus，让战役 realtime bridge 和 hotbar 施法桥接少依赖 raw DOM 直发；
  `ClassicCharacterCard.tsx` 与 `useCampaignHotbarBindings.ts` 这一轮也把 `equipmentWeaponUse` 切到 `publishAppEvent()/subscribeAppEvent()`，让角色卡装备菜单到 hotbar 武器 targeting 的桥接离开 legacy DOM 事件；
  `TokenModal.tsx` 与 `useCampaignPanelOrchestration.ts` 这一轮也把 `openRightPanelTab` 切到 `publishAppEvent()/subscribeAppEvent()`，让地图 token 互动后跳到聊天侧栏的桥接离开 legacy DOM 事件；
  `Toast.tsx`、`HotbarSlotItem.tsx`、`ClassicCharacterCard.tsx`、`useKeyboardMovement.ts` 与 `useMapTokenDragController.ts` 这一轮也开始把 `showToast` 切回 typed bus，让键盘移动、token drag、快捷栏和角色卡的高频提示离开 raw DOM 事件；
  `CombatActionModal.tsx`、`InitiativeTracker.tsx`、`CombatTurnOverlay.tsx` 与 `useMapCombatRuntimeController.ts` 这一轮也把 `combatStorageUpdated / combatStorageDeleted` 的 consumer 切到 `subscribeAppEvent()`，为后续把 realtime bridge 彻底收进 typed bus 先铺平消费边界；
  `token open` 现在也已改成单一路径执行，不再先走一遍泛化 click 再叠加具体 open 动作；
  `MapTokenLayer.tsx` 已把 token render list、marker layer 与 anchor overlay 从主组件里独立出来；
  对应 focused frontend 校验已继续通过 `npm run typecheck`，并新增 `mapAreaSpellCastPrelude.test.ts`、`useMapAreaSpellNonCombatController.test.ts`、`mapAreaSpellRuntimeUtils.test.ts`、`useMapAreaSpellPersistence.test.ts`、`mapAreaSpellResultUtils.test.ts`、`useMapAreaSpellResultController.test.ts`、`mapAreaSpellCombatDispatchUtils.test.ts`、`useMapAreaSpellCombatDispatchController.test.ts`、`mapAreaSpellCombatPreparation.test.ts`、`useMapAreaSpellCastExecutionController.test.ts`、`mapSpellDispatchUtils.test.ts`、`useMapSpellCombatDispatchController.test.ts`、`mapSpellCombatPreparation.test.ts`、`mapSpellRangeUtils.test.ts`、`useMapSpellActionController.test.ts`、`useMapSidebarSpellController.test.ts`、`useMapReactionSpellController.test.ts`、`useMapSupportActionController.test.ts`、`useMapTargetSaveEffectController.test.ts`、`useMapBonusActionActivationController.test.ts`、`useMapBonusActionRoutingController.test.ts`、`useMapFeatureAdminController.test.ts`、`useMapManeuverController.test.ts`、`useMapAttackResultController.test.ts`、`mapMonsterActionUtils.test.ts`、`useMapMonsterActionController.test.ts`、`mapAttackEntryUtils.test.ts`、`useMapAttackEntryController.test.ts`、`useMapWeaponAttackPreparationController.test.ts`、`mapWeaponAttackPreparationUtils.test.ts`、`useMapWeaponAttackExecutionController.test.ts`、`useMapWeaponAttackCleanupController.test.ts`、`useMapExternalSyncController.test.ts`、`useMapInvokeDuplicityController.test.ts`、`useMapClericDomainActionController.test.ts`、`useMapTrickeryLightActionController.test.ts`、`useMapReadThoughtsActionController.test.ts`、`useMapChannelDivinityActionController.test.ts`、`useMapBonusUtilityActionController.test.ts`、`useMapTransformationController.test.ts`、`useCampaignHotbarBindings.test.ts` 与 `appEventBus.test.ts`；本轮补上 attack entry controller 后，攻击入口/准备/执行/清理/结果这一组 focused 校验为 `7 files / 15 tests passed`，且 `npm run typecheck` 继续保持通过。

建议阅读顺序：

1. `ARCHITECTURE_REVIEW_2026.md`
2. `REFACTORING_ROADMAP_2026.md`
3. `RUNTIME_SCHEMA_CATALOG.md`
4. `SERVER_STATE_GUIDE.md`
5. `MODULE_REFACTOR_BATCH_2026_03_21.md`
6. `../PROJECT_OVERVIEW.md`
