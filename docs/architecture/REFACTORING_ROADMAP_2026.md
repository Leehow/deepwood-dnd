# DND 5E Platform 重构路线图

**制定时间**：2026-03-20  
**适用对象**：当前仓库维护者、后续接手开发者、计划推进架构治理的人  
**目标**：在不影响主要业务持续交付的前提下，逐步降低系统复杂度、收拢边界、提升可维护性

配套文档：

- `docs/architecture/ARCHITECTURE_REVIEW_2026.md`
- `docs/PROJECT_OVERVIEW.md`
- `docs/PROJECT_FRONTEND_GUIDE.md`
- `docs/PROJECT_BACKEND_GUIDE.md`
- `docs/PROJECT_DATA_MODEL_GUIDE.md`

---

## 当前实施进度（2026-03-23）

这份路线图不是停留在建议阶段，当前仓库已经完成了第一轮中的一大批基础收边界工作：

- 前端：
  - typed event bus 已落地
  - campaign shell 已完成 bootstrap / realtime bridge / panel orchestration / hotbar/modal orchestration 第一批抽取
  - `TacticalMap.client.tsx` 已启动第一批 controller extraction，`useMapCombatOverlays.ts` 与 `useMapViewportController.ts` 已先收走战斗覆盖层状态、视口裁剪、visible tokens、伙伴预取与 zoom avatars；`mapInteractionUtils.ts` 已收走 selection/context menu 的纯判定层；`useMapInteractionController.ts` 已继续收走 `context menu / long-press / shop-chest modal / interaction resource loading`；`useMapTokenInteractionController.ts` 已继续收走 `token select/open/external select` 主控制链；`useMapTokenDragController.ts` 已继续收走 token drag 持久化、移动力限制与 zone spell settle 检查；`useMapInventoryController.ts` 已继续收走 `item / loot bag / shop token` 这一组 inventory 编排；`useMapPlacementController.ts` 已继续收走 `place shop / place character / place my token` 这组放置编排；`useMapPlayerActionController.ts` 已继续收走 `player move / cast spell / use ability / toggle reaction` 这组玩家动作处理器；`useMapStatusController.ts` 已继续收走 `status effect / concentration / ritual casting / casting confirm` 这组状态与确认编排；`useMapFocusController.ts` 已继续收走 `minimap navigate / focus token / focus players / anchor jump-clear / avatar click` 这组视角与定位动作；`useMapMarkerController.ts` 已继续收走 marker 选中、创建、删除与 marker dialog 状态；`useMapViewStateController.ts` 已继续收走 viewport globals、resize、视野状态保存与 beforeunload flush；`useMapDueCastResolution.ts` 已继续收走到时施法自动结算与去重触发；`useMapCombatRuntimeController.ts` 已继续收走手动反应模式、反应消费后的自动清理、初始回合读取与 active turn 实时跟踪；`useMapUiChromeController.ts` 已继续收走 touch-device 检测、right offset 计算与 DM bubble 生命周期；`useMapExternalSyncController.ts` 已继续收走角色 feature uses 同步与 roll modifier 外部事件同步，这一轮又把 feature uses 同步切到 typed bus 的 `classFeatureUsesUpdated`；`useMapTerrainController.ts` 已继续收走 terrain 本地更新、debounced 持久化与 terrain 广播；`useMapTouchGestureController.ts` 已继续收走 native touch listener、iOS gesture pinch 与 ruler multi-touch 手势桥接；`useMapTargetingController.ts` 已继续收走 hotbar targeting ESC 取消、hovered token、cursor distance 与 targeting token select；`mapTargetingUtils.ts` 已继续收走 hotbar range fallback、range band 判定、spell range 解析以及 attack distance cursor presentation；`useMapAreaSpellController.ts` 已继续收走 area spell 的状态机、目标高亮派生、落点确认和 ready-to-cast 判定；`useMapAreaSpellRuntimeController.ts` 这一轮又继续收走了 `startBreathWeapon / startMonsterAreaAction / touch preview` 这组三个 area spell 运行时副作用；`useMapAreaSpellPersistence.ts`、`mapAreaSpellRuntimeUtils.ts`、`mapAreaSpellCombatPayload.ts`、`mapAreaSpellCastPrelude.ts`、`useMapAreaSpellNonCombatController.ts`、`useMapAreaSpellResultController.ts`、`useMapAreaSpellCombatDispatchController.ts`、`mapAreaSpellCombatDispatchUtils.ts`、`mapAreaSpellCombatPreparation.ts` 与 `useMapAreaSpellCastExecutionController.ts` 已继续收走 `handleAreaSpellCast` 里的法术位持久化、持续区域 effect payload、幻术 token payload、caster/targets/request builder、source effect 预处理、utility/empty-ground 前半段分支、control-effect 写回、`spell-area` request dispatch、toast/sound/dice lifecycle、错误分支与高层 execution orchestration；`useMapSpellCombatDispatchController.ts`、`mapSpellDispatchUtils.ts`、`mapSpellCombatPreparation.ts`、`mapSpellRangeUtils.ts`、`useMapSpellActionController.ts`、`useMapSidebarSpellController.ts`、`useMapReactionSpellController.ts`、`useMapSupportActionController.ts`、`useMapTargetSaveEffectController.ts`、`useMapBonusActionActivationController.ts`、`useMapBonusActionRoutingController.ts`、`useMapFeatureAdminController.ts`、`useMapManeuverController.ts`、`mapInvokeDuplicityUtils.ts`、`useMapInvokeDuplicityController.ts`、`useMapClericDomainActionController.ts`、`useMapTrickeryLightActionController.ts`、`useMapReadThoughtsActionController.ts`、`useMapChannelDivinityActionController.ts` 与 `useMapBonusUtilityActionController.ts` 已继续收走单体 `handleSpellAction`、sidebar spell 监听、`Dampen Elements / Wrath of the Storm` 这组 reaction-spell callback、`Preserve Life / Knowledge of the Ages / Visions of the Past / tool check` 这组 support-action modal callback、`target_save_effect` 这类 bonus-action/save-effect 分支、通用资源扣减/旧 `class_feature_uses` 回写/持续效果激活/行动经济广播这条 generic bonus-action activation 链、`transform / execution.openEvent / support-action / domain-action / trickery-light / read-thoughts / channel-divinity` 这整层 special-route 分发链、以及 `effect duration / action uses / ranger ability toggle` 这组地图内状态编辑链、Battle Master 的 `prepared / trigger / secondary-effect` 战技主链、`Invoke Duplicity` 的打开校验/placement/create 流、`Warding Flare / Guided Strike / War God's Blessing / Destructive Wrath` 这组 cleric domain action、`Cloak of Shadows / Blessing of the Trickster / Radiance of the Dawn / Corona of Light` 这组 trickery/light action、`Read Thoughts -> Suggestion` 的二段施放、`Charm Animals and Plants / Master of Nature / Turn Undead` 这组 channel-divinity 主链，以及 `instant self-heal / bardic inspiration` 这组 bonus-action utility 主链；`combatBonusActionResult` 也继续回收到 typed bus，并由 `CombatPanel.tsx` 订阅新边界；`useMapSupportActionController.ts` 这一轮继续补上 `openKnowledgeOfTheAgesModal / openVisionsOfThePastModal` 两个 opener，把 support-action 的 modal 打开与建议焦点派生也从 `handleBonusAction` 里挪了出来；`useMapModalData.ts` 已继续收走 chest/shop/item/note/illusion 这批 modal 派生数据；`MapActionMenus.tsx`、`MapTargetingHud.tsx`、`MapTargetingOverlayLayer.tsx` 与 `MapSelectionMenuLayer.tsx` 已把主组件末尾的 menu render layer、targeting HUD、targeting canvas overlay 与 selection menu 桥接收走一层，其中 `MapTargetingOverlayLayer.tsx` 这轮也继续接管了 `attackDistanceLine` 的运行时虚线和距离文案；`MapPlayerSpellDialog.tsx` 已把玩家施法弹窗的法术位、专注/施法中、silence 与 feat 派生收成独立 bridge；`MapStatusDialogs.tsx`、`MapMarkerAndConfirmDialogs.tsx` 与 `MapSpecialActionDialogs.tsx` 已继续把 info/status dialog、marker confirm 和 special-action modal 装配层收走；`MapTokenLayer.tsx` 已独立 token render list、marker layer 与 anchor overlay；`useMapEvents.ts / useMapInteractionController.ts / TacticalMap.client.tsx` 这一轮又把 `openShop/openChest/chestOpen/combatActionUsed` 这批地图交互事件收进了 `appEventBus`，同时把 `layOnHandsTarget / combatReactionUsed / spellCastChat / consumeSpellSlot / characterEquipmentUpdated / classFeatureUsesUpdated` 也进一步接回了 typed bus，并把装备刷新监听切成 `subscribeAppEvent()`；`TacticalMap.client.tsx` 内部遗留的 `combatActionUsed` 直发点也已经清零；战技骰 `superiority_dice` 的消耗同步这一轮也开始走 `classFeatureUsesUpdated`
  - `useMapTransformationController.ts` 已收口为 `handleTransform / handleWildShape / handleTransformComplete / handleEndTransformation` 这组纯变形能力；旧的 `变巨 / 缩小术` modal、地图右键入口和 `/tokens/{id}/transform` 快捷链已删，spell-based size change 统一改走 `/api/spells/cast`
  - `useCampaignHotbarBindings.ts` 这一轮也把 `arcaneRecoveryTarget / flexibleCastingTarget / naturalRecoveryTarget` 切回 `subscribeAppEvent()`，让 TacticalMap 的 `execution.openEvent` 与 campaign-shell hotbar recovery modal 共用 typed bus 边界
  - `useMapAttackResultController.ts` 这一轮继续收走本地攻击结果 bubble、怪物 DM bubble、`combatAttackResult / combatBonusAttackGranted / promptDivineSmite` 发布与 auto-apply HP 写回；`useMapWebSocket.ts`、`CombatPanel.tsx` 与 `useCampaignHotbarBindings.ts` 也开始沿这条边界统一改走 `publishAppEvent()/subscribeAppEvent()`
  - `useMapMonsterActionController.ts` 与 `mapMonsterActionUtils.ts` 这一轮继续收走怪物攻击的命中加值/伤害/射程解析、目标防御快照、`executeMonsterAttack` 请求构造、超射程确认与 `startMonsterAreaAction` 分发，让 `handleSelectionMonsterAction / executeMonsterAttack` 这一对高重复链统一落到独立 controller
  - `useMapAttackEntryController.ts` 与 `mapAttackEntryUtils.ts` 这一轮继续收走普通攻击与 blind attack 的共享入口，把 source/target 解析、射程/弹药/附赠动作校验、grapple/shove 分流、roll modifier 清理和 blind miss chat 统一到一个 entry controller，并顺手把 `SelectionContextMenu.tsx` 里几处旧 `showToast` CustomEvent 改成了直接 toast 调用
  - `useMapHotbarAttackBridge.ts` 这一轮继续把 hotbar confirm modal 发起的 `hotbarAttackExecute` 收到 typed bus，由 DM/Player 页统一 `publishAppEvent()`，TacticalMap 再用共享 bridge 接回 `handleAttackAction`
  - `useMapWeaponAttackPreparationController.ts` 与 `mapWeaponAttackPreparationUtils.ts` 这一轮继续收走 `handleAttackAction` 前半段的攻击资源消耗、目标防御/装备快照、宿敌/幸运/偷袭资格判定、优势/劣势推导和 `attackRequest` 组装，让武器攻击主链开始形成 `preparation -> dispatch -> result -> cleanup` 四段结构
  - `useMapWeaponAttackExecutionController.ts` 这一轮继续收走 `POST /api/combat/attack`、投骰提示、音效、战技命中后续、`combatActionUsed`、GWM 额外攻击、Paladin Divine Smite prompt、HP 自动写回与 cleanup 尾链，让 `handleAttackAction` 的中后段也开始落到独立 execution controller
  - `useMapWeaponAttackCleanupController.ts` 这一轮继续收走玩家武器攻击命中后的临时 buff 清理、弹药消耗、投掷武器落地与 `Cloak of Shadows` 收尾，让 `handleAttackAction` 的下半段更接近纯 combat request/result orchestration
  - `SelectionContextMenu.tsx`、`FloatingTokenPanel.tsx` 与 `useMapCombatOverlays.ts` 这一轮又把 `attackDistanceLine` 切到 `publishAppEvent()/subscribeAppEvent()`，让 hover 攻击距离虚线和文案也离开了裸 DOM 事件
  - `FloatingTokenPanel.tsx` 与 `useMapCombatOverlays.ts` 这一轮也把 `monsterActionTargeting` 切到 `publishAppEvent()/subscribeAppEvent()`，让怪物动作 targeting 提示与距离预览回到统一事件边界
  - `useMapMonsterActionController.ts` 与 `useMapAreaSpellRuntimeController.ts` 这一轮也把 `startMonsterAreaAction` 切到 `publishAppEvent()/subscribeAppEvent()`，让怪物范围技从动作分发到 area spell runtime 的桥接链回到统一事件边界
  - `CharacterPanel.tsx`、DM/Player hotbar 与 `useMapAreaSpellRuntimeController.ts` 这一轮也把 `startBreathWeapon` 切到 `publishAppEvent()/subscribeAppEvent()`，让角色吐息武器到 area spell runtime 的桥接链回到统一事件边界
  - `TacticalMap.client.tsx` 与 `CombatPanel.tsx` 这一轮也把 `combatMoveResult` 切到 `publishAppEvent()/subscribeAppEvent()`，让移动结果进入战斗日志的桥接链回到统一事件边界
  - `useMapWebSocket.ts` 与 `useMapTokenDragController.ts` 这一轮也把 `tokenPerformedAction` 切到 `publishAppEvent()/subscribeAppEvent()`，让攻击/施法后的 zone-spell 二次结算触发链回到统一事件边界
  - `CombatPanel.tsx` 与 `useMapCombatRuntimeController.ts` 这一轮继续把 `manualReactionModeStart / manualReactionModeEnd / manualReactionModeChanged` 切到 `publishAppEvent()/subscribeAppEvent()`，让手动反应模式的开启、关闭和状态同步回到统一事件边界
  - `CombatPanel.tsx`、`TokenComponent.tsx`、`useMapCombatOverlays.ts` 与 `useMapTokenDragController.ts` 这一轮继续把 `combatMovementChanged / combatTurnChanged / combatTurnStarted` 切到 `publishAppEvent()/subscribeAppEvent()`，让移动范围 overlay、token turn re-render 与 turn-start zone settle 回到统一事件边界
  - `InitiativeTracker.tsx`、`CombatPanel.tsx` 与 `TacticalMap.client.tsx` 这一轮继续把 `combatEndTurn / combatRestoreMovement` 切到 `publishAppEvent()/subscribeAppEvent()`，让回合结束触发、撤回移动和 cloak-of-shadows turn-end 清理回到统一事件边界
  - `CombatPanel.tsx`、`InitiativeTracker.tsx`、`CombatTurnOverlay.tsx` 与 `ChatPanel.tsx` 这一轮继续把 `combatNewRound / combatTurnNotification` 切到 `publishAppEvent()/subscribeAppEvent()`，让新回合聊天重置、回合提示和战斗轮次通知回到统一事件边界
  - `ReactionButtons.tsx`、`useKeyboardMovement.ts`、`CombatPanel.tsx`、`ChatPanel.tsx` 与 `TokenComponent.tsx` 这一轮继续把 `combatActionUsed` 的残余 producer/consumer 全部切到 `publishAppEvent()/subscribeAppEvent()`，让反应、键盘移动、行动经济同步和 token combat re-render 回到统一事件边界
  - `TacticalMap.client.tsx`、`CombatPanel.tsx`、`useMapCombatOverlays.ts`、`FloatingTokenPanel.tsx` 与 `useMapWebSocket.ts` 这一轮继续把 `mapTokenSelected / monsterAvatarUpdated` 切到 `publishAppEvent()/subscribeAppEvent()`，让 DM 选中 token 的资源面板同步和怪物头像热刷新回到统一事件边界
  - `useMapWebSocket.ts` 与 `useMapExternalSyncController.ts` 这一轮继续把 `rollModifierUpdated` 切到 `publishAppEvent()/subscribeAppEvent()`，让地图本地的优势/劣势标记同步回到统一事件边界
  - `useMapWebSocket.ts`、`CharacterPanel.tsx`、`CharacterDisplay.tsx` 与 `CharacterDisplay/hooks/useEquipment.ts` 这一轮继续把 `characterHPUpdated / transformationUpdate` 切到 `publishAppEvent()/subscribeAppEvent()`，让地图 WebSocket、角色面板和角色卡片之间的生命值/变形同步回到统一事件边界
  - `useMapWebSocket.ts`、`FloatingTokenPanel.tsx`、`Hotbar.tsx` 与 `ClassicCharacterCard.tsx` 这一轮继续把 `characterActiveEffectsChanged` 切到 `publishAppEvent()/subscribeAppEvent()`，让 spell buff/active effects 的跨组件同步回到统一事件边界
  - `useMapWebSocket.ts`、`useMapData.ts`、`useMapToken.ts`、`CharacterPanel.tsx`、`ClassicCharacterCard.tsx`、`GroundItemsSection.tsx`、`ChestInteractionModal.tsx`、`ChestInventoryModal.tsx` 与 `ChestsTab.tsx` 这一轮继续把 `tokenPlaced / tokenRemoved / chestCreated / chestStateChanged` 切到 `publishAppEvent()/subscribeAppEvent()`，让地图 token 生命周期和宝箱状态同步从 `ws:token_placed / ws:token_removed / chest*` 这组 legacy DOM 事件回到统一边界；已无 consumer 的 `characterFeatureUsesUpdated` 裸事件也已从 `useMapWebSocket.ts` 中删除
  - `useMapWebSocket.ts`、`FloatingTokenPanel.tsx` 与 `DeathSavePanel.tsx` 这一轮继续把 `monsterStatusEffectsChanged / characterStatusEffectsChanged / death_save_update` 切到 `publishAppEvent()/subscribeAppEvent()`，让怪物状态面板同步、角色状态效果广播和死亡豁免更新回到统一事件边界
  - `CharacterPanel.tsx`、`ClassicCharacterCard.tsx` 与 `Hotbar.tsx` 这一轮也把 `characterConcentrationChanged / characterCastingChanged` 的剩余 consumer 切到 `subscribeAppEvent()`，让角色面板、经典卡片和 hotbar 的专注/施法中同步回到统一事件边界
  - `CharacterDisplay.tsx`、`CharacterPanel.tsx`、`useEquipment.ts`、`BagDialog.tsx`、`EquipDialog.tsx`、`GroundItemsSection.tsx` 与 `ShopTransactionModal.tsx` 这一轮继续把 `characterEquipmentUpdated` 的残余 producer/consumer 切到 `publishAppEvent()/subscribeAppEvent()`，让角色装备/货币刷新、商店交易、地面拾取与装备弹窗回到统一事件边界
  - `CharacterPanel.tsx`、`Hotbar.tsx` 与 `ClassicCharacterCard.tsx` 这一轮也把 `classFeatureUsesUpdated` 的残余 producer/consumer 切到 `publishAppEvent()/subscribeAppEvent()`，让职业资源刷新回到统一事件边界
  - `useCharacterSpellcasting.ts`、`Hotbar.tsx` 与 `CharacterPanel.tsx` 这一轮也把 `spellSlotsChanged / restGrant` 切到 `publishAppEvent()/subscribeAppEvent()`，让法术位同步和休息广播回到统一事件边界
  - `CharacterPanel.tsx` 与 `ClassicCharacterCard.tsx` 这一轮也把 `characterUpdated` 切到 `publishAppEvent()/subscribeAppEvent()`，让角色经验/头像等通用刷新通知回到统一事件边界
