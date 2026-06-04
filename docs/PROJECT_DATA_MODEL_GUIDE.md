# 项目数据模型篇

本文档聚焦 `backend/app/models/`，目标是帮助你从“业务对象与状态”角度理解项目，而不是只背表名。

配套文档：

- 总览：`docs/PROJECT_OVERVIEW.md`
- 新同事上手：`docs/ONBOARDING_30_MIN.md`
- 前端篇：`docs/PROJECT_FRONTEND_GUIDE.md`
- 后端篇：`docs/PROJECT_BACKEND_GUIDE.md`

## 1. 先用一句话理解当前数据模型

这个项目的数据模型不是传统纯范式化业务库，而是：

- 关键主实体用关系表承载
- 大量运行时明细放在 JSON / JSONB 字段里
- 前后端共同维护一部分派生状态

换句话说，它更像“关系表骨架 + JSON 业务负载”的混合模式。

## 2. 为什么会这样

这个项目的业务有几个特点：

- D&D 规则天然复杂，职业、法术、状态、资源结构变化很多
- 模组解析和 AI 结果不适合完全刚性建模
- 地图运行态和战斗状态变化频繁
- 很多实体需要快速演进，而不是每次都做大规模 schema 迁移

所以当前模型层大量使用：

- `JSON`
- `JSONB`
- 可空外键
- 多态 token

这带来了灵活性，也带来了维护成本。

## 3. 读模型时先看哪几类

建议按下面顺序理解：

1. 用户与战役
2. 角色与 token
3. 地图状态
4. 资源与实体
5. 模组与知识库
6. AI 配置

## 4. 用户与战役域

核心模型：

- `user.py`
- `campaign.py`
- `campaign_storage.py`
- `campaign_storage_acl.py`
- `campaign_template.py`

### 4.1 `User`

核心字段：

- `id`
- `username`
- `email`
- `role`
- `resterlab_user_id`
- `preferences`

这个表不直接存密码，而是更像：

- 本地身份映射
- 角色/偏好持久化
- 平台内补充资料

### 4.2 `Campaign`

核心字段：

- `id`
- `name`
- `dm_user_id`
- `max_players`
- `current_players`
- `status`
- `description`
- `meta` 映射数据库列 `metadata`
- `current_map_url`
- `selected_module_id`
- `cover_image`

其中 `meta` 很重要，它承载了不少“战役级开关和扩展信息”，而不是把这些都拆成列。

### 4.3 `CampaignMember`

核心字段：

- `campaign_id`
- `user_id`
- `role`
- `selected_character_id`
- `is_virtual`
- `display_name`
- `notes`

这个表同时承担：

- 真玩家成员
- 虚拟成员
- 当前选中角色
- 玩家笔记

所以战役成员不是单纯 join table。

### 4.4 `CampaignStorage` / `CampaignStorageACL`

这是一个“战役对象存储”体系，用来给战役内对象挂额外结构化内容和访问控制。

适合理解为：

- 不是所有对象都直接塞回源模型
- 某些对象内容会进入 storage 子系统

## 5. 角色与战斗对象域

核心模型：

- `character.py`
- `token.py`
- `monster_instance.py`
- `monster_avatar.py`
- `reward_history.py`

## 5.1 `Character`

这是整个数据模型里最重的实体之一。

它包含：

- 身份信息
  - `name`
  - `race_id` / `subrace_id`
  - `class_id` / `subclass_id`
  - `background_id`
  - `level`
- 外观与背景
  - `appearance`
  - `personality`
  - `backstory`
  - `avatar` / `avatar_large`
- 属性与技能
  - `ability_scores`
  - `selected_skills`
  - `expertise_skills`
- 职业与法术
  - `selected_cantrips`
  - `selected_spells`
  - `prepared_spells`
  - `spell_slots_state`
  - `class_feature_uses`
- 运行时状态
  - `current_hp`
  - `status_effects`
  - `hotbar`
- 装备与经济
  - `equipment`
  - `currency`
- 成长
  - `experience_points`
  - `milestone_level`
  - `multiclass_data`
  - `level_history`
- 规则选择
  - `subclass_choices`
  - `race_choices`
  - `feats`
  - `feat_choices`

这个模型的本质是：

- “角色档案”
- “角色运行态”
- “角色成长轨迹”

三者合一。

### 5.2 `Token`

`Token` 是另一个必须重点理解的模型。

它不是单一角色 token，而是地图上的通用承载体，可以表示：

- 角色
- 怪物实例
- 物品
- 商店
- 掉落袋
- 箱子

核心字段分三类：

#### 身份与归属

- `campaign_id`
- `character_id`
- `monster_instance_id`
- `shop_id`
- `chest_id`
- `item_data`
- `loot_bag_data`

#### 地图定位

- `map_url`
- `position_x`
- `position_y`
- `token_size`
- `instance_name`

