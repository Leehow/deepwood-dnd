# Deepwood 战役规则装配文档

> 状态：提案
> 关联文档：`docs/CHARACTER_RULE_EXTENSION_DESIGN.md`、`docs/CHARACTER_RULE_SCHEMA.md`
> 最后更新：2026-03-06

---

## 1. 文档目标

本文档定义 Deepwood 如何在 **campaign（战役）范围** 内装配角色规则扩展。

它解决的不是“资源长什么样”，而是：

- 某个 campaign 启用了哪些规则包
- 这些规则包按什么顺序合并
- 最终职业 / 种族 / 神祇 / 专长 / 法术选项池如何得到
- 冲突、依赖、可见性与开关如何处理
- 前后端如何通过 API / resolver 消费装配结果

简化地说：`CHARACTER_RULE_SCHEMA.md` 定义“资源格式”，而本文定义“资源如何在战役里生效”。

---

## 2. 当前代码库现状

当前仓库已经具备战役规则装配的几个关键落点。

### 2.1 Campaign 已有规则设置容器

- `backend/app/models/campaign.py`
  - `meta` 映射到数据库列 `metadata`
  - 适合存放战役级规则开关与已启用包配置
- `backend/app/schemas/campaign.py`
  - API 层已经支持 `metadata` / `meta` 读写
- `backend/app/api/routes/campaigns.py`
  - `GET /api/campaigns/{id}` 会返回 metadata
  - `PUT /api/campaigns/{id}` 已支持更新 metadata

### 2.2 Campaign 已有“选中模块”入口

- `Campaign.selected_module_id` 已存在
- 当前它主要代表该战役当前选中的冒险/模块内容
- 未来可以把“模块携带的规则扩展包”纳入装配输入

### 2.3 角色创建当前仍以本地规则 JSON 为主

- `frontend/app/components/character/CharacterCreationWizardV2.tsx`
  - 当前直接导入 `~/data/rules/races.json`
  - 当前直接导入 `~/data/rules/classes_with_structured_subclass_features.json`
- 这意味着前端还没有正式接入 campaign-scoped rule resolver

### 2.4 已有真实存在的战役规则开关样例

- `campaign.metadata.enable_deity_system`
  - DM 页面已读取和保存
  - 玩家页面也会据此决定是否展示神祇系统

这很重要，因为它说明：

> Deepwood 已经有“战役元数据决定角色可见规则”的真实先例。

本文只是把这个模式从单个开关推广为通用的规则装配体系。

---

## 3. 设计目标

### 3.1 目标

1. **规则扩展必须按 campaign 生效**，不能默认全局污染所有战役
2. **兼容当前 base rules**，把现有前端 JSON 视为基础规则包
3. **允许多个 package 共同扩展选项池**
4. **允许受限覆盖与 patch**，但避免任意脚本执行
5. **把角色创建、升级、角色卡统一收敛到 resolver**
6. **支持渐进迁移**，不要一次性推翻当前角色创建流程

### 3.2 非目标

- 不在 V1 做任意 Python/JS 插件执行
- 不在 V1 让 mod 直接改数据库结构
- 不在 V1 做前端任意 React 组件注入
- 不在 V1 解决所有战斗/地图/AI 行为扩展

---

## 4. 核心概念

### 4.1 Rule Package

一组可被启用的规则资源集合，包含：

- manifest
- 依赖关系
- 资源列表
- 可选的 patch / visibility / compatibility 声明

例子：

- `official.phb`
- `official.xgte`
- `module.curse_of_strahd`
- `homebrew.my-table-norse-pack`

### 4.2 Base Package

由当前仓库内置规则数据构成的基础规则包。

建议在逻辑上固定为：

- `official.phb`

它来自当前 `frontend/app/data/rules/` 与后端 `rules_cache` 的映射层，而不是要求立即重排所有 JSON 文件。

### 4.3 Campaign Rule Profile

某个战役的“规则启用配置”，建议存于 `Campaign.meta` 下的独立命名空间，例如：

- `meta.rule_assembly.enabled_package_ids`
- `meta.rule_assembly.rule_toggles`
- `meta.rule_assembly.visibility_tags`

