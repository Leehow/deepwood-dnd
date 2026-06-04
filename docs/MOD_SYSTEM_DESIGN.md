# Deepwood Mod 系统设计文档

> 状态：提案
> 适用阶段：V1 数据驱动内容模组 → V2 规则扩展 → V3 声明式事件扩展
> 最后更新：2026-03-06

---

## 1. 文档目标

本文档定义 Deepwood（深渊小屋）的 Mod 系统目标、边界、核心数据模型、包格式、运行时装配机制、API 设计、前端集成方式与分阶段实施路线。

目标不是立刻把项目升级为“可执行任意插件的通用引擎”，而是基于当前已有的模块系统，优先构建一个：

- 安全的
- 数据驱动的
- 可安装/启用/禁用/升级的
- 面向战役装配的
- 可分享与导入导出的

内容模组平台。

---

## 2. 背景与现状

当前项目已经具备做 Mod 系统的关键基础：

1. **宿主引擎已存在**
   - 后端：FastAPI + PostgreSQL + WebSocket + SQLAlchemy
   - 前端：Remix + React + TypeScript + Zustand + React Query
   - 实时战役、地图、Token、聊天、战斗、角色等核心系统已存在

2. **模组内容基础已存在**
   - `ParsedModule`：已解析导入模组
   - `CustomModule`：用户原创模组
   - 已有章节、怪物、物品、图片、表格、TOC 等结构化内容

3. **导入导出能力已存在**
   - 现有导出格式：`deepwood-module-v1`
   - 支持导入已导出的 `.dw.json` 内容包

4. **解析流水线已存在**
   - 支持原始文件上传、解析、翻译、嵌入、分享等完整流程

当前问题也很明显：

- 模组能力主要集中在 `backend/app/api/routes/modules.py`，边界过大
- `ParsedModule` 与 `CustomModule` 两套抽象并存，尚未统一
- 当前更偏“内容容器”，还不是“标准化 mod 平台”
- 运行时主要面向“打开单个 module”，尚未形成“战役按需装配多个 mod”的机制
- 数据组织较多依赖 JSONB，大幅提高了早期开发效率，但会限制后续依赖、覆盖、版本迁移与冲突处理能力

---

## 3. 设计目标

## 3.1 核心目标

V1 先实现以下能力：

1. **标准包格式**：所有 mod 必须有统一 `manifest` 和资源布局
2. **统一抽象**：导入模组、原创模组、共享模组统一抽象为 `ModPackage`
3. **战役级启用**：mod 按 campaign 启用，而不是全局启用
4. **可组合装配**：一个战役可以启用多个 mod，并解析出最终内容视图
5. **依赖与兼容性**：支持基础依赖声明与 engine version 检查
6. **可升级与可回滚**：保留版本记录与安装状态，不直接覆盖原始内容
7. **数据驱动优先**：V1 不支持任意代码执行

## 3.2 非目标

V1 明确不做：

- 不支持用户上传 Python/JS 代码在服务端或前端直接执行
- 不支持动态注入任意 UI 组件
- 不支持数据库级脚本迁移由第三方 mod 自动执行
- 不支持复杂脚本沙箱
- 不追求一开始就兼容全部规则重写能力

---

## 4. 术语定义

- **Mod / 模组**：可安装、可启用、可分享的内容或规则扩展包
- **Package**：某个具体版本的模组分发包
- **Manifest**：描述模组元信息、兼容性、依赖、资源索引的元数据文件
- **Installed Mod**：已导入并注册到系统中的模组版本
- **Enabled Mod**：在某个战役中已启用的模组
- **Runtime Assembly**：对某战役启用的多个 mod 进行聚合、排序、冲突处理后的运行时视图
- **Resource**：mod 内部的结构化对象，如章节、地图、怪物、物品、NPC、任务、规则补丁等
- **Overlay / Override**：对已有资源的补充或覆盖行为

---

## 5. 分阶段能力范围

## 5.1 V1：内容型 Mod（推荐立即落地）

支持的资源类型：

- adventure
- chapter
- map
- monster
- item
- npc
- quest
- encounter
- campaign_template
- handout

特点：

- 纯数据驱动
- 安全
- 最适合当前代码基础
- 可快速复用现有 `ParsedModule` / `CustomModule` 数据

## 5.2 V2：规则扩展型 Mod

新增支持：

- class / subclass
- spell pack
- feat pack
- equipment extension
- status effect definitions
- dice / combat rule patches

