# Deepwood 角色规则扩展设计文档

> 状态：提案
> 适用范围：职业 / 子职业 / 种族 / 亚种 / 神祇 / 领域 / 专长 / 法术 / 条件 等角色规则扩展
> 最后更新：2026-03-06

---

## 1. 文档目标

本文档专门定义 Deepwood（深渊小屋）中“角色规则扩展”的设计方向。

这里讨论的不是传统意义上的“任意代码插件”，而是更贴近 D&D / CRPG / VTT 实际 mod 生态的一类扩展：

- 新职业 / 子职业
- 新种族 / 血统 / 祖先
- 新神祇 / 领域
- 新专长 / 法术 / 条件
- 少量由宿主解释执行的自动化规则

目标是让 Deepwood 支持这类扩展成为一等公民，同时避免过早走向高风险的 Python / JS 任意插件体系。

---

## 2. 核心判断

角色规则扩展的本质不是“给用户开放宿主代码执行权”，而是：

1. 宿主预先定义可扩展的规则资源类型
2. Mod 通过 schema 提供结构化数据
3. 宿主在角色创建、升级、角色卡、法术准备、战役启用等流程中解释这些数据

因此它更接近：

- **规则资源扩展系统**
- **Character Option Registry**
- **Campaign-scoped rule assembly**

而不是：

- 任意脚本插件系统
- 任意前端组件注入系统
- 任意后端逻辑热插拔系统

---

## 3. 为什么这条路线适合 Deepwood

当前仓库已经具备角色规则扩展的宿主基础：

1. **前端角色创建已存在**
   - `frontend/app/routes/character.tsx`
   - `frontend/app/components/character/CharacterCreationWizardV2.tsx`

2. **前端已直接消费规则 JSON**
   - `races.json`
   - `classes_with_structured_subclass_features.json`
   - `backgrounds.json`
   - `gods.json`

3. **后端角色创建与角色卡已依赖规则数据**
   - `backend/app/api/routes/characters.py`
   - `backend/app/services/character_sheet_service.py`

4. **规则数据已存在集中路径管理**
   - 后端：`backend/app/utils/rules_cache.py`
   - 前端：`frontend/app/config/data-paths.ts`

5. **角色模型已具备基础字段**
   - `race_id`
   - `subrace_id`
   - `class_id`
   - `subclass_id`
   - `background_id`
   - `deity_id`
   - `ability_scores`
   - 见 `backend/app/models/character.py`

这意味着：

> Deepwood 不需要从零发明“系统扩展能力”，而是需要把当前散落在规则 JSON、角色创建流程和角色卡计算逻辑中的规则资源，升级为“可注册、可装配、可按战役启用”的扩展体系。

---

## 4. 本文中的“角色规则扩展”定义

### 4.1 属于本范围的扩展

- class
- subclass
- race
- subrace / lineage / ancestry
- background
- deity
- domain
- feat
- spell
- condition / status definition
- language
- skill
- class resource definition
- progression / prerequisites / granted feature

### 4.2 暂不属于本范围的扩展

- 任意 Python 后端插件
- 任意 React 组件注入
- 自定义 WebSocket 协议处理器
- 数据库迁移脚本由第三方 mod 自动执行
- 任意战斗主循环替换

### 4.3 边界上的扩展

以下能力可以纳入，但必须采用“宿主解释执行”的方式：

- granted effects
- passive modifiers
- triggered actions（受限）
- resource restore / consume rules
- spell list patch
- level-up choice group

---

## 5. 设计目标

1. **支持角色构建相关规则资源扩展**
2. **按 campaign 启用，而不是全局强行生效**
3. **保持规则数据驱动，避免任意代码执行**
4. **允许多个 mod 共同扩展角色选项池**
5. **允许受限的覆盖、补丁与自动化**
6. **与现有前后端角色创建流程兼容演进**
7. **兼容现有 `frontend/app/data/rules/` 作为基础规则来源**