### 4.4 Resolved Rule View

给定 `campaign_id` 后，后端 assembler + resolver 得到的最终规则视图。

它应回答：

- 当前战役有哪些可选 class / race / deity / feat
- 哪些资源被隐藏、禁用或替换
- 某个 class 的 subclass / progression / spell patch 是否生效
- 当前装配结果的版本、来源、警告信息是什么

---

## 5. Campaign 元数据建议结构

建议不要把规则配置散落在 `meta` 顶层，而是集中挂到 `rule_assembly` 下。

推荐结构：

```json
{
  "enable_deity_system": true,
  "rule_assembly": {
    "enabled_package_ids": [
      "official.phb",
      "module.curse_of_strahd",
      "homebrew.my-table-gods"
    ],
    "rule_toggles": {
      "deity_system": true,
      "feats_enabled": true,
      "multiclass_enabled": false
    },
    "visibility_tags": ["forgotten-realms", "barovia"],
    "pinned_versions": {
      "module.curse_of_strahd": "1.0.0"
    }
  }
}
```

### 5.1 兼容策略

为兼容当前代码，V1 可以同时接受：

- 旧字段：`meta.enable_deity_system`
- 新字段：`meta.rule_assembly.rule_toggles.deity_system`

规则是：

1. 若 `rule_assembly.rule_toggles` 存在，则优先使用新结构
2. 否则回退到旧的 `meta.enable_deity_system`

这样可以平滑迁移现有 UI。

---

## 6. 装配输入

给定一个 `campaign_id`，assembler 应读取以下输入。

### 6.1 固定基础输入

1. Base package：`official.phb`
2. 宿主内置默认 toggles

### 6.2 Campaign 配置输入

1. `Campaign.meta.rule_assembly.enabled_package_ids`
2. `Campaign.meta.rule_assembly.rule_toggles`
3. `Campaign.meta.rule_assembly.visibility_tags`
4. `Campaign.selected_module_id`

### 6.3 Registry 输入

1. package manifest
2. package dependency graph
3. normalized resources
4. patch / override 声明

### 6.4 未来可扩展输入

1. campaign-specific homebrew package
2. DM 手工禁用的资源 ID 列表
3. 玩家席位 / 阵营 / faction 驱动的可见性限制

---

## 7. 装配顺序

建议采用稳定、可预测的四层顺序。

### 7.1 Layer 1：Base Rules

先加载 `official.phb`。

这是兜底层，保证即使没有启用任何扩展包，角色创建仍可工作。

### 7.2 Layer 2：Selected Module Attached Packages

若 `selected_module_id` 对应的模块声明了附带规则包，则将这些包并入。

典型用途：

- 某冒险限定神祇集合
- 某 setting 独有背景 / 专长
- 某战役世界特有种族或职业可见性

### 7.3 Layer 3：Enabled Packages

加载 `enabled_package_ids` 中声明的官方扩展包、社区包、内部包。

例如：

- `official.xgte`
- `official.tcoe`
- `homebrew.my-table-pack`

### 7.4 Layer 4：Campaign Overrides

最后应用战役级 overrides：

- toggles
- visibility tags
- resource blacklist / whitelist
- 手工优先级修正

### 7.5 总结公式

最终视图 = Base -> Module Attached -> Enabled Packages -> Campaign Overrides

---

## 8. 合并规则

### 8.1 新增型资源

像新 class / race / deity / feat 这类资源，默认按 `id` 去重后加入集合。

### 8.2 覆盖型资源

若两个 package 声明相同资源 ID：

1. 默认视为冲突
2. 只有显式声明 `replaces` / `override_of` 才允许覆盖
3. 未声明时返回 warning，且不静默覆盖

### 8.3 Patch 型资源

像 `spell_list_patch`、`progression patch` 这类资源，不直接替换原资源，而是附着到目标资源上。

要求：

1. target resource 必须存在
2. patch 类型必须在宿主允许列表内
3. patch 执行顺序必须稳定

### 8.4 可见性过滤

resource 的 `visibility` 与 campaign 的 `rule_toggles` / `visibility_tags` 联合决定是否可见。

