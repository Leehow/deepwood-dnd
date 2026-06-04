# Deepwood 角色规则 Schema 文档

> 状态：提案
> 关联文档：`docs/CHARACTER_RULE_EXTENSION_DESIGN.md`
> 最后更新：2026-03-06

---

## 1. 文档目标

本文档定义 Deepwood 角色规则扩展系统的**数据契约**，用于统一以下资源：

- class / subclass
- race / subrace / lineage
- deity / domain
- feat
- spell
- condition
- progression
- effect primitive
- class resource / spell list patch / feature choice

本文档解决的是“**数据怎么长**”的问题，而不是“运行时怎么装配”的问题；运行时装配由后续 `campaign rule assembly` 与 `resolver` 文档负责。

---

## 2. 设计原则

### 2.1 兼容当前数据，目标指向规范化

当前仓库中的规则 JSON 已存在明显差异：

- `classes_with_structured_subclass_features.json`：数组结构，字段偏 camelCase，子职业嵌套在职业内
- `races.json`：数组结构，子种族嵌套在种族内，trait 内已有半结构化字段
- `gods.json`：神祇嵌套在 pantheon 内
- `feats.json`：`feats` 为对象映射而不是数组
- `spells.json`：已有较丰富的 effect 结构
- `conditions.json`：字段较轻量，偏规则说明型

因此目标不是一步重写全部数据，而是定义一个**规范化 Schema**，由 loader / registry 将现有 JSON 映射进去。

### 2.2 所有资源都应具备命名空间 ID

推荐格式：`package_id:kind:local_id`

例如：

- `official.phb:class:wizard`
- `official.phb:subclass:cleric_light`
- `official.phb:race:elf`
- `studio.deepwood.sundered:deity:auril`

### 2.3 宿主解释执行，不开放任意脚本

Schema 中允许 effect、progression、patch，但这些都必须由宿主预定义语义并解释执行。

### 2.4 Character Build 与 Runtime Result 分离

Schema 重点表达：

- 角色可选资源
- 角色已选资源
- 资源如何推导出运行时结果

不要把最终数值面板直接硬编码进 schema 真值。

---

## 3. Schema 分层

建议分三层表示。

### 3.1 Source Shape

现有 JSON 的原始形状，不强制统一。

### 3.2 Normalized Resource Shape

进入 registry 之前统一映射到标准资源结构。

### 3.3 Runtime Assembly Shape

由 resolver 在 campaign 上下文中装配出的最终视图，用于角色创建、升级、角色卡和校验。

本文档主要定义 **Normalized Resource Shape**。

---

## 4. 通用资源信封

所有可注册资源都建议遵循如下通用信封：

```json
{
  "schema_version": "1.0",
  "kind": "class",
  "id": "official.phb:class:wizard",
  "local_id": "wizard",
  "package_id": "official.phb",
  "source": {
    "book": "PHB",
    "page": 112,
    "license": "fan-content-policy"
  },
  "names": {
    "zh-Hans": "法师",
    "en": "Wizard"
  },
  "summary": "奥术施法职业",
  "tags": ["arcane", "full-caster"],
  "visibility": {
    "default_enabled": true,
    "campaign_tags": []
  },
  "payload": {}
}
```

### 4.1 通用字段

- `schema_version`：资源 schema 版本
- `kind`：资源类型
- `id`：全局稳定 ID
- `local_id`：包内局部 ID
- `package_id`：来源包
- `source`：来源与版权信息
- `names`：多语言名称
- `summary`：短说明
- `tags`：搜索、过滤、兼容控制标签
- `visibility`：默认启用、战役标签、可见性约束
- `payload`：具体资源内容

### 4.2 建议的通用扩展字段

- `text`：长描述 / 风味文本 / 展示文本
- `art`：图标、插图、卡面资源
- `references`：引用到其他规则资源的 ID 列表
- `prerequisites`：结构化前置条件
- `compatibility`：最低宿主版本、依赖包、冲突包
- `flags`：平台内部保留位