- 后端：
  - `realtime_publisher.py` 已成为主业务路径的统一实时出口
  - `character_command_service.py`、`character_progression_service.py`、`combat_attack_service.py`、`combat_resolution_service.py`、`combat_spell_service.py` 等第一批 service 已落地
  - `module_entity_service.py`、`module_avatar_generation_service.py`、`module_chat_usecase_service.py`、`module_encounter_usecase_service.py`、`module_encounter_planning_service.py` 已开始承接 `module_chat.py` 的实体创建、遭遇编排与 planning 文本链
  - `module_snapshot_service.py` 已开始承接 `modules.py` 的读模组 payload、导出快照与导入模型构造
  - `module_task_flow_service.py` 已开始承接 `modules.py` 的 embedding 启动、状态查询与删除
  - `module_extraction_stream_service.py` 已开始承接 `modules.py` 的 `extract-monsters / extract-items` SSE 任务流包装
  - `module_parse_task_service.py` 已开始承接 `modules.py` 的 parse task 查询/停止逻辑
  - `module_parse_flow_service.py` 已开始承接 `modules.py` 的语言检测、翻译决策与 parsed module upsert
  - `module_parse_websocket_service.py` 已承接 `modules.py` 的 `/ws/parse/{file_id}` 与 `/ws/parse-v2/{file_id}` 的 parse 任务编排、恢复与异常回写路径
  - `module_translation_service.py` 已开始承接 `modules.py` 的 translate SSE 与单章节翻译主流程
  - 以下 route 已清掉直接 `broadcast_to_campaign/send_to_recipients`：
    - `combat.py`
    - `characters.py`
    - `tokens.py`
    - `campaign_storage.py`
    - `spell_cast.py`
    - `chat.py`
    - `map_markers.py`
    - `chests.py`
    - `campaigns.py`