---

## 6. 总体架构

角色规则扩展建议拆成五层。

### 6.1 Base Rules Layer（基础规则层）

系统内置规则的权威数据源：

- `frontend/app/data/rules/`
- 后端通过 `backend/app/utils/rules_cache.py` 读取同一目录

这层存放官方 / 平台内建规则：

- 基础职业
- 基础种族
- 基础背景
- 基础法术
- 基础神祇

### 6.2 Rule Package Layer（规则包层）

每个 mod 可以声明自己提供哪些角色规则资源，例如：

- 1 个新职业
- 3 个新子职业
- 1 个新种族
- 1 个神系下的多位神祇
- 一组新法术或专长

这层对应分发包与 manifest。

### 6.3 Registry Layer（注册表层）

对系统来说，所有角色规则扩展都应注册到统一索引，而不是靠扫描散落 JSON。

建议核心注册表：

- `character_option_registry`
- `progression_registry`
- `rules_dictionary_registry`
- `effect_registry`（受限原语）

### 6.4 Campaign Rule Assembly（战役规则装配层）

某个 campaign 启用了哪些扩展，决定该战役下：

- 角色创建可见哪些职业/种族/神祇
- 某些背景、专长、法术是否可选
- 某些规则 patch 是否生效
- 某些条件或资源定义是否被扩展

### 6.5 Character Runtime Resolver（角色运行时解析层）

在运行时统一回答这些问题：

- 当前战役下角色可以选哪些职业/种族/神祇？
- 这个角色 5 级时应获得哪些特性？
- 这个子职业提供哪些选择组？
- 这个法术列表在当前战役是否可用？
- 这个条件有什么自动效果？

---

## 7. 推荐的资源分类

### 7.1 Character Options

直接出现在角色创建 / 升级界面的规则资源：

- class
- subclass
- race
- subrace
- lineage / ancestry
- background
- deity
- domain
- feat

### 7.2 Rules Dictionary

提供规则词典或引用表：

- spell
- condition
- language
- skill
- proficiency group
- damage type / tag

### 7.3 Runtime Definitions

供宿主解释执行的受限规则：

- progression table
- granted feature
- feature choice group
- passive modifier
- active effect template
- spell list assignment
- resource progression

---

## 8. ID 与命名空间

所有扩展资源都必须具备稳定命名空间。

推荐格式：

- `official.phb:class:wizard`
- `official.phb:subclass:cleric_light_domain`
- `official.phb:race:elf`
- `official.phb:deity:moradin`
- `user.alice.shadowpantheon:deity:raven_queen`
- `studio.deepwood.psionics:class:psion`

这样可以解决：

- 不同 mod 同名资源冲突
- 升级时无法追踪来源
- 覆盖关系不明确
- 角色存档无法稳定引用扩展资源

角色表中现有 `class_id` / `race_id` / `subclass_id` / `deity_id` 等字段长期应逐步迁移到命名空间 ID。

---

## 9. Schema 设计建议

### 9.1 class

建议至少包含：

- `id`
- `name` / `name_en`
- `source`
- `hit_die`
- `primary_abilities`
- `saving_throw_proficiencies`
- `armor_proficiencies`
- `weapon_proficiencies`
- `tool_proficiencies`
- `skill_choice`
- `spellcasting_model`
- `progression_ref`
- `starting_equipment_options`
- `feature_refs`
- `subclass_slot` / `subclass_choice_level`
- `tags`

### 9.2 subclass

- `id`
- `parent_class_id`
- `name` / `name_en`
- `source`
- `progression_ref`
- `granted_features`
- `spell_list_patch`
- `prerequisites`
- `tags`

### 9.3 race / subrace / lineage

- `id`
- `name`
- `size`
- `speed`
- `senses`
- `languages`
- `traits`
- `ability_adjustments`
- `parent_race_id`（若为 subrace）
- `feature_refs`
- `age_profile`
- `tags`