---

## 5. 通用子结构

### 5.1 Prerequisite

```json
{
  "type": "ability_min",
  "ability": "wisdom",
  "value": 13
}
```

支持的前置条件类型建议包括：

- `ability_min`
- `class_level`
- `character_level`
- `race_allowed`
- `alignment_allowed`
- `feature_required`
- `spellcasting_required`
- `campaign_toggle`

### 5.2 Choice Group

```json
{
  "id": "cleric_bonus_language",
  "type": "language",
  "count": 2,
  "options": ["common", "celestial", "draconic"]
}
```

建议用于：

- 技能选择
- 语言选择
- 戏法选择
- 已知法术选择
- 战斗风格选择
- 特性分支选择

### 5.3 Effect Ref

```json
{
  "effect_id": "core:add_modifier:initiative_plus_5",
  "scope": "self"
}
```

用于引用 effect registry 中已定义的受限原语。

---

## 6. class Schema

`payload` 推荐字段：

- `hit_die`
- `primary_abilities`
- `saving_throw_proficiencies`
- `proficiencies`
- `starting_equipment`
- `multiclass_requirements`
- `spellcasting`
- `resource_refs`
- `progression_ref`
- `feature_refs`
- `subclass_choice`

### 6.1 proficiencies

```json
{
  "armor": ["light_armor", "medium_armor"],
  "weapons": ["simple_weapons"],
  "tools": [],
  "skills": {
    "available": ["arcana", "history"],
    "choose": 2
  }
}
```

### 6.2 subclass_choice

```json
{
  "level": 3,
  "kind": "subclass",
  "allowed_kinds": ["subclass"]
}
```

### 6.3 与当前数据的映射

- `hitDie` -> `hit_die`
- `primaryAbility` / `primaryAbilities` -> `primary_abilities`
- `savingThrows` -> `saving_throw_proficiencies`
- `startingEquipment` -> `starting_equipment`
- `subclasses`：建议在规范化阶段拆成独立 `subclass` 资源

---

## 7. subclass Schema

`payload` 推荐字段：

- `parent_class_id`
- `granted_at_level`
- `progression_ref`
- `feature_refs`
- `choice_groups`
- `spell_list_patch_refs`
- `resource_refs`

### 7.1 关键规则

- 子职业必须显式声明 `parent_class_id`
- 子职业不应长期嵌套保存在 class 资源内
- 子职业特性按 level 进入 progression，而不是散落在自由文本中

### 7.2 与当前数据的映射

当前 `classes_with_structured_subclass_features.json` 中的：

- `subclasses[].id`
- `subclasses[].level1Features`
- `subclasses[].featureChoices`

都建议被展开为：

- 独立 `subclass`
- 独立 `progression`
- 独立 `choice_group`

---

## 8. race / subrace / lineage Schema

`race.payload` 推荐字段：

- `size`
- `speed`
- `ability_adjustments`
- `age_profile`
- `alignment_hint`
- `languages`
- `senses`
- `trait_refs`
- `subrace_ids`

`subrace.payload` / `lineage.payload` 额外字段：

- `parent_race_id`
- `trait_refs`
- `ability_adjustments`
- `replace_parent_traits`（默认 `false`）

### 8.1 与当前数据的映射

- `abilityScoreIncrease` -> `ability_adjustments`
- `age` -> `age_profile`
- `traits[]`：建议拆成独立 `feature` 或 `trait` 资源
- `subraces[]`：建议拆成独立 `subrace` 资源
- `structuredData`：可映射为一个或多个 `effect_ref`
- `combatEffects`：映射到受限 effect 原语

### 8.2 设计建议

`trait` 层不要只存自由文本。像以下信息应尽量结构化：

- 伤害抗性
- 豁免优势
- 武器熟练项
- 工具熟练项
- 技能熟练项
- 感知距离