- 测试：
  - 前端已补 event bus / campaign shell 相关 Vitest
  - TacticalMap 第一批控制器切片与地图交互事件边界已补 focused tests，并通过 `npm run typecheck`；当前 spell/support/domain/transformation/hotbar-recovery/target-save-effect/generic-activation/routing/feature-admin 这组 focused suite 继续保持通过，新增的 maneuver focused suite 为 `5 files / 17 tests passed`，攻击结果 typed-bus 边界的 focused suite 为 `5 files / 16 tests passed`，monster action controller focused suite 为 `4 files / 13 tests passed`，weapon attack cleanup focused suite 为 `4 files / 13 tests passed`
  - 后端已补 publisher / character service / combat service 相关 pytest
  - `module_chat / modules` 第二阶段拆分也已补单测；当前一组 focused backend 回归可稳定通过 `116 passed, 1 warning`
  - 本轮 `modules websocket parse` focused 回归通过 `22 passed, 1 warning`

因此，下面各阶段可以理解为：

- Phase 0 / 0.5：大部分已启动且关键项已落地
- Phase 1：已实做过半
- Phase 2：已进入主热点拆分期并基本收尾
- Phase 3：已启动第一批平台化与标准化工作

当前这一轮 Phase 3 已经落地的最小平台层包括：