特点：

- 仍然优先采用声明式配置
- 允许规则计算注册点，但不允许任意执行第三方代码

## 5.3 V3：声明式事件扩展

新增支持：

- scene enter hooks
- quest completion hooks
- campaign start hooks
- encounter start hooks

形式应优先为：

- 声明式事件 + 条件 + 动作配置
- 由宿主引擎解释执行

---

## 6. 设计原则

1. **数据驱动优先于代码驱动**
2. **战役装配优先于全局安装生效**
3. **manifest 协议优先于数据库实现**
4. **包不可变，安装记录可追踪**
5. **资源必须具备稳定命名空间**
6. **允许扩展与覆盖，但必须可审计**
7. **优先兼容现有模块能力，避免推翻重做**

---

## 7. 总体架构

Mod 系统建议分为五层：

### 7.1 Core Engine（宿主引擎）

当前已有：

- campaigns
- characters
- maps
- tokens
- combat
- chat
- websocket
- ai services

Mod 不能绕开宿主引擎直接运行，所有能力最终都由宿主引擎解释和执行。

### 7.2 Content Ingest Layer（内容导入层）

负责：

- 上传原始文件
- 解析 PDF/Markdown/压缩包
- 导入 `.dw.json` 或未来 `.dwmod.zip`
- 校验 manifest 与 schema
- 建立资源索引

### 7.3 Mod Registry（模组注册层）

负责：

- mod 元信息管理
- 版本管理
- 安装状态管理
- 依赖检查
- engine version 检查
- 分享与发布状态

### 7.4 Campaign Assembly（战役装配层）

负责：

- 按 campaign 收集启用的 mod
- 解析依赖顺序
- 应用扩展与覆盖规则
- 生成最终运行时内容视图

### 7.5 Runtime Resolver（运行时解析层）

负责：

- 为地图、怪物、章节、NPC、任务等提供统一查询入口
- 处理冲突后的最终资源视图
- 为前端和 WebSocket 提供装配后的内容结果

---

## 8. 包格式设计

## 8.1 包类型

V1 推荐同时支持：

1. **单文件包**：`.dw.json`
   - 便于兼容当前导入导出
   - 适合轻量内容包

2. **压缩包**：`.dwmod.zip`
   - 适合包含图片、地图、手册附件等资源
   - 作为未来主流格式

## 8.2 标准目录结构

```text
my-mod.dwmod.zip
├── manifest.json
├── module.json
├── resources/
│   ├── chapters.json
│   ├── monsters.json
│   ├── items.json
│   ├── maps.json
│   ├── npcs.json
│   ├── quests.json
│   ├── encounters.json
│   └── rules-patches.json
├── assets/
│   ├── maps/
│   ├── portraits/
│   └── handouts/
└── locales/
    ├── zh-CN.json
    └── en-US.json
```

## 8.3 manifest.json 规范

示例：

```json
{
  "schema_version": "1.0",
  "mod_id": "deepwood.shadowfell.intro",
  "name": "Shadowfell Intro",
  "version": "1.2.0",
  "type": "adventure",
  "title": "暗影界序章",
  "author": "Deepwood Community",
  "description": "适用于 3-5 级角色的短篇模组。",
  "engine": {
    "min": "1.0.0",
    "max": "1.x"
  },
  "dependencies": [
    {"mod_id": "deepwood.rules.core-zh", "version": ">=1.0.0"}
  ],
  "conflicts": [],
  "content": {
    "resource_types": ["chapters", "monsters", "items", "maps", "npcs", "quests"],
    "entrypoints": {
      "adventure": "module.json",
      "chapters": "resources/chapters.json"
    }
  },
  "permissions": {
    "uses_ai": false,
    "reads_campaign_state": false,
    "writes_campaign_state": false
  }
}
```

## 8.4 manifest 字段要求

必填字段：

- `schema_version`
- `mod_id`
- `name`
- `version`
- `type`
- `engine`
- `content`

推荐字段：

- `title`
- `author`
- `description`
- `dependencies`
- `conflicts`
- `permissions`
- `locales`

---

## 9. 资源模型设计

## 9.1 统一资源结构

每个资源必须至少包含：

- `resource_id`
- `resource_type`
- `mod_id`
- `version`
- `schema_version`
- `data`

示例：