#### 运行时战术状态

- `current_hp`
- `temp_hp`
- `death_saves`
- `active_effects`
- `active_auras`
- `faction`
- `transformation_data`
- `concentration_spell`
- `casting_in_progress`
- `disguise_data`

这是一个典型的“多态运行态实体”。

也正因为如此，很多系统最后都会落在 token 上：

- 战斗
- 法术
- 变形
- 幻象
- 光环
- 掉落

### 5.3 `MonsterInstance`

这个模型不是静态怪物图鉴，而是“战役里的怪物实例”。

核心字段：

- `campaign_id`
- `monster_id`
- `name` / `name_cn`
- `entity_type`
- `size`
- `type`
- `challenge_rating`
- `monster_data`
- `current_hp`
- `conditions`
- `inventory`
- `currency`
- `equipment`
- `status_effects`
- `selected_spells`
- `spell_slots_state`
- `controller_character_id`
- `control_type`

这里能看出它既是：

- 怪物实例
- NPC
- 召唤物 / 伙伴

也是为什么它比“怪物图鉴表”复杂得多。

## 6. 地图状态域

核心模型：

- `map_settings.py`
- `map_view_state.py`
- `fog_of_war.py`
- `map_terrain.py`
- `drawing.py`
- `ruler.py`
- `map_marker.py`
- `ai_map_marker.py`
- `module_maps.py`

这些模型合起来，才组成了战役地图的完整状态。

### 6.1 `MapSettings`

它记录地图级配置：

- `campaign_id`
- `map_url`
- `scale`
- `grid_unit_length`
- `anchor_x`
- `anchor_y`
- `global_terrain`

### 6.2 `MapViewState`

负责保存用户或 DM 的地图视口状态，例如：

- 缩放
- 位置
- minimap 折叠状态

### 6.3 `FogOfWar` / `MapTerrain` / `Drawing` / `Ruler`

这些是典型的“地图操作痕迹表”：

- 迷雾
- 地形
- 绘图
- 测距

它们的存在说明：

- 地图不是纯前端状态
- 很多战役内操作都会持久化

### 6.4 `MapMarker` / `AIMapMarker`

分别对应：

- 普通地图标记
- AI 生成的地图标记

### 6.5 `ModuleMaps`

这是模组地图和战役地图之间的桥梁，负责把模组中的地图资源接到战役运行态上。

## 7. 资源与场景对象域

核心模型：

- `item.py`
- `shop.py`
- `shop_inventory.py`
- `chest.py`
- `chest_inventory.py`
- `user_map.py`
- `user_avatar.py`
- `user_cover.py`

## 7.1 `Item`

`Item` 不是静态规则库里的装备条目，而是某个战役里的物品资源对象。

它既包含规则属性，也包含战役内实例属性。

例如：

- `name`
- `category`
- `cost`
- `damage`
- `armor_class`
- `description`
- `quantity`
- `notes`
- `is_custom`
- `avatar_url`
- `requires_attunement`
- `magic_bonus`
- `extra_damage`
- `abilities`
- `charges`
- `item_spells`
- `sentient`
- `source_module`

这说明物品模型已经覆盖了：

- 普通装备
- 魔法物品
- 自定义物品
- 从模组导入物品

### 7.2 `Shop` / `ShopInventory`

`Shop` 负责商店本身：

- 名称
- 描述
- 金币储备
- 回收折扣
- 头像

`ShopInventory` 则把商店和物品挂接起来。

### 7.3 `Chest` / `ChestInventory`

`Chest` 负责：

- 宝箱本体
- 锁、陷阱、调查状态之类元数据

`ChestInventory` 负责：

- 宝箱中的物品清单

### 7.4 `UserMap` / `UserAvatar` / `UserCover`

这些表主要是用户资源库：

- 自定义地图
- 自定义头像
- 自定义封面

可以理解为平台素材资产层。

## 8. 模组与知识库域

核心模型：

- `raw_module_file.py`
- `parsed_module.py`
- `module_parse_task.py`
- `custom_module.py`
- `module_embedding.py`
- `module_chat.py`
- `module_chat_session.py`
- `module_note.py`
- `rules_embedding.py`
- `rules_chat.py`
- `resource_chat.py`

## 8.1 `RawModuleFile`

这是模组上传后的原始文件记录。

核心字段：

- `title`
- `original_filename`
- `file_type`
- `file_size`
- `status`
- `error_message`
- `markdown_content`
- `ocr_images`
- `image_classifications`
- `created_by`
- `parsed_module_id`

它保存的是“解析前和解析中状态”。

### 8.2 `ParsedModule`

这是结构化后的模组结果。

核心字段：