- 后端 runtime schema：
  - `backend/app/schemas/token_runtime.py`
  - `backend/app/schemas/character_runtime.py`
  - `backend/app/schemas/combat_runtime.py`
  - `backend/app/schemas/spell_runtime.py`
  - `backend/app/services/runtime_schema_service.py`
  - `backend/app/services/spell_runtime_service.py`
  - `backend/app/models/spell_runtime_instance.py`
- 前端统一 server-state 入口：
  - `frontend/app/queries/campaignQueries.ts`
  - `frontend/app/queries/characterQueries.ts`
  - `frontend/app/queries/combatQueries.ts`
  - `frontend/app/queries/moduleQueries.ts`
  - `frontend/app/queries/queryClient.ts`
- 前后端统一传输/鉴权边界：
  - `backend/app/core/dependencies.py`
  - `frontend/app/utils/api-client.ts`
  - `frontend/app/services/api.service.ts`
  - `frontend/app/hooks/useWebSocket.ts`
  - `frontend/app/hooks/useReconnectingWebSocket.ts`
  - `docs/architecture/TRANSPORT_AND_AUTH_GUIDE.md`
- 已接入/改造的第一批边界：
  - `tokens.py`、`characters.py`、`campaign_storage.py`
  - `character_action_service.py`、`combat_check_usecase_service.py`
  - `spell_cast.py`、`combat.py`、`grantedActions.ts`、`SelectionContextMenu.tsx`、`Hotbar.tsx`
  - `CharacterPanel.tsx`
  - `usePlayerCharacters.ts`
  - `characterCache / campaignMembersCache / characterResourcesCache / combatStateCache / moduleMapsCache`
  - `map_bulk_data.py / chat.py`
  - `ChatPanel.tsx / CombatPanel.tsx / useMapData.ts`
  - `quest_progress.py / campaign_templates.py / cover_library.py / map_library.py / ai_settings.py / rules_chat.py`
  - `CreateCampaignDialog.tsx / CampaignSettingsDialog.tsx / APISettings / APIUsage / Rules_AIQueryTab / map-library.tsx`
  - `useMapViewStateController.ts` 的 keepalive bearer flush

当前 spell runtime 这条线已经完成的首个纵向试点是 `Hex / 脆弱诅咒`：

- `spells.json` 继续作为唯一规则源，但 `Hex` 已切到 `runtime.engine = "v2"`
- 施法时的属性选择已升级成正式 `castOptions` 输入，不再默认静默落到第一个 option
- 活跃法术状态不再只拼在 token JSON 上，而是落到 `spell_runtime_instances`
- token 展示改为读取后端投影的 `spell_overlays / spell_badges / granted_actions_ui / attached_runtime_refs`
- 目标死亡后的“转移诅咒”入口改为后端 runtime action 决定可见性，不再由前端静态 JSON 自行推导
- 命中追加伤害、专注中断、目标倒地后的动作解锁，都开始走统一 runtime service

### Phase 3 completion criteria（当前执行口径）

- 契约门槛：
  - app-facing HTTP：bearer-only
  - app-facing WS：token-only
  - 主业务链不再依赖 `X-User-ID` / `user_id` / `role` 作为调用者身份来源
  - campaign member 子接口主路径统一 `/me`（selected-character / notes / sidebar-state）
- 代码门槛：
  - server-state 读取统一走 `apiFetch + React Query domain queries`
  - runtime 高风险 JSON 统一走 `runtime_schema_service` normalize/validate（禁止裸 `Dict[str, Any]` 穿透主链）
  - 不再新增新的 raw DOM 应用级桥
- grep 门槛：
  - `frontend/app` 内 `X-User-ID|?user_id=|&user_id=|?role=|&role=` 业务主路径清零
  - `backend/app/api/routes` 内 `alias="X-User-ID"` 与 `user_id/role Query` 身份入口清零
- 测试门槛：
  - 前端 `npm run typecheck`
  - focused Vitest（queries / transport / map runtime controllers）
  - 后端 focused pytest + touched routes `py_compile`
  - DM / Player Playwright smoke（含网络预算断言）
  - 固定 smoke 命令：
    - `npx playwright test debug/phase3_budget_smoke.spec.ts --config playwright.config.ts`
  - 5 秒预算门槛：
    - `campaign/map-settings/combat/map-bulk-data/tokens` 各 `<=1`
    - `chat/messages <=2`
    - console `0 errors`

对于当前主线，Phase 2 的实际推进顺序已经进一步明确为：

1. 继续拆 `module_chat.py` 的 encounter planning / AI 编排链
2. `modules.py websocket parse` 主流程、恢复与失败回写边界已基本收口，`frontend/app/components/map/TacticalMap.client.tsx` 第一批控制器切片已经启动
3. TacticalMap 现在已经把 `context menu / long-press / shop-chest modal` 推进到 controller 层，也把 `token select/open/external select` 主控制链推进到了 `useMapTokenInteractionController.ts`；`token drag` 持久化与 zone settle 检查也已推进到 `useMapTokenDragController.ts`；`item / loot bag / shop token` 这组 inventory 编排已推进到 `useMapInventoryController.ts`；`place shop / place character / place my token` 已推进到 `useMapPlacementController.ts`；`player move / cast spell / use ability / toggle reaction` 已推进到 `useMapPlayerActionController.ts`；`status effect / concentration / ritual casting / casting confirm` 已推进到 `useMapStatusController.ts`；`minimap navigate / focus token / focus players / anchor jump-clear / avatar click` 已推进到 `useMapFocusController.ts`；marker 选中、创建、删除与 marker dialog 状态也已推进到 `useMapMarkerController.ts`；viewport globals、resize、视野状态保存与 beforeunload flush 已推进到 `useMapViewStateController.ts`；到时施法自动结算与去重触发已推进到 `useMapDueCastResolution.ts`；手动反应模式、反应消费后的自动清理、初始回合读取与 active turn 实时跟踪已推进到 `useMapCombatRuntimeController.ts`；touch-device 检测、right offset 计算与 DM bubble 生命周期已推进到 `useMapUiChromeController.ts`；角色 feature uses 同步与 roll modifier 外部事件同步已推进到 `useMapExternalSyncController.ts`；terrain 本地更新、debounced 持久化与 terrain 广播已推进到 `useMapTerrainController.ts`；native touch listener、iOS gesture pinch 与 ruler multi-touch 手势桥接已推进到 `useMapTouchGestureController.ts`；chest/shop/item/note/illusion 的 modal 派生数据已推进到 `useMapModalData.ts`；`MapActionMenus.tsx`、`MapSelectionMenuLayer.tsx`、`MapPlayerSpellDialog.tsx`、`MapStatusDialogs.tsx`、`MapMarkerAndConfirmDialogs.tsx` 与 `MapSpecialActionDialogs.tsx` 已把主组件尾部大部分 menu/dialog/modal render layer 持续抽薄；`token open` 的后置执行事件流和 `layOnHandsTarget / combatReactionUsed` 也已经收进 `appEventBus`；下一步继续拆剩余散落的 modal callback/side-effect 编排与 map runtime side-effect 层