例如：

- `deity.visibility.rule_toggle = deity_system`
- campaign 未开启 `deity_system`
- 则该资源不进入角色创建可选池

---

## 9. 依赖与冲突处理

### 9.1 依赖

package 可以声明：

- `depends_on`
- `optional_depends_on`
- `compatible_with`

装配时：

1. 先计算依赖闭包
2. 缺失强依赖则装配失败
3. 缺失可选依赖则给出 warning

### 9.2 冲突

package 可以声明：

- `conflicts_with`

例如两个包都试图完全替换 `official.phb:class:cleric`。

V1 建议策略：

1. 显式冲突直接报错
2. 隐式资源冲突返回 warning + 跳过后到达的包
3. 不做“最后写入覆盖一切”的隐式行为

### 9.3 用户体验建议

DM 在启用包时应尽量在 UI 中立即看到：

- 缺失依赖
- 冲突包
- 将新增哪些 class / race / deity
- 哪些资源将被隐藏或替换

---

## 10. Resolved Rule View 推荐结构

后端给前端的装配结果不应直接回传全部原始资源，而应返回“角色构建友好”的视图。

推荐包含：

1. `packages`
   - 已装配 package 列表
   - 版本 / 来源 / 层级
2. `toggles`
   - 当前规则开关真值
3. `catalog`
   - `classes`
   - `races`
   - `subraces`
   - `deities`
   - `feats`
   - `backgrounds`
4. `indexes`
   - class -> subclasses
   - race -> subraces
   - class/subclass -> spell patches
5. `warnings`
   - 缺失依赖 / 冲突 / 已跳过 patch
6. `assembly_version`
   - 用于缓存和前端失效控制

---

## 11. Resolver 责任边界

建议将装配与查询分为两层。

### 11.1 CampaignRuleAssembler

职责：

- 读取 campaign 配置
- 解析 package 列表
- 合并资源
- 计算 toggles / visibility / warnings
- 产生 resolved rule view

### 11.2 CharacterOptionResolver

职责：

- 面向角色创建回答“可选什么”
- 面向升级回答“此等级获得什么”
- 面向角色卡回答“该角色最终具备什么规则结果”

也就是说：

- assembler 负责“先把战役规则世界装好”
- resolver 负责“在这个世界里回答角色问题”

---

## 12. API 设计建议

### 12.1 Campaign Rule Runtime API

- `GET /api/campaigns/{campaign_id}/rule-runtime`
  - 返回完整 resolved rule view
- `GET /api/campaigns/{campaign_id}/rule-options`
  - 返回角色创建所需轻量选项池
- `GET /api/campaigns/{campaign_id}/rule-options/{resource_type}`
  - 返回某类资源，如 `class` / `race` / `deity`

### 12.2 Campaign Rule Config API

- `GET /api/campaigns/{campaign_id}/rule-config`
  - 返回 `rule_assembly` 配置
- `PUT /api/campaigns/{campaign_id}/rule-config`
  - 更新 `enabled_package_ids`、`rule_toggles`、`visibility_tags`
- `POST /api/campaigns/{campaign_id}/rule-config/validate`
  - 只做依赖/冲突预检查，不保存

### 12.3 Character Build API

- `POST /api/campaigns/{campaign_id}/characters/validate-build`
  - 校验角色构建在当前战役下是否合法
- `GET /api/characters/{character_id}/level-up-options`
  - 基于当前战役装配结果返回升级可选项

---

## 13. 前端接入建议

### 13.1 角色创建

当前 `CharacterCreationWizardV2.tsx` 仍直接读取本地 JSON。

建议演进为：

1. 首选请求 `GET /api/campaigns/{id}/rule-options`
2. 若接口不可用或 campaign 缺失，则回退到本地 base rules
3. Step1/Step2/Step5 改为消费 resolved options

这三步最先受益：

- Step1：种族 / 亚种
- Step2：职业 / 子职业入口
- Step5：神祇显示与可选集合

### 13.2 Campaign 设置 UI

当前 DM 设置页已经能保存：

- `metadata.enable_deity_system`
- `selected_module_id`