### 9.4 deity / domain

- `id`
- `pantheon`
- `name`
- `alignment`
- `domains`
- `favored_weapon`
- `granted_spells`
- `class_visibility_rules`
- `lore`
- `tags`

### 9.5 feat

- `id`
- `name`
- `prerequisites`
- `granted_effects`
- `choice_groups`
- `repeatable`
- `tags`

### 9.6 spell

- `id`
- `name`
- `level`
- `school`
- `casting_time`
- `range`
- `components`
- `duration`
- `ritual`
- `concentration`
- `attack_or_save`
- `damage_or_effect`
- `class_lists`
- `tags`

### 9.7 condition

- `id`
- `name`
- `summary`
- `rules_text`
- `applied_modifiers`
- `stacking_policy`
- `icon`
- `tags`

---

## 10. 受限自动化模型

角色规则扩展不是完全静态数据；但自动化必须有限。

建议只开放宿主认可的 effect 原语，例如：

- `add_modifier`
- `grant_proficiency`
- `grant_language`
- `grant_spell`
- `grant_cantrip`
- `apply_condition`
- `remove_condition`
- `restore_resource`
- `consume_resource`
- `add_choice_option`
- `add_spell_list_entry`

不允许 mod 提供：

- 任意 JS 表达式执行
- 任意 Python 逻辑执行
- 任意数据库写入语句

如果某条规则无法用 effect 原语表示，应进入“平台内建支持”清单，而不是立刻开放脚本。

---

## 11. Campaign 级启用模型

角色规则扩展必须按 campaign 生效。

### 11.1 为什么要按战役启用

- 某个世界观只允许特定神系
- 某个战役只开放少量职业或种族
- 某个模组想增加 setting-specific 规则
- 不同战役可能采用不同 homebrew

### 11.2 运行结果

给定一个 `campaign_id`，系统应能解析出：

- 该战役允许的职业列表
- 该战役允许的种族 / 亚种 / 血统
- 该战役允许的神祇 / 领域
- 该战役额外开放的专长、法术、条件
- 该战役生效的规则 patch 集合

### 11.3 角色创建约束

角色创建时必须绑定当前战役的规则视图，不能只读全局静态 JSON。

---

## 12. 与当前代码的衔接方式

### 12.1 前端现状

当前角色创建界面已经直接从本地规则 JSON 加载：

- `frontend/app/routes/character.tsx`
- `frontend/app/components/character/Step5CharacterDescription.tsx`

这适合基础规则，但无法表达：

- 战役级启用的额外职业/种族/神祇
- mod 叠加后的最终选项池
- campaign 特定可见性限制

### 12.2 前端推荐演进

前端分两步走：

1. **保留本地 JSON 作为 base rules fallback**
2. **新增 campaign-resolved option API 作为主入口**

例如角色创建不再只读本地 `races/classes/gods`，而是改为：

- 基础选项：来自 base rules
- 战役解析后的最终选项：来自后端 runtime resolver

### 12.3 后端现状

后端已具备几块关键基础：

- `backend/app/api/routes/characters.py`：角色创建与 AI 生成
- `backend/app/services/character_sheet_service.py`：角色卡特性/动作/法术计算
- `backend/app/utils/rules_cache.py`：集中规则 JSON loader
- `backend/app/utils/classes.py` / `backend/app/utils/races.py`：兼容层 helper

### 12.4 后端推荐演进

新增一层角色规则解析服务，而不是继续在 route / sheet service 中直接拼 JSON：

- `app/services/character_rule_registry.py`
- `app/services/campaign_rule_assembler.py`
- `app/services/character_option_resolver.py`
- `app/services/character_progression_resolver.py`
- `app/services/character_effect_resolver.py`

---

## 13. 角色创建、升级与角色卡如何接入

### 13.1 Character Creation

当前创建流程落点：