---

## 1. 这份路线图解决什么问题

它不是“理想中的完美重写方案”，而是面向当前系统现实情况的**增量重构路线图**。

我们面对的实际情况是：

- 功能已经很多，不能停下来大修
- 架构主方向没错，不需要推倒重来
- 但热点区域边界开始失守
- 如果继续按现状加功能，复杂度会越来越快地积累

所以这份路线图的核心原则是：

- **不做大爆炸重写**
- **先收边界，再谈重组**
- **让新代码先走新路径**
- **用阶段性收益换长期演进空间**

---

## 2. 重构总目标

这轮重构建议围绕 6 个总目标推进：

1. 收敛前端跨组件通信方式
2. 降低前端超级热点文件复杂度
3. 把后端关键业务从 route 层回收到 service 层
4. 统一 API 契约与鉴权方式
5. 给高频 JSON 运行态补类型边界
6. 让实时事件发布有统一出口

如果这 6 件事完成 60%-70%，系统维护体验会有非常明显的提升。

---

## 3. 重构原则

## 3.1 先收口，再重组

不要先改目录，不要先改命名，不要先追求“看起来更优雅”。

先做：

- 新增统一入口
- 禁止继续扩散旧模式
- 让增量代码先走新方式

## 3.2 先治理高频热点

优先级顺序建议：

1. 地图与战役壳层
2. 角色与战斗后端
3. API 契约与实时事件
4. 数据契约类型化
5. 目录结构优化

## 3.3 每一轮都必须可交付

每个阶段都要满足：

- 可以单独合并
- 可以单独验证
- 能给团队带来局部收益

## 3.4 不追求一次性完成

这个项目的复杂度决定了：

- 三周做不完
- 一次 PR 做不完
- 一次设计定不完

正确做法是：

- 用 2-6 周完成第一轮收口
- 再用后续迭代持续清理

---

## 4. 建议的总体节奏

建议分为四个阶段：

- **Phase 0：冻结扩散**
- **Phase 0.5：关键路径测试补全**（补充审计新增）
- **Phase 1：收边界**
- **Phase 2：拆热点**
- **Phase 3：平台化与标准化**

如果团队节奏较快，可以按 6-10 周规划。  
如果团队节奏较慢，也可以按季度推进。

---

## 5. Phase 0：冻结扩散

**目标**：先别让旧问题继续恶化。

### 5.1 前端建立“新代码准入规则”

建议规则：

- 新增跨组件通信，不再直接新增裸 `window.dispatchEvent`
- 新增 server state 优先考虑 React Query 或明确 cache util
- 新增战役页逻辑，不直接继续堆进 `campaign.$id.dm.tsx` / `campaign.$id.player.tsx`

### 5.2 后端建立“新逻辑准入规则”

建议规则：

- 新增复杂业务不要直接堆进 route
- route 只做鉴权、参数校验、调用 service、返回响应
- 新增广播优先走统一 helper，而不是散发在各个 route 中

### 5.3 给文档补统一入口

建议把下面几份文档当成当前治理入口：

- `docs/architecture/ARCHITECTURE_REVIEW_2026.md`
- `docs/architecture/REFACTORING_ROADMAP_2026.md`
- `docs/PROJECT_OVERVIEW.md`

### Phase 0 完成标准

- 团队知道哪些旧模式不再继续扩散
- 新代码评审能用统一标准判断
- 文档上已经形成共识入口

### Phase 0 当前状态

- 已基本完成
- 现状中最核心的“旧模式冻结”已经进入代码层面，而不只是文档约定

---

## 5.5 Phase 0.5：关键路径测试补全（补充审计新增）

> 本节基于补充审计（ARCHITECTURE_REVIEW_2026.md Section 11.8）新增。测试覆盖不足是当前项目风险最高的单一问题，直接影响后续重构的可行性。

**目标**：为即将重构的热点模块补充最低限度的测试保护网，使 Phase 1-2 的重构不至于"盲拆"。

### 5.5.1 后端关键路径测试

优先为以下模块补充 pytest 测试：

| 优先级 | 模块 | 理由 | 目标测试类型 |
| ---- | ---- | ---- | ---- |
| P0 | `characters.py` 核心 CRUD | Phase 2 拆分目标，~7000 行无充分保护 | API 集成测试 |
| P0 | `combat.py` 攻击/施法流程 | Phase 2 拆分目标 | API 集成测试 |
| P0 | `spell_resolver.py` 主流程 | 1460 行核心规则引擎 | 单元测试 |
| P1 | `effect_service.py` | 新的统一效果服务 | 单元测试 |
| P1 | WebSocket 消息路由 | 实时通信核心 | 集成测试 |
| P2 | `module_chat.py` | AI 交互流程 | Mock 集成测试 |

**完成标准**：至少为 P0 模块各补充 5-10 个核心场景测试，确保重构时有回归保护。

### 5.5.2 前端类型安全与 E2E

| 任务 | 说明 |
| ---- | ---- |
| `typecheck` 清零 | 确保 `npm run typecheck` 无错误 |
| 战役页 E2E | 为 DM/Player 页面补充基本 Playwright 测试 |
| 地图交互 E2E | Token 拖拽、缩放等基本交互回归 |

### 5.5.3 前端 API 客户端收敛

在测试补全的同时，明确前端 HTTP 客户端的收敛策略：

| 客户端 | 决定 | 说明 |
| ---- | ---- | ---- |
| `api-client.ts` | **逐步退役** | 老封装，新代码不再使用 |
| `typed-api-client.ts` | **保留** | 类型化客户端，适合简单调用 |
| `fetchWithRetry.ts` | **保留** | 重试场景专用 |
| `services/api.service.ts` | **主推** | 新 service 层基类，新功能优先使用 |

### 5.5.4 手写 Cache 退役路线

明确 11 个手写 cache 文件的退役节奏：

- **Phase 0.5**：冻结，不再新增手写 cache
- **Phase 1**：新功能使用 React Query 或 service 层
- **Phase 3**：逐个将现有 cache 迁移到 React Query，按业务模块分批退役

### Phase 0.5 完成标准

- P0 模块各有 5-10 个核心测试
- `npm run typecheck` 无错误
- 前端 API 客户端收敛策略已确定并记录
- 手写 cache 冻结规则已加入代码评审标准

### Phase 0.5 当前状态

- 已部分完成，并且关键风险点已显著下降
- `characters/combat/spell` 相关后端关键路径已经有一批可运行测试保护
- 仍未完成项：
  - Playwright 的稳定战役级回归
  - 后端全量 `pytest` 环境清理

---

## 6. Phase 1：收边界

**目标**：先把最关键的“通信边界”和“业务边界”收起来。

## 6.1 工作流 A：前端事件总线收口

### 当前问题