```json
{
  "resource_id": "deepwood.shadowfell.intro:monster:grave_hound",
  "resource_type": "monster",
  "mod_id": "deepwood.shadowfell.intro",
  "schema_version": "1.0",
  "version": "1.2.0",
  "data": {
    "name": "墓穴猎犬",
    "cr": 2,
    "hp": 30,
    "ac": 13
  }
}
```

## 9.2 资源 ID 规则

统一采用命名空间格式：

`{mod_id}:{resource_type}:{local_name}`

例如：

- `official.phb:spell:fireball`
- `deepwood.shadowfell.intro:npc:old_mage`
- `user.abc123.homebrew:quest:find_the_relic`

这样可以避免：

- 自增 ID 冲突
- 多 mod 合并时的命名碰撞
- 导入导出后的资源失配

## 9.3 资源关系

资源之间引用统一通过 `resource_id`：

- 章节引用地图
- 遭遇引用怪物
- 任务引用 NPC
- 地点引用 handout

不得使用数据库自增主键作为 mod 包内部的公开引用主键。

---

## 10. 数据库设计

## 10.1 新增核心表

### mods

记录模组逻辑身份：

- `id`
- `mod_id`（唯一）
- `latest_version`
- `display_name`
- `source_type`（official/imported/custom/shared）
- `created_by`
- `is_public`
- `created_at`
- `updated_at`

### mod_versions

记录具体版本包：

- `id`
- `mod_id`
- `version`
- `manifest_json`
- `package_format`
- `storage_path`
- `checksum`
- `install_status`
- `validation_status`
- `created_by`
- `created_at`

### mod_resources

记录资源索引：

- `id`
- `mod_id`
- `version`
- `resource_id`
- `resource_type`
- `resource_name`
- `schema_version`
- `data_json`
- `source_path`
- `hash`

### mod_dependencies

- `id`
- `mod_id`
- `version`
- `depends_on_mod_id`
- `version_range`
- `dependency_type`（required/optional）

### campaign_mods

记录战役启用关系：

- `id`
- `campaign_id`
- `mod_id`
- `version`
- `load_order`
- `enabled`
- `mounted_at`
- `mounted_by`

## 10.2 与现有表的关系

V1 不要求立即删除：

- `parsed_modules`
- `custom_modules`

而是先把它们视为 **旧来源数据**：

- `ParsedModule` → 可迁移为 `source_type=imported`
- `CustomModule` → 可迁移为 `source_type=custom`

迁移完成后，前台业务逐步转向使用统一的 `mods / mod_versions / campaign_mods / mod_resources`。

## 10.3 为什么需要资源索引表

即使资源正文继续保存在 JSONB，也建议建立资源索引表，因为它可以支持：

- 搜索
- 局部加载
- 资源级 diff
- 冲突检测
- 调试与审计
- 装配时按类型高效查询

---

## 11. 运行时装配设计

## 11.1 装配流程

给定一个 `campaign_id`，系统执行：

1. 查询 `campaign_mods` 中已启用 mod
2. 校验依赖是否完整
3. 按 `load_order` 和依赖拓扑排序
4. 读取各版本资源索引
5. 逐类型进行合并
6. 应用扩展 / 覆盖规则
7. 生成运行时视图并缓存

## 11.2 合并规则

V1 推荐提供 3 种语义：

1. **append**：新增资源
2. **extend**：对资源追加字段或子条目
3. **override**：整体替换资源或指定字段

默认策略：

- 不声明 patch 语义的资源，按 `append` 处理
- 同 `resource_id` 冲突时，如果没有显式 `override`，则视为冲突并阻止启用

## 11.3 冲突处理

冲突来源包括：

- 相同 `resource_id` 重复定义
- 不兼容的 engine version
- 缺失 required dependency
- 同一战役内启用了互斥 mod

处理策略：

- 启用前校验并给出明确错误
- 不允许静默覆盖
- 管理界面展示冲突原因与建议修复方式

## 11.4 缓存策略

建议增加 `campaign_mod_runtime_cache`（Redis 或数据库缓存键）：

- key：`campaign:{id}:mods:runtime`
- value：装配后的最终索引与摘要

失效时机：

- campaign_mods 变更
- mod 版本升级
- 某 mod 被禁用/启用
- 资源重新导入

---

## 12. API 设计

## 12.1 Registry API

- `GET /api/mods`
  - 列出当前用户可见 mod
- `GET /api/mods/{mod_id}`
  - 获取 mod 元信息与版本列表