---

## 9. deity / domain Schema

由于当前 `gods.json` 是 `pantheon -> deities[]` 结构，建议规范化后拆为：

- `pantheon`
- `deity`
- `domain`（可选独立资源）

`deity.payload` 推荐字段：

- `pantheon_id`
- `title`
- `alignment`
- `domains`
- `portfolio`
- `symbol`
- `favored_weapon`
- `granted_spells`
- `allowed_classes`
- `forbidden_classes`
- `worshipper_tags`

### 9.1 可选规则支持

建议保留当前 `optionalRule` 的设计思路，但从文件级概念提升到运行时可见性：

- `visibility.rule_toggle = deity_system`
- campaign 未开启时，角色创建不展示 deity 选择

---

## 10. feat Schema

`feat.payload` 推荐字段：

- `prerequisites`
- `benefits_text`
- `ability_increase`
- `effect_refs`
- `choice_groups`
- `repeatable`

### 10.1 与当前数据的映射

- `benefits` -> `benefits_text`
- `abilityIncrease` -> `ability_increase`
- `effects.passive/resource/combat_option/...` -> 一个或多个 `effect_ref`
- `feats` 对象映射 -> registry 中独立 feat 资源集合

### 10.2 建议

当前 `feats.json` 已有 `effectTypes` 概念，这是后续 effect registry 的良好前身；建议后续统一收敛到共享 effect 原语字典，而不是 feat 私有枚举。

---

## 11. spell Schema

`spell.payload` 推荐字段：

- `level`
- `school`
- `casting_time`
- `range`
- `components`
- `materials`
- `duration`
- `ritual`
- `concentration`
- `description`
- `classes`
- `higher_level_text`
- `attack_or_save`
- `damage_or_effect`
- `effect_refs`

### 11.1 与当前数据的映射

- `castingTime` -> `casting_time`
- `iconPath` -> `art.icon`
- `effects[]`：可直接作为受限 effect DSL 的输入样本

### 11.2 spell list patch

像 `subclass-spells.json` 这类数据建议规范化为独立资源：

- `kind = spell_list_patch`
- 指向 `target_kind`（class / subclass / domain）
- 声明 `add_by_level`、`always_prepared`、`expanded_list`

---

## 12. condition Schema

`condition.payload` 推荐字段：

- `effects_text`
- `mechanical_effects`
- `includes`
- `ends_when`
- `beneficial`
- `stacking_policy`
- `effect_refs`

### 12.1 与当前数据的映射

- `effects` -> `effects_text`
- `endsWhen` -> `ends_when`
- `includes`：可以保留，用于 condition 组合关系
- `benefits`：可并入补充描述或结构化为 `mechanical_effects`

### 12.2 设计建议

当前 `conditions.json` 主要是说明性文本。后续若要支持自动化，应增加：

- `attackers_have_advantage`
- `self_attack_disadvantage`
- `speed_equals_zero`
- `auto_fail_saves`
- `damage_resistance_all`

这类宿主可计算的结构化字段或 effect 原语。

---

## 13. progression Schema

`progression` 用于描述 class / subclass / lineage / feat package 的等级成长。

建议结构：

```json
{
  "kind": "progression",
  "id": "official.phb:progression:barbarian_base",
  "payload": {
    "owner_id": "official.phb:class:barbarian",
    "levels": {
      "1": ["feature:rage", "feature:unarmored_defense"],
      "3": ["choice:barbarian_subclass"],
      "4": ["choice:asi_or_feat"]
    }
  }
}
```

### 13.1 progression 的职责

- 定义等级触发点
- 引用特性 / choice / spell patch / 资源
- 不直接承担复杂计算逻辑

---

## 14. class_resource Schema

当前 `class_resources.json` 已是较好的结构化基础，建议规范化为 `class_resource` 资源。

`payload` 推荐字段：