前端存在 80+ 个自定义事件名，地图、角色、快捷栏、战役页之间靠 DOM 事件大量串联。

### 目标

引入一个统一的 typed event bus 或等价收敛层。

建议方案：

- 新建 `frontend/app/events/` 或 `frontend/app/domain-events/`
- 统一定义事件类型、payload schema、发布与订阅函数
- 外部不再直接写裸 `new CustomEvent(...)`

### 第一批优先收口的事件

- `characterUpdated`
- `characterEquipmentUpdated`
- `classFeatureUsesUpdated`
- `consumeSpellSlot`
- `spellCastChat`
- `startAbilityTargeting`
- `combatActionUsed`
- `rewardUpdate`
- `characterConcentrationChanged`
- `characterCastingChanged`

### 结果

- 事件名字可枚举
- payload 有类型
- 查调用链更容易
- 以后迁到 store 也更顺滑

## 6.2 工作流 B：后端实时发布层收口

### 当前问题

广播调用散落在 route、service、handler 中。

### 目标

新增一层 `event_publisher` 或 `realtime_publisher`。

建议结构：

- `backend/app/services/realtime_publisher.py`
- 提供领域语义方法，例如：
  - `publish_character_updated(...)`
  - `publish_token_hp_updated(...)`
  - `publish_trade_updated(...)`
  - `publish_combat_storage_updated(...)`

### 收益

- payload 结构统一
- route 不再关心消息形状
- 更方便补监控和审计

## 6.3 工作流 C：API 契约统一策略确定

### 当前问题

- 前缀不统一
- 鉴权方式混用

### 目标

先定规范，再逐步迁移：

- 外部 API 统一目标前缀：`/api/...`
- 鉴权长期目标：Bearer 为主
- `X-User-ID` 只保留在兼容阶段

### 不要求本阶段全部迁移完

本阶段只要求：

- 规范确定
- 新增接口遵守
- 老接口开始登记清单

### Phase 1 完成标准

- 前端事件开始有统一封装
- 后端广播开始有统一出口
- 新接口规范确定

### Phase 1 当前状态

- 已明显过半
- 前端事件封装已落地
- 后端统一广播出口已经覆盖主战斗、角色、地图 token、campaign storage、spell cast、chat、marker、chest、campaign 选择链路

---

## 7. Phase 2：拆热点

**目标**：把最重的几个中心文件拆成可持续维护的结构。

### Phase 2 当前状态

- 已进入实施期
- `combat.py`、`characters.py` 已完成第一批 service 化
- `campaign.$id.dm.tsx` / `campaign.$id.player.tsx` 已完成第一批共享壳层抽取
- route 级 realtime 出口收口已经覆盖：
  - `combat.py`
  - `characters.py`
  - `tokens.py`
  - `campaign_storage.py`
  - `spell_cast.py`
  - `chat.py`
  - `map_markers.py`
  - `chests.py`
  - `campaigns.py`
  - `character_crud.py`
  - `voice.py`
  - `resource_chat.py`
  - `monster_instances.py`
  - `module_chat.py`
  - `websocket_simplified.py`
- 当前剩余的核心热点已从“route 直发广播”转向“超大文件拆分与 service 深化”：
  - `module_chat.py` 的 AI 生成/实体创建主流程还很重，但其纯逻辑和头像后台任务已开始拆到 `module_entity_service.py`、`module_avatar_generation_service.py`
  - `modules.py` 的模组处理路径仍然庞大
  - `frontend/app/components/map/TacticalMap.client.tsx` 仍然是前端最大热点

## 7.1 工作流 D：拆前端战役壳层

目标文件：

- `frontend/app/routes/campaign.$id.dm.tsx`
- `frontend/app/routes/campaign.$id.player.tsx`

建议切分维度：

- 页面壳层与布局
- WebSocket 消息编排
- 面板装配
- 快捷栏与目标选择
- 战役级状态与上下文
- 弹窗状态机

建议产物：

- `campaign-shell/`
- `campaign-realtime/`
- `campaign-panels/`
- `campaign-hotbar/`
- `campaign-modals/`

## 7.2 工作流 E：拆地图主控

目标文件：

- `frontend/app/components/map/TacticalMap.client.tsx`

建议切分维度：

- 视口与缩放
- token 交互
- targeting
- combat overlays
- spell overlays
- selection / context menu orchestration
- item / chest / shop token flow
- touch / keyboard / input handling

目标不是“拆成几十个无状态组件”，而是形成几个明确的领域控制器。

## 7.3 工作流 F：拆后端角色与战斗 route

目标文件：

- `backend/app/api/routes/characters.py`
- `backend/app/api/routes/combat.py`
- `backend/app/api/routes/modules.py`
- `backend/app/api/routes/module_chat.py`

建议切分方式：

- route 保留 HTTP 入口
- 新增 application service 层承接用例

例如：

- `character_leveling_service.py`
- `character_resources_service.py`
- `combat_attack_service.py`
- `combat_spell_service.py`
- `module_parse_usecase.py`
- `module_chat_usecase.py`

### 判断拆分是否成功的标准

不是“文件变小了”，而是：

- route 读起来像流程入口
- 业务规则在 service
- 广播在 publisher
- DTO 在 schema

### Phase 2 完成标准

- 至少 3 个超级热点文件完成第一轮职责拆分
- 新增逻辑优先写进新 service，不再回流旧大文件

---

## 8. Phase 3：平台化与标准化（已启动）

**目标**：把前两阶段收出来的边界固化成长期结构。

## 8.1 工作流 G：高频运行态类型化

优先对象：

- `Token` runtime payload
- `Character.class_feature_uses`
- `active_effects`
- `concentration_spell`
- `casting_in_progress`

建议做法：

- 先加 Pydantic schema / typed dict
- 再在读写路径收口校验
- 最后再视需要做数据库层优化

当前已落地：

- token runtime schema 已进入 `tokens.py`
- character runtime schema 已进入 `characters.py`、`character_action_service.py`、`combat_check_usecase_service.py`
- combat runtime schema 已进入 `campaign_storage.py`
- 前端镜像类型入口已新增到 `frontend/app/types/runtime.ts`

## 8.2 工作流 H：统一 server state 策略

前端要逐步明确：

- 哪些状态由 React Query 管
- 哪些由 store 管
- 哪些只允许局部 state
- 哪些 cache util 可以退役

建议优先治理：

- 战役成员
- 角色详情
- 战斗态
- 模块地图绑定

当前已落地：

- `campaignQueries.ts`
- `characterQueries.ts`
- `combatQueries.ts`
- `moduleQueries.ts`
- 旧 cache util 已开始退化为 QueryClient 包装层，而不是继续维护独立缓存实现

## 8.3 工作流 I：目录与 bounded context 重组

当边界稳定后，可以考虑做更长期的目录调整。

建议的后端上下文划分：

- `campaign`
- `character_rules`
- `map_realtime`
- `combat_spell`
- `module_knowledge`
- `ai_infra`
- `asset_voice`

建议的前端上下文划分：

- `campaign-shell`
- `map-runtime`
- `character-runtime`
- `combat-runtime`
- `knowledge-panels`
- `platform-services`

### Phase 3 完成标准

- 高频运行态有类型边界
- 状态管理方式收敛
- 新代码进入更稳定的领域结构

### Phase 3 当前状态