- `GET /api/mods/{mod_id}/versions/{version}`
  - 获取指定版本详情

## 12.2 Import / Export API

- `POST /api/mods/import`
  - 导入 `.dw.json` 或 `.dwmod.zip`
- `GET /api/mods/{mod_id}/export?version=...`
  - 导出指定版本包
- `POST /api/mods/from-parsed/{parsed_module_id}`
  - 从旧 `ParsedModule` 生成 mod
- `POST /api/mods/from-custom/{custom_module_id}`
  - 从旧 `CustomModule` 生成 mod

## 12.3 Validation API

- `POST /api/mods/validate`
  - 上传后校验 manifest、schema、依赖、冲突
- `GET /api/mods/{mod_id}/validation`
  - 查看校验结果

## 12.4 Campaign Mount API

- `GET /api/campaigns/{campaign_id}/mods`
  - 查看该战役启用的 mod
- `POST /api/campaigns/{campaign_id}/mods`
  - 启用一个 mod 到战役
- `PATCH /api/campaigns/{campaign_id}/mods/{mod_id}`
  - 调整启用状态、版本、顺序
- `DELETE /api/campaigns/{campaign_id}/mods/{mod_id}`
  - 从战役卸载 mod

## 12.5 Runtime API

- `GET /api/campaigns/{campaign_id}/content`
  - 获取装配后的内容摘要
- `GET /api/campaigns/{campaign_id}/content/{resource_type}`
  - 获取某类资源列表
- `GET /api/campaigns/{campaign_id}/content/{resource_type}/{resource_id}`
  - 获取具体资源

## 12.6 兼容策略

V1 保留现有模块 API：

- `/api/modules/...`
- `/api/custom-modules/...`

同时新增 `/api/mods/...`。

待前端迁移完成后，再逐步将旧 API 标记为 deprecated。

---

## 13. 前端设计

## 13.1 新页面

建议新增：

- `/mods`：模组总览页
- `/mods/:modId`：模组详情页
- `/campaign/:id/mods`：战役模组管理页

## 13.2 页面能力

### 模组总览页

- 我的模组
- 官方模组
- 共享模组
- 导入模组
- 校验状态
- 版本列表

### 战役模组管理页

- 已启用 mod 列表
- 调整加载顺序
- 冲突提示
- 依赖缺失提示
- 启用/禁用/卸载

### 模组详情页

- manifest 信息
- 资源统计
- 版本历史
- 兼容性信息
- 导出/复制/分享

## 13.3 状态管理建议

前端建议从当前 `moduleStore` 逐步升级为：

- `modRegistryStore`
- `campaignModStore`
- `resolvedContentStore`

分别负责：

- 模组列表与版本信息
- 战役启用关系
- 装配后的运行时内容

---

## 14. 安全与权限设计

## 14.1 V1 权限边界

V1 的 mod 必须是“受限内容包”，不能拥有宿主代码执行权。

禁止行为：

- 执行 Python/JS 任意代码
- 写入未授权业务表
- 访问服务器文件系统任意路径
- 动态执行 SQL

## 14.2 分享权限

建议权限级别：

- private：仅创建者可见
- shared：登录用户可见
- official：平台官方可见

## 14.3 审计要求

所有导入、启用、禁用、升级、删除操作都应记录：

- 操作人
- 时间
- 目标 mod/version
- 校验结果
- 失败原因

---

## 15. 与现有模块系统的映射

## 15.1 ParsedModule 映射

现有 `ParsedModule` 可映射为：

- mod 类型：`adventure`
- 来源：`imported`
- 资源：chapters / monsters / items / images / tables / toc

其现有导出 `deepwood-module-v1` 可被视为未来 manifest 化之前的过渡格式。

## 15.2 CustomModule 映射

现有 `CustomModule` 可映射为：

- mod 类型：`adventure` 或 `campaign_template`
- 来源：`custom`
- 资源：chapters / npcs / locations / encounters / treasures

## 15.3 导入导出兼容建议

建议保持双向兼容：

- 旧 `.dw.json` 可导入为新 mod 版本
- 新 mod 可导出为完整 `.dwmod.zip`
- 必要时可降级导出旧格式，便于平滑过渡

---

## 16. 实施路线图

## Phase 0：协议先行（建议先做）

目标：先定义协议，不急着大规模改表。

任务：

1. 完成 `manifest.json` schema
2. 完成 `.dw.json` → 新 manifest 的兼容映射规则
3. 明确资源 ID 与引用规范
4. 明确冲突与依赖校验规则