- `module_id`
- `title`
- `description`
- `chapters_count`
- `monsters_count`
- `items_count`
- `images_count`
- `tables_count`
- `module_info`
- `chapters`
- `monsters`
- `items`
- `images`
- `tables`
- `toc`
- `source_file_id`
- `created_by`
- `is_shared`
- `original_module_id`

可以看出这里不是“只存路径”，而是直接把结构化内容放进 JSONB。

### 8.3 `ModuleParseTask`

用于追踪模组解析进度、任务状态与取消逻辑。

### 8.4 `CustomModule`

这是“用户手写 / AI 生成的自定义模组”，和 OCR 解析出来的 `ParsedModule` 是平行体系。

核心内容：

- `chapters`
- `npcs`
- `locations`
- `encounters`
- `treasures`

### 8.5 Embedding 与聊天表

这些模型负责知识增强与会话历史：

- `ModuleEmbedding`
- `RulesEmbedding`
- `ModuleChatMessage`
- `ModuleChatSession`
- `RulesChatMessage`
- `ResourceChatMessage`
- `ModuleNote`

它们共同支撑：

- 模组问答
- 规则问答
- 资源问答
- 会话分组
- 笔记沉淀

## 9. AI 配置域

核心模型：

- `ai_settings.py`
- `ai_chat_session.py`

### 9.1 `AIAPISettings`

每个用户对应一条主配置：

- `user_id`
- `usage_configs`

其中 `usage_configs` 是关键，它定义：

- 哪个业务用途使用哪种模型类型

### 9.2 `AIModelConfig`

每条配置定义一个模型类型的具体接入信息：

- `settings_id`
- `model_type`
- `api_url`
- `api_key`
- `model_name`

模型类型包括：

- `CHAT`
- `FAST`
- `MEDIUM`
- `ADVANCED`
- `SUPER_ADVANCED`
- `VISION`
- `FAST_IMAGE`
- `MEDIUM_IMAGE`
- `ADVANCED_IMAGE`
- `TRANSLATION`
- `MUSIC`
- `EMBEDDING`
- `RERANK`
- `STT`
- `TTS`

### 9.3 `AiChatSession`

这是战役级 AI 会话记录，用来补充平台内的 AI 对话上下文。

## 10. 聊天与协作域

除了上面提到的知识库聊天表，还有一组更偏战役协作的数据：

- `chat_message.py`
- `campaign_storage.py`
- `campaign_storage_acl.py`
- `character_draft.py`

它们负责：

- 战役聊天历史
- 协作存储
- 角色创建草稿

这说明“聊天”和“知识问答”在数据模型上是分开的两套体系。

## 11. 当前数据模型的几个重要特点

## 11.1 JSON 字段很多

优点：

- 灵活
- 演进快
- 容易容纳 D&D 复杂结构

代价：

- 很多约束只能靠代码而不是数据库
- 查询和变更一致性更依赖应用层
- 前后端约定一旦漂移，问题会比较隐蔽

## 11.2 运行态数据有重复

比如：

- `Character.current_hp`
- `Token.current_hp`

这类重复是为了：

- 地图战斗态快速读写
- 角色档案本体持久化

但也意味着：

- 改血量相关逻辑时要明确哪个才是当前权威来源
- 是否需要同步另一个实体

## 11.3 Token 是全平台核心枢纽

很多系统都会汇聚到 token：

- 角色
- 怪物
- 物品
- 商店
- 掉落袋
- 箱子
- 法术状态
- 变形状态

所以地图问题、战斗问题、法术问题经常都绕不开 token。

## 11.4 模组与知识系统大量依赖 JSONB

比如：

- `ParsedModule.chapters`
- `ParsedModule.monsters`
- `ParsedModule.items`
- `RawModuleFile.ocr_images`

这是为了保留解析结果的原始结构，但代价是：

- schema 边界更软
- 版本兼容问题更容易出现在应用层

## 12. 调数据问题时的建议

### 如果是角色问题

优先查：

- `Character`
- `Token`
- 相关战役成员

### 如果是地图问题

优先查：

- `Token`
- `MapSettings`
- `MapViewState`
- `FogOfWar`
- `MapTerrain`
- `Drawing`

### 如果是模组问题

优先查：

- `RawModuleFile`
- `ModuleParseTask`
- `ParsedModule`
- `ModuleEmbedding`

### 如果是 AI 配置问题

优先查：

- `AIAPISettings`
- `AIModelConfig`
- `usage_configs`

## 13. 建议阅读顺序

建议按这个顺序读模型：

1. `user.py`
2. `campaign.py`
3. `character.py`
4. `token.py`
5. `monster_instance.py`
6. `item.py`
7. `shop.py`
8. `chest.py`
9. `map_settings.py`
10. `map_view_state.py`
11. `raw_module_file.py`
12. `parsed_module.py`
13. `custom_module.py`
14. `ai_settings.py`

读完这条线，你就能把“大多数业务对象到底存在哪”讲清楚。