- 已启动
- 当前重点不是大搬家，而是把已拆出来的边界固化成长期规则
- 已新增文档：
  - `docs/architecture/RUNTIME_SCHEMA_CATALOG.md`
  - `docs/architecture/SERVER_STATE_GUIDE.md`

---

## 9. 建议的优先级清单

按收益 / 风险比排序，建议这样做：

### 最高优先级（Phase 0.5 — 补充审计新增）

0. **关键路径测试补全** — 这是所有后续重构的前提条件
1. **前端 API 客户端收敛策略确定** — 冻结旧模式
2. **手写 cache 冻结** — 不再新增

### 第一优先级

1. 前端事件总线收口
2. 后端实时发布层收口
3. 战役页壳层拆分

### 第二优先级

1. 地图主控拆分
2. `characters.py` 与 `combat.py` 的 application service 化
3. API 契约和鉴权统一规范

### 第三优先级

1. 高频 JSON 运行态类型化
2. React Query / cache / store 分工收敛（含手写 cache 退役）
3. 目录级 bounded context 重组（含 domain 层建设）

---

## 10. 每个阶段的交付物建议

## Phase 0 交付物

- 架构审计文档
- 重构路线图
- 团队约束清单

## Phase 0.5 交付物（补充审计新增）

- P0 模块核心场景 pytest 测试（characters、combat、spell_resolver）
- `npm run typecheck` 清零
- 战役页基本 E2E Playwright 测试
- API 客户端收敛策略文档
- 手写 cache 冻结规则

## Phase 1 交付物

- `frontend/app/events/` 或等价统一事件层
- `backend/app/services/realtime_publisher.py`
- API 规范文档

## Phase 2 交付物

- DM/Player 壳层拆分 PR
- TacticalMap 第一轮拆分 PR
- character/combat 用例服务层 PR

## Phase 3 交付物

- 高风险 JSON schema 文档
- 统一状态管理指南
- bounded context 目录优化方案

---

## 11. 风险与注意事项

## 11.1 不要同步推进太多工作流

最容易失败的情况是：

- 地图拆分
- 战役页拆分
- characters/combat 拆分
- API 契约迁移

同时全开。

建议同一时间最多推进两个主工作流。

## 11.2 不要在没有保护网时做大重构

每轮重构前至少要有：

- 基本手工验证清单
- 前端 `typecheck`
- 关键路径 pytest
- 主要 WebSocket 行为可回归

## 11.3 不要先搬目录再改逻辑

先搬目录只会让 diff 更难看，风险更高。

正确顺序是：

1. 收边界
2. 抽入口
3. 迁逻辑
4. 最后再调目录

---

## 12. 一份更现实的 10 周计划

这里只给一个现实可落地的节奏示例。（原 8 周计划因补充审计调整为 10 周）

### 第 1-2 周（Phase 0.5）

- 为 `characters.py`、`combat.py`、`spell_resolver.py` 补充核心场景 pytest
- 确保 `npm run typecheck` 清零
- 确定前端 API 客户端收敛策略，冻结手写 cache 新增
- 补充战役页基本 E2E 测试

### 第 3-4 周（Phase 1 前半）

- 建统一事件层
- 建 realtime publisher
- 列 API 契约迁移清单

### 第 5-6 周（Phase 1 后半）

- 拆 DM / Player 页中的 WebSocket 与 modal orchestration
- 让新功能不再继续堆进原文件

### 第 7-8 周（Phase 2 前半）

- 拆 TacticalMap 的 targeting、overlays、token interaction
- 同时给高频事件补类型

### 第 9-10 周（Phase 2 后半）

- 把 `characters.py` / `combat.py` 抽出第一批用例 service
- 补统一 payload schema

这个阶段结束后，系统不会“焕然一新”，但会明显从“继续堆功能会越来越难”变成“继续演进还有秩序”。