- `frontend/app/components/character/CharacterCreationWizardV2.tsx`
- `backend/app/api/routes/characters.py`

目标改造：

1. 前端先请求当前战役可用选项池
2. 用户只能选择已装配可见的职业/种族/神祇
3. 提交角色时保存命名空间 ID
4. 后端二次校验这些选项是否在该战役合法

### 13.2 Level Up

升级时最需要 registry / progression resolver。

因为升级阶段要回答：

- 当前等级新增哪些职业特性？
- 是否出现 subclass choice？
- 是否出现 spell choice / feat choice？
- 某个 mod 新增的职业在 3 级、6 级、10 级提供什么特性？

### 13.3 Character Sheet

当前 `backend/app/services/character_sheet_service.py` 已负责特性、动作、法术聚合。

后续应改为：

1. 读取角色已保存的扩展资源 ID
2. 通过 resolver 装配 race/class/subclass/background/deity/feat/spell
3. 根据 progression 与 effect primitives 生成最终角色卡视图

---

## 14. 神祇系统在 Deepwood 中的特殊意义

Deepwood 当前前端已经存在神祇相关 UI 与逻辑：

- `frontend/app/components/character/Step5CharacterDescription.tsx`
- `frontend/app/components/character/DeitySelector`（由现有使用可见）

这意味着神祇不是未来才有的概念，而是已经处于“半规则化”状态。

因此神祇扩展特别适合作为第一批角色规则扩展示范类型：

- 新 pantheon
- 新 deity
- deity 与 alignment 绑定
- deity 对 class 可见性限制
- deity 与 domain / favored weapon / granted spell 的关联

---

## 15. 冲突、覆盖与兼容策略

### 15.1 默认策略

对于角色规则扩展，默认以“新增”为主，覆盖为辅。

优先允许：

- 新增职业
- 新增子职业
- 新增种族 / 神祇 / 专长 / 法术

谨慎允许：

- 覆盖已有职业 progression
- 修改已有法术效果
- 修改已有条件定义

### 15.2 覆盖方式

推荐支持三种声明式模式：

- `add`
- `extend`
- `override`

其中：

- `add`：新增一个资源
- `extend`：在允许的 patch 点补充条目
- `override`：完全替换，需要更高风险标记

### 15.3 冲突检测

系统至少要能检测：

- 同一命名空间 ID 被多个包重复声明
- 某子职业引用不存在的父职业
- 某神祇引用不存在的 domain
- 某 progression 引用了不存在的 feature/effect
- 某法术列表补丁目标不存在

---

## 16. API 设计建议

### 16.1 Registry / Catalog API

- `GET /api/rules/catalog`
  - 查看已注册的角色规则资源摘要
- `GET /api/rules/catalog/{resource_type}`
  - 查看某类资源
- `GET /api/rules/catalog/{resource_type}/{id}`
  - 查看单个资源详情

### 16.2 Campaign Rule View API

- `GET /api/campaigns/{campaign_id}/rule-options`
  - 返回角色创建所需最终选项池
- `GET /api/campaigns/{campaign_id}/rule-options/{resource_type}`
  - 例如 class / race / deity / feat
- `GET /api/campaigns/{campaign_id}/rule-runtime`
  - 返回该战役装配后的规则摘要与版本信息

### 16.3 Character Validation API

- `POST /api/campaigns/{campaign_id}/characters/validate-build`
  - 校验某角色构建是否符合当前战役规则视图

### 16.4 Level Up API

- `GET /api/characters/{id}/level-up-options`
  - 返回该角色当前可选升级项
- `POST /api/characters/{id}/apply-level-up`
  - 提交升级选择

---

## 17. 数据存储建议

### 17.1 基础原则

不要把所有内容都继续塞进单个角色 JSON 中隐式解释；应把“角色已选规则资源”与“运行时计算结果”区分开。

### 17.2 Character 持久化层建议

角色应长期持久化：