## Phase 1：Registry 最小落地

目标：支持“导入 → 注册 → 启用到 campaign”。

任务：

1. 新增 `mods` / `mod_versions` / `campaign_mods`
2. 新增 `/api/mods/import`
3. 新增 `/api/campaigns/{id}/mods`
4. 在前端新增战役模组管理页面
5. 实现基础依赖校验与 engine version 校验

## Phase 2：统一资源索引

目标：让运行时使用统一 mod 资源，而非直接使用旧表。

任务：

1. 新增 `mod_resources`
2. 旧 `ParsedModule` / `CustomModule` 迁移导入器
3. 装配服务 `CampaignContentAssembler`
4. 运行时读取统一资源视图

## Phase 3：覆盖与 patch

目标：支持多个 mod 共存并安全覆盖。

任务：

1. 引入 `extend` / `override` 语义
2. 增加冲突检查器
3. UI 展示冲突与修复建议

## Phase 4：声明式事件扩展

目标：在不开放任意代码执行的前提下增强模组行为表达能力。

任务：

1. 定义事件 schema
2. 定义条件表达式与动作集合
3. 接入战役运行时

---

## 17. 推荐代码组织调整

后端建议从当前大路由逐步拆分为：

- `app/api/routes/mod_registry.py`
- `app/api/routes/mod_import.py`
- `app/api/routes/mod_export.py`
- `app/api/routes/campaign_mods.py`
- `app/api/routes/mod_runtime.py`

服务层建议增加：

- `app/services/mod_manifest_service.py`
- `app/services/mod_validation_service.py`
- `app/services/mod_registry_service.py`
- `app/services/campaign_mod_service.py`
- `app/services/campaign_content_assembler.py`

前端建议增加：

- `frontend/app/services/mod.service.ts`
- `frontend/app/stores/modRegistryStore.ts`
- `frontend/app/stores/campaignModStore.ts`
- `frontend/app/routes/mods.tsx`
- `frontend/app/routes/campaign.$id.mods.tsx`

---

## 18. 测试策略

## 18.1 后端测试

至少覆盖：

- manifest 校验
- 版本兼容校验
- 依赖缺失校验
- 冲突检测
- campaign 装配顺序
- 旧模块导入迁移

## 18.2 前端测试

至少覆盖：

- 模组列表展示
- 模组启用/禁用
- 依赖冲突提示
- 战役内容切换后的 UI 响应

## 18.3 回归测试

重点验证现有能力不被破坏：

- `ParsedModule` 导入导出
- `CustomModule` CRUD
- DM 端模组浏览
- 嵌入与检索链路

---

## 19. 风险与应对

### 风险 1：旧模型与新模型长期双轨维护成本高

应对：

- 明确过渡期
- 所有新功能只接 `mods` 新层
- 旧系统仅做兼容输入源

### 风险 2：资源冲突规则设计过晚，导致数据难以迁移

应对：

- 在 Phase 0 就先定资源 ID 与 override 规则

### 风险 3：过早开放脚本扩展导致安全复杂度失控

应对：

- V1/V2 坚持不支持任意代码执行

### 风险 4：运行时装配性能下降

应对：

- 装配结果缓存
- 资源索引表
- 按资源类型分页/按需加载

---

## 20. 结论

Deepwood 当前并不是“没有模组系统”，而是已经拥有一个强大的**模块内容基础设施**。接下来的关键不是推翻重做，而是把现有能力提升为一个标准化的、可装配的、战役级启用的 Mod 平台。

建议的核心路线是：

1. **先定 manifest 协议**
2. **再建 registry 与 campaign_mods**
3. **随后统一资源索引与运行时装配**
4. **最后才考虑规则 patch 与声明式事件扩展**

这个路线既能复用当前代码资产，也能避免在安全、复杂度和兼容性上一次性失控。

---

## 21. 下一步建议

如果进入实施阶段，建议优先输出以下三份子文档：

1. `docs/MOD_MANIFEST_SCHEMA.md`
   - 专门定义 manifest 与资源 schema
2. `docs/MOD_REGISTRY_DATA_MODEL.md`
   - 专门定义数据库模型与迁移策略
3. `docs/MOD_IMPLEMENTATION_PLAN.md`
   - 专门定义分阶段任务拆解、接口顺序与验收标准

这三份文档完成后，再进入代码落地，会明显更稳。