补充到当前实际进度：`grantedActions.ts`、`sidebarCasting.ts`、`FloatingCharacterPanel.tsx` 与 `useMapSidebarSpellController.ts` 已把 `startSpellTargeting` 从 raw DOM 事件桥切到 `publishAppEvent()/subscribeAppEvent()`，因此授予动作、侧边栏施法、浮动角色面板自动最小化与地图侧 targeting 已开始共享同一条 typed bus 边界；`useMapSidebarSpellController.ts` 也已把 `sidebarSpellCast` 的 consumer 切到 `subscribeAppEvent()`，让 DM/Player route 到 TacticalMap 的侧边栏施法桥接先脱离 raw DOM 监听；`actionEffectHandlers.ts` 也已把 `combatBonusActionResult` 的残余 producer 切到 `publishAppEvent()`，让 data-driven bonus action 效果链离开 raw DOM 直发；`BagDialog.tsx` 与 `Hotbar.tsx` 也已把 `hotbar-add-item / hotbar-drop-to-slot` 切到 typed bus，让背包拖拽和“添加到快捷栏”这条高频桥接离开 legacy DOM 事件；`openEventBridge.ts`、`FeatureDetailDialog.tsx` 与 `useMapBonusActionRoutingController.ts` 也已统一 `execution.openEvent` 的桥接规则，让 `wildShapeTarget / arcaneRecoveryTarget / flexibleCastingTarget / naturalRecoveryTarget` 优先走 typed bus，未知 opener 再回退 legacy DOM 事件；`ClassicCharacterCard.tsx` 也已把 `equipmentConsumableUse` 的 producer 切到 `publishAppEvent()`，在不改旧 `CharacterPanel` consumer 的前提下先收掉角色卡的 raw DOM 直发；`LevelUpNotification.tsx` 也已把 `characterLevelUp` 的 clean consumer 切到 `subscribeAppEvent()`，让升级提示开始和 typed bus 接轨，同时继续兼容旧 route/面板的 raw DOM 事件；`characterBubble.ts` 与 `diceRequestBubble.ts` 也已把角色头像气泡、回复消息、私信启动、DM 骰子请求/响应/忽略 这组 util 事件桥切到 `publishAppEvent()/subscribeAppEvent()`；`CombatActionModal.tsx` 也已把 `openCombatActionModal` 的 clean consumer 切到 `subscribeAppEvent()`，让战斗动作弹窗开始和 typed bus 接轨，同时继续兼容 legacy producer；`sidebarCasting.ts`、`useUnreadChat.ts` 与 `characterResourcesCache.ts` 也已把 `spellCastStarted`、`ws-chat-message` 与 `classFeatureUsesUpdated` 的 clean producer/consumer 切到 `publishAppEvent()/subscribeAppEvent()`，让长施法起始、未读聊天和角色资源缓存失效回到统一事件边界，同时继续兼容旧事件名；`useMapExternalSyncController.ts` 也已把 `openTokenParamsEditor / tokenHPUpdate / selectTokenByCharacterId / selectCharacterFromMap / removeCharacterTokens / focusOrCreateToken` 这一组 TacticalMap 与面板外部桥接收进 controller，让参数编辑、角色选中、角色 HP 写回、角色踢出后的 token 删除以及角色面板双击后的聚焦/补建 token 不再散落在主组件里；`TacticalMap.client.tsx` 也已把 `anchorPlaced` 的 producer 切到 `publishAppEvent()`，让锚点设置后的 DM 侧联动离开 raw DOM 直发，同时继续兼容旧 listener；`campaignRealtimeBridge.ts` 也已把 `combatStorageUpdated / combatStorageDeleted` 的 producer 切到 `publishAppEvent()`；DM/Player route 侧的 `ws-chat-message / sidebarSpellCast / characterLevelUp / tokenHPUpdate` 这几条 clean producer 也开始改走 typed bus，让战役 realtime bridge 和 hotbar 施法桥接少依赖 raw DOM 直发；`ClassicCharacterCard.tsx` 与 `useCampaignHotbarBindings.ts` 也已把 `equipmentWeaponUse` 切到 typed bus，让装备菜单到 hotbar 武器 targeting 的桥接离开 legacy DOM 事件；`TokenModal.tsx` 与 `useCampaignPanelOrchestration.ts` 也已把 `openRightPanelTab` 切到 typed bus，让地图 token 互动后跳转聊天侧栏的桥接离开 raw DOM 事件；`Toast.tsx`、`HotbarSlotItem.tsx`、`ClassicCharacterCard.tsx`、`useKeyboardMovement.ts` 与 `useMapTokenDragController.ts` 也开始把 `showToast` 切到 typed bus，让高频提示链逐步脱离 raw DOM；`campaign.$id.dm.tsx`、`CombatPanel.tsx`、`CharacterPanel.tsx` 与 `useMapWebSocket.ts` 这轮也继续把剩余的 clean `showToast` producer 切到 `publishAppEvent()`，让 DM 回合结算、战斗持续效果提示、角色面板提示与地图 websocket 生成物提示继续回到统一事件边界；`campaign.$id.player.tsx` 这轮也继续把 `spellSlotsChanged / layOnHandsTarget / tokenRemoved` 的 clean producer 切到 `publishAppEvent()`，让玩家页的法术位同步、圣疗 targeting 与角色 token 删除刷新回到统一事件边界；同一个 Player route 里自闭环的 `characterCreated / aiGenerateProgress` 这轮也开始改走 `publishAppEvent()/subscribeAppEvent()`，让角色创建与 AI 生成进度提示离开 raw DOM 事件；`campaign.$id.dm.tsx / campaign.$id.player.tsx / CharacterPanel.tsx / ChatPanel.tsx / CharacterDisplay.tsx` 这轮也继续把 `characterSelected / spellSlotsUpdate / characterLevelChanged` 这组 producer 与 clean consumer 切到 typed bus，让角色选择、法术位后端回写桥和玩家页等级变化提示继续离开 raw DOM 事件；`campaign.$id.dm.tsx / CharacterPanel.tsx` 这轮也继续把 `dm_generate_progress -> ws_message` 这条专用桥收成 `dmGenerateProgress` typed bus，让 DM AI 角色生成进度离开专用 raw DOM 事件；`CharacterPanel.tsx / campaign.$id.player.tsx` 这轮也继续把 `equipmentConsumableUse / rewardUpdate / characterLevelUp` 的 clean consumer 切到 `subscribeAppEvent()`，让角色面板与玩家页的物品使用、奖励刷新和升级刷新离开 raw DOM 监听；`CharacterPanel.tsx` 这轮也继续把 `startAbilityTargeting / removeCharacterTokens / selectTokenByCharacterId / focusOrCreateToken` 这几条已有 typed 契约的 producer 切到 `publishAppEvent()`，让角色面板到地图/热栏的外部桥继续离开 raw DOM 事件；`campaign.$id.player.tsx` 这轮也继续把 `classFeatureUsesUpdated / characterConcentrationChanged / characterCastingChanged / restGrant / characterUpdated / characterEquipmentUpdated` 的 clean consumer 切到 `subscribeAppEvent()`，并把 `trade_confirm` 后的角色刷新改成 `publishAppEvent("characterUpdated")`，让玩家页这批资源/专注/施法/奖励/交易刷新桥继续离开 raw DOM；`CombatActionModal.tsx`、`InitiativeTracker.tsx`、`CombatTurnOverlay.tsx` 与 `useMapCombatRuntimeController.ts` 也已把 `combatStorageUpdated / combatStorageDeleted` 的 consumer 切到 `subscribeAppEvent()`，为后续把 realtime bridge 彻底收进 typed bus 先铺平消费边界。
同一条前端事件收口线上，`campaign.$id.dm.tsx / ChatPanel.tsx` 这轮也把 `restGrant / combatNewRound / anchorPlaced / selectCharacterFromMap / openRightPanelTab` 这组 clean producer 与 consumer 切到 `publishAppEvent()/subscribeAppEvent()`，让 DM route 的休息广播、战斗回合同步、锚点联动、地图选角和聊天侧栏跳转继续离开 raw DOM 事件桥。
同一条线上，`campaignRealtimeBridge.ts / campaign.$id.player.tsx` 这轮也把 `characterListNeedsRefresh` 和 `player-main restGrant` 收到 `publishAppEvent()/subscribeAppEvent()`，让玩家页角色创建后的列表刷新与休息广播继续离开 raw DOM 事件桥。
同一条线上，`campaign.$id.player.tsx` 这轮也把 companion 检测里的 `ws:token_placed / ws:token_removed` consumer 切到 `subscribeAppEvent("tokenPlaced" / "tokenRemoved")`，让玩家页 token 放置/删除同步继续离开 raw DOM 事件桥。
同一条线上，`CombatPanel.tsx` 这轮也把 `combatStorageUpdated / combatStorageDeleted` 的残余 raw consumer 切到 `subscribeAppEvent()`，让战斗面板的战斗存储同步和 typed bus 完全对齐。
同一条线上，`CharacterPanel.tsx / useMapWebSocket.ts` 这轮也把圣击 targeting 入口统一回 `startAbilityTargeting`，并退役了 `spellCastResult / shopInventoryUpdated` 这两条已经没有 consumer 的 runtime 死桥，让地图 websocket 到面板/热栏的边界继续收薄。
同一条线上，`CombatPanel.tsx` 这轮也把 `sendWebSocketMessage` 死桥改成了显式 `sendMessage` prop，同时 `campaign.$id.dm.tsx -> TacticalMap -> useMapData.ts` 也用 `drawingsRefreshVersion` 替代了 `drawingsRefresh` raw DOM 事件，让战斗奖励发放和 DM 撤销绘图都回到显式数据流。
同一条线上，`TacticalMap.client.tsx` 这轮继续把剩余顶层 heavy handler 收进了 `useMapMovementRuntimeController.ts`、`useMapInventoryAndPlacementController.ts` 与 `useMapSelectionActionController.ts`，让 movement runtime、inventory-placement 与 selection combat actions 不再散落在主组件里，同时补上了对应 focused Vitest。
后端第二批 route-thinning 也已继续启动：`combat.py` 的 `perform_ability_check / perform_contest` 已收进 `combat_check_usecase_service.py`，`characters.py` 的 `feature-uses / resources/restore / resources/set` 已收进 `character_action_service.py`，并已补上 focused pytest。

---

## 13. 成功标准

如果这轮重构做得对，应该看到这些变化：

- 新功能开发时，不再需要随手新增一个 `CustomEvent`
- route 文件不再持续变胖
- 实时消息 payload 更统一
- 新人能更容易回答“这个状态到底归谁管”
- 角色、战斗、地图相关改动的回归范围更可控

---

## 14. 最后的建议

对这个项目来说，最优策略不是“追求最漂亮的架构”，而是：

- 保护已经成熟的产品能力
- 逐步收敛边界
- 降低热点区域的认知负担
- 让系统在继续长大的同时不至于失控

所以这份路线图的重点从来不是“重写”，而是：

- **让复杂度停止无序增长**
- **让系统重新回到可持续演进轨道**