- `race_id`
- `subrace_id`
- `class_id`
- `subclass_id`
- `background_id`
- `deity_id`
- `feat_ids`
- `known_spell_ids`
- `prepared_spell_ids`
- `selected_feature_choices`

这些字段表达“角色做了什么选择”，而不是“最终规则结果”。

### 17.3 Runtime 结果层建议

角色卡视图、能力修正、法术位、资源上限等属于“运行时解析结果”，应按需计算或缓存，而不是全部持久化为真值。

---

## 18. 对现有规则数据的迁移建议

### 18.1 现状

当前基础规则数据已经集中在：

- `frontend/app/data/rules/`

后端通过 `rules_cache.py` 读取这一目录；`classes.py` 与 `races.py` 只是兼容包装。

### 18.2 推荐迁移方式

不要立刻推翻当前 JSON 文件；应先把它们视为“内建 base package”。

也就是：

- `official.phb` 之类的逻辑包由当前基础 JSON 导出
- 后续 mod 再在 registry 中和它并存

### 18.3 好处

- 不影响当前角色创建流程立即可用
- 允许渐进迁移到 registry/resolver
- 避免一次性重写全部前后端逻辑

---

## 19. 分阶段实施路线

## Phase 0：定义角色规则资源 schema

目标：先统一“职业/种族/神祇/专长/法术/条件”的数据契约。

任务：

1. 定义资源类型与命名空间规则
2. 定义 class / subclass / race / deity / feat / spell / condition schema
3. 明确哪些字段允许 `extend` / `override`

## Phase 1：建立 Character Rule Registry

目标：让系统可以注册并索引角色规则资源。

任务：

1. 建立规则注册表与索引结构
2. 将基础 JSON 映射为 base package
3. 提供 catalog API

## Phase 2：接入 Campaign Rule Assembly

目标：让战役可以启用角色规则扩展。

任务：

1. 把规则扩展挂到 campaign mod 启用机制
2. 提供 `rule-options` runtime API
3. 支持角色创建时读取战役最终选项池

## Phase 3：接入 Character Sheet / Level Up

目标：让扩展规则真正影响角色卡与升级流程。

任务：

1. 引入 progression resolver
2. 引入 effect resolver
3. 角色卡改为基于 registry/resolver 装配

## Phase 4：有限自动化与规则 patch

目标：支持受限自动化。

任务：

1. 增加 effect primitives
2. 增加条件/法术/特性的自动应用逻辑
3. 支持少量高价值规则 patch

---

## 20. 明确不建议现在做的事

1. 不建议开放用户上传 Python 插件
2. 不建议开放任意 React 注入式 UI 插件
3. 不建议先做通用脚本 DSL 再回头补 schema
4. 不建议一开始就允许重写所有基础职业和法术逻辑

原因很简单：

- 安全成本高
- 调试困难
- 兼容性脆弱
- 对当前项目并非最短路径

---

## 21. 本文结论

对于 Deepwood 来说，你说的“系统扩展”最现实、最有价值、也最符合现有生态的实现方式，不是插件内核优先，而是：

1. **先把角色规则资源做成可扩展 schema**
2. **再建立 character rule registry**
3. **再把规则扩展纳入 campaign 级启用**
4. **最后用 resolver 接入角色创建、升级与角色卡**

也就是说，Deepwood 该优先建设的是：

> **Character Rule Extension System**

而不是：

> **Arbitrary Plugin Execution System**

---

## 22. 下一步建议

如果继续往下推进，建议优先补两份子文档：

1. `docs/CHARACTER_RULE_SCHEMA.md`
   - 定义 class / subclass / race / deity / feat / spell / condition 的具体字段与示例
2. `docs/CAMPAIGN_RULE_ASSEMBLY.md`
   - 定义 campaign 规则装配、冲突处理、resolver 与 API 返回结构

这两份补完后，就可以开始做 Phase 0 和 Phase 1 的代码骨架。