后续可在同一设置域中追加：

- 启用包列表
- 冲突/依赖校验结果
- 规则开关面板

### 13.3 渐进兼容

在前端完全迁移前：

- `enableDeitySystem` 继续保留
- 本地 JSON 继续作为 fallback
- 新接口只在存在 `campaignId` 时启用

---

## 14. 缓存策略

### 14.1 为什么需要缓存

装配会涉及：

- package 依赖展开
- 资源归并
- patch 应用
- visibility 过滤

因此不建议每次角色创建都全量重算。

### 14.2 推荐缓存键

缓存键可由以下内容共同决定：

- `campaign_id`
- `selected_module_id`
- `enabled_package_ids` hash
- `rule_toggles` hash
- package registry version

### 14.3 失效条件

以下变化应触发缓存失效：

1. campaign `rule_assembly` 被更新
2. `selected_module_id` 变化
3. package 内容或版本变化
4. base rules normalization 版本变化

### 14.4 不建议缓存的内容

- 不要把最终 resolved result 永久写死进 `Campaign.meta`
- `meta` 应保存配置，而不是大体积运行时快照

必要时可以保存轻量摘要：

- `last_assembly_version`
- `last_assembled_at`

---

## 15. 错误与警告模型

建议区分两类输出。

### 15.1 Error

导致装配失败，无法产出有效规则视图。

例如：

- base package 丢失
- 强依赖缺失
- manifest 非法
- patch target 不存在且为必需 patch

### 15.2 Warning

允许产出结果，但需要提示 DM 或日志记录。

例如：

- 可选依赖缺失
- 重复资源 ID 被跳过
- 某些资源因 visibility 不可见
- 某 patch 因 toggle 关闭而未生效

---

## 16. V1 最小落地范围

V1 不需要一次做全，只需要先打通角色创建主链路。

建议 V1 覆盖：

1. `class`
2. `subclass`
3. `race`
4. `subrace`
5. `deity`
6. `feat`（可只进 catalog，不一定马上进 UI）
7. `spell_list_patch`
8. `progression`（先为升级预留）

V1 最关键的用户价值是：

- 某战役能启用额外职业/种族/神祇
- 神祇系统能成为通用 toggle，而不是孤立特例
- 角色创建不再只看全局本地 JSON

---

## 17. 分阶段实施建议

### Phase 0：文档与接口约定

1. 完成 schema / assembly 文档
2. 明确 `meta.rule_assembly` 结构
3. 明确 API response shape

### Phase 1：Registry + Base Package

1. 把当前 rules JSON 映射为 `official.phb`
2. 实现 package catalog / normalization loader
3. 输出最小 resolved catalog

### Phase 2：Campaign Rule Assembly

1. 读取 `Campaign.meta.rule_assembly`
2. 纳入 `selected_module_id` 附带规则包
3. 提供 `rule-options` / `rule-runtime` API

### Phase 3：Character Creation 接入

1. `CharacterCreationWizardV2` 改为优先读取 `rule-options`
2. 保留本地 JSON fallback
3. Step5 神祇逻辑切到统一 toggle/resolver

### Phase 4：Level Up / Character Sheet 接入

1. 接 progression resolver
2. 接 effect / patch resolver
3. build validation 落地

---

## 18. 结论

Deepwood 的战役规则装配，不应该被设计成“一个抽象但脱离现状的插件系统”，而应该直接建立在当前已有结构之上：

- 用 `Campaign.meta` 存战役级规则配置
- 用 `selected_module_id` 作为模块附带规则包的入口
- 用 base rules 作为永远可用的底层包
- 用 assembler + resolver 给角色创建、升级、角色卡提供统一规则视图

因此最推荐的路线是：

1. **把现有规则 JSON 规范化为 base package**
2. **把 campaign metadata 升级为 rule_assembly 配置容器**
3. **先提供 `rule-options` API 接入角色创建**
4. **再把升级与角色卡收敛到同一 resolver 体系**

这样可以在不破坏当前流程的前提下，把“职业 / 种族 / 神祇 mod”真正纳入 Deepwood 的一等公民能力。