- `owner_class_id`
- `owner_subclass_id`
- `min_level`
- `capacity_formula`
- `capacity_scaling`
- `recharge`
- `recharge_upgrade`
- `dice_type`
- `dice_scaling`
- `ability_refs`

### 14.1 与当前数据的映射

- `classId` -> `owner_class_id`
- `subclassId` -> `owner_subclass_id`
- `maxFormula` -> `capacity_formula`
- `maxScaling` -> `capacity_scaling`
- `abilities` -> `ability_refs`

---

## 15. effect primitive Schema

effect 必须受限。建议统一为共享 registry，而不是每类资源自创 effect 结构。

推荐结构：

```json
{
  "kind": "effect",
  "id": "core:add_modifier:init_plus_5",
  "payload": {
    "type": "add_modifier",
    "target": "initiative",
    "value": 5,
    "scope": "self"
  }
}
```

### 15.1 V1 建议支持的 effect 类型

- `add_modifier`
- `grant_proficiency`
- `grant_language`
- `grant_spell`
- `grant_cantrip`
- `apply_condition`
- `grant_resistance`
- `grant_advantage`
- `set_speed`
- `restore_resource`
- `consume_resource`
- `add_spell_list_entry`

### 15.2 暂不建议支持

- 任意表达式执行
- 任意 SQL / 数据写入
- 任意前端脚本回调
- 任意服务端 hook 注入

---

## 16. 推荐的包内文件组织

角色规则包建议采用“按资源类型分文件”的方式：

- `manifest.json`
- `classes.json`
- `subclasses.json`
- `races.json`
- `subraces.json`
- `deities.json`
- `feats.json`
- `spells.json`
- `conditions.json`
- `progressions.json`
- `effects.json`
- `resources.json`

这样便于：

- 做 schema 校验
- 做差异比较
- 做冲突检测
- 做按类型导入与缓存

---

## 17. 兼容层建议

在真正迁移之前，建议保留一层 normalizer：

- `load_current_classes() -> normalize_classes()`
- `load_current_races() -> normalize_races()`
- `load_current_gods() -> normalize_deities()`
- `load_current_feats() -> normalize_feats()`
- `load_current_spells() -> normalize_spells()`
- `load_current_conditions() -> normalize_conditions()`

normalizer 的职责：

1. 统一 ID 和命名空间
2. camelCase -> snake_case
3. 嵌套资源拆平
4. 文本字段并入 `text` / `summary`
5. 半结构化字段映射为 effect / progression / choice

---

## 18. 校验规则建议

registry 导入时至少校验：

1. `id` 唯一
2. `kind` 合法
3. 引用目标存在
4. `subclass.parent_class_id` 存在
5. `subrace.parent_race_id` 存在
6. `progression.owner_id` 存在
7. `spell_list_patch` 的 target 存在
8. `effect.type` 在允许列表中
9. choice / prerequisite 结构合法

---

## 19. V1 最小落地范围

如果只做第一版，建议先正式 schema 化这几类：

1. `class`
2. `subclass`
3. `race`
4. `subrace`
5. `deity`
6. `feat`
7. `spell_list_patch`
8. `progression`

原因：

- 它们直接决定角色创建和升级体验
- 与你想要的“职业 / 种族 / 神祇 mod”最贴近
- 已有 JSON 数据基础较好

`condition`、`effect`、`class_resource` 可以作为 V1.5 / V2 补齐。

---

## 20. 结论

Deepwood 的角色规则 schema 不应追求一步到位的“万能规则语言”，而应先建立：

1. **统一资源信封**
2. **稳定命名空间 ID**
3. **class / race / deity / feat / spell 的规范化结构**
4. **progression / effect / spell patch 的受限表达**
5. **从当前 JSON 到规范化资源的兼容层**

只有这样，后续的 registry、campaign rule assembly 和 character resolver 才能稳定落地。
