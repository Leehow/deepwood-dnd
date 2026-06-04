# DND 5E Platform 架构审计报告

**审计时间**：2026-03-20
**审计范围**：`frontend/app/`、`backend/app/`、`backend/app/models/`、`docs/` 中现有总览与实现说明
**目标**：从当前源码实况出发，评估架构设计质量、主要风险、可扩展性，以及最值得优先优化的部分

配套文档：

- `docs/PROJECT_OVERVIEW.md`
- `docs/ONBOARDING_30_MIN.md`
- `docs/PROJECT_FRONTEND_GUIDE.md`
- `docs/PROJECT_BACKEND_GUIDE.md`
- `docs/PROJECT_DATA_MODEL_GUIDE.md`
- `docs/architecture/REFACTORING_ROADMAP_2026.md`

---

## 审计后推进进度（2026-03-21）

这份文档的主体结论仍然基于 2026-03-20 的源码审计快照，但在审计完成后，仓库已经推进了一轮真实重构，进度如下：

- 前端已补 typed event bus，并开始把 DM/Player 页面从超级 route 抽成 campaign shell。
- 后端已建立 `backend/app/services/realtime_publisher.py`，并把一批高频实时消息从 route 内联广播改成统一出口。
- 后端 `characters/combat` 已经开始第一批 service 化，不再完全由超大 route 直接编排所有细节。
- `module_chat.py` 也已经开始把实体创建相关纯逻辑、头像后台任务、`encounter` 批量创建和 `execute-map-encounter` 的落图编排拆到独立 service，进入第二阶段治理。
- 截至 2026-03-21，以下热点 route 已经清掉直接 `broadcast_to_campaign/send_to_recipients`：
  - `backend/app/api/routes/combat.py`
  - `backend/app/api/routes/characters.py`
  - `backend/app/api/routes/tokens.py`
  - `backend/app/api/routes/campaign_storage.py`
  - `backend/app/api/routes/spell_cast.py`
  - `backend/app/api/routes/chat.py`
  - `backend/app/api/routes/map_markers.py`
  - `backend/app/api/routes/chests.py`
  - `backend/app/api/routes/campaigns.py`
  - `backend/app/api/routes/character_crud.py`
  - `backend/app/api/routes/voice.py`
  - `backend/app/api/routes/resource_chat.py`
  - `backend/app/api/routes/monster_instances.py`
  - `backend/app/api/routes/module_chat.py`
  - `backend/app/api/routes/websocket_simplified.py`

截至当前这轮推进，`backend/app/api/routes/` 已经没有剩余的 route 级直发广播。换句话说，“广播发布点分散”这个问题仍然存在于系统整体层面，但 route 层最直接的一批高频出口已经全部收口到了 `realtime_publisher.py`。

这意味着本报告里“广播发布点分散”这一判断仍然成立，但最核心的主业务路径已经开始实质收口，并且 route 层已经完成第一阶段清边界。

补充说明：在 route 级广播清边界之后，`module_chat.py` 也已经不再只停留在“helper 外提”阶段，当前已经新增并接入：

- `backend/app/services/module_entity_service.py`
- `backend/app/services/module_avatar_generation_service.py`
- `backend/app/services/module_chat_usecase_service.py`
- `backend/app/services/module_encounter_usecase_service.py`
- `backend/app/services/module_encounter_planning_service.py`
- `backend/app/services/module_snapshot_service.py`
- `backend/app/services/module_task_flow_service.py`
- `backend/app/services/module_extraction_stream_service.py`
- `backend/app/services/module_parse_task_service.py`
- `backend/app/services/module_parse_flow_service.py`
- `backend/app/services/module_translation_service.py`

也就是说，模组系统的下一阶段热点已经从“把广播统一发出去”切到了两条并行主线：

- 把 `module_chat.py` 里的实体创建、遭遇编排和 planning 文本链抽回 service/usecase
- 把 `modules.py` 里的读取/导出/导入快照构造、embedding 任务流、monster/item 抽取 SSE 包装、parse task / translate / parsed module upsert 主链，以及 translate SSE/单章节翻译链抽回 service，让 route 不再内联大量 payload 整形和任务样板

---

## 1. 结论摘要

这是一个**方向正确、能力完整，但局部实现已经明显超载**的架构。

从系统级视角看，这个项目的主架构其实不差：

- 前后端职责有基本边界
- 后端有 `routes / services / models` 的层次
- WebSocket 已经从“大一统入口”演进到 handler registry
- 地图初始化采用 bulk endpoint，体现了性能意识
- AI 模型接入采用 usage-based 配置，而不是到处硬编码
- 模组、资源、语音、战斗、地图这些子系统都已经各自成型

但从实现级视角看，几个关键区域已经进入“功能越加越快，维护成本越升越高”的阶段：

- 前端形成了隐式事件总线
- 前端状态管理方案多套并存
- 后端 route 层过胖
- 实时广播发布点过于分散
- API 命名与鉴权契约不够统一
- 数据模型灵活但约束较弱，source of truth 有重复

**一句话评价**：

- 系统级架构：健康
- 实现级架构：承压
- 当前主要问题：不是“架构方向错”，而是“边界开始失守”

---

## 2. 我这次审计参考了哪些信号

这次判断不是只看目录名，而是结合了以下实际信号：

### 2.1 代码规模

- `backend/app` 约 455 个文件
- `frontend/app` 约 517 个文件
- `backend/app/api/routes` 49 个路由模块
- `backend/app/services` 63 个服务文件
- `frontend/app/components` 288 个组件文件

### 2.2 后端超大文件

最大的几个后端热点：

- `backend/app/api/routes/combat.py`：约 8082 行
- `backend/app/api/routes/characters.py`：约 7012 行
- `backend/app/api/routes/module_chat.py`：约 4278 行
- `backend/app/api/routes/modules.py`：约 3337 行
- `backend/app/api/routes/ai_settings.py`：约 2996 行
- `backend/app/api/routes/tokens.py`：约 2891 行

### 2.3 前端超大文件

最大的几个前端热点：

- `frontend/app/components/map/TacticalMap.client.tsx`：约 15593 行
- `frontend/app/components/ui/ChatPanel.tsx`：约 5596 行
- `frontend/app/components/map/SelectionContextMenu.tsx`：约 4845 行
- `frontend/app/components/campaign/ModuleScriptPanel.tsx`：约 4823 行
- `frontend/app/components/character/CharacterPanel.tsx`：约 3879 行
- `frontend/app/routes/campaign.$id.player.tsx`：约 3793 行
- `frontend/app/routes/campaign.$id.dm.tsx`：约 3215 行

### 2.4 前端隐式事件总线迹象

前端源码中：

- `dispatchEvent / addEventListener` 命中约 564 处
- 自定义事件名约 87 个

高频事件包括：

- `showToast`
- `characterEquipmentUpdated`
- `combatActionUsed`
- `classFeatureUsesUpdated`
- `consumeSpellSlot`
- `characterUpdated`
- `restGrant`
- `spellCastChat`
- `startAbilityTargeting`

这说明前端已经形成了一个**事件驱动型的隐式跨组件通信层**。

### 2.5 前端状态管理混用迹象

前端代码中粗略统计：

- `useQuery / useMutation` 约 10 处
- `apiFetch(...)` 约 246 处
- 原生 `fetch(...)` 约 200 处

这说明前端当前不是单一路径：

- React Query 存在，但不是主导模式
- 手写请求、手写 cache、局部 state、Zustand、DOM 事件都在同时发挥作用

### 2.6 后端广播发布点分散

以下统计来自 2026-03-20 的审计快照：

- 16 个 route 文件直接调用 `broadcast_to_campaign / send_to_recipients`
- 21 个 service 文件也直接调用这些广播方法

这说明实时消息虽然有统一 manager，但**消息发布职责没有完全收口**。截至 2026-03-21 的最新进度，route 层这部分已经完成第一阶段收口，剩余问题主要落在 service 层和大文件内部编排上。

### 2.7 数据模型的 JSON 负载密度

带 `JSON / JSONB` 字段的模型约 27 个，几个最重的模型：

- `character.py`
- `monster_instance.py`
- `item.py`
- `token.py`
- `parsed_module.py`
- `custom_module.py`

这说明当前数据模型是典型的**关系表骨架 + JSON 业务负载**混合架构。

### 2.8 鉴权契约混用

路由中：

- 使用 `Depends(require_auth)` 的命中约 167 处
- 直接读取 `X-User-ID` header 的命中约 46 处

这意味着后端鉴权方式并不完全统一，前端 [api-client.ts](/Users/haoli/leehow/code/dw/frontend/app/utils/api-client.ts) 同时注入 Bearer 和 `X-User-ID`，本质上是在帮后端做兼容兜底。

---

## 3. 当前架构做得好的地方

## 3.1 顶层分层是清楚的

项目一级目录没有混乱：

- `frontend/` 负责产品界面与运行时交互
- `backend/` 负责 API、业务逻辑、实时和 AI
- `docs/` 用来承载设计与接手资料
- `dnd-platform/` 用来存模组与资源

这对长期维护非常重要，因为至少顶层没有“所有东西扔一起”。

## 3.2 后端从“脚本式 API”向“服务式 API”演进过

`routes / services / models` 的结构说明项目不是完全 route-first 生长出来的。

虽然 route 层仍然很重，但服务层已经具备明显职责：

- 角色派生与生成
- 法术解析
- 模组 OCR / 解析
- embedding / rerank
- AI 模型配置
- WebSocket handler

这意味着后续重构不是从 0 开始，而是有可用基础。

## 3.3 WebSocket 结构方向是健康的

当前 WebSocket 已经具备：

- 单一入口
- `ConnectionManager`
- `HandlerRegistry`
- 按消息类型拆分 handler

这比“一个 1000 行 websocket.py + 巨型 if/else”要可持续得多。

尤其像 `map / fog / drawing / dice / trade / time / terrain / music / voice` 这些 handler，已经是很好的边界雏形。

## 3.4 地图初始化思路是正确的

前端地图没有傻傻地做 8 个接口并发，而是通过：

- `backend/app/api/routes/map_bulk_data.py`
- `frontend/app/components/map/hooks/useMapData.ts`

走 bulk data 方式加载。

这体现出两个好习惯：

- 以体验为导向的接口设计
- 后端愿意为了前端运行态优化接口形态

## 3.5 AI 接入方式比多数项目成熟

`ai_model_service.py` 把能力配置抽成了：

- `usage_key`
- `model_type`
- `AIModelConfig`

这种设计的好处是：

- 模型替换成本低
- 多供应商切换容易
- 可以按场景选模型，而不是按文件硬编码

这块是这个项目架构里比较成熟的一部分。

## 3.6 模组系统已经形成独立子系统

模组不是“上传文件 -> 存数据库”这么简单，而是完整包含：

- 原始文件
- OCR
- 图片分类
- TOC 提取
- 怪物 / 物品抽取
- 解析任务
- 结构化模组
- 模组问答
- 向量索引

从架构上看，这说明项目已经具备**平台化的能力层**，不是只有战役页面。

---

## 4. 当前架构的核心问题

## 4.1 前端形成了隐式事件总线

这是我认为当前前端最值得警惕的问题。

现象：

- 大量 `window.dispatchEvent`
- 大量 `window.addEventListener`
- 事件名分布在多处文件
- 角色、地图、快捷栏、战斗、聊天会通过 DOM event 串起来

问题不在于“事件机制不能用”，而在于当前规模下它带来的代价很高：

- 跨组件依赖关系不可见
- 类型不受约束
- 改事件名容易静默失效
- 调试时要跨越多个页面、组件、hooks 和 util
- 很难回答“这个动作到底会触发哪些下游影响”

**架构判断**：

- 小范围临时机制：合理
- 当前这种全局高频使用：已经开始侵蚀可维护性

## 4.2 前端状态管理没有统一模型

现在前端同时存在：

- React 局部 state
- React Query
- Zustand
- cache util
- `localStorage / sessionStorage`
- DOM CustomEvent

问题不是“用了很多工具”，而是**没有清晰的分工边界**。

典型后果：

- 某个状态到底该看 Query、store、cache 还是事件刷新，不容易判断
- 新功能会倾向复制已有模式，而不是进入统一轨道
- 页面行为容易出现“为什么这里更新了，那里没更新”

这个项目当前最需要的是：

- 明确哪些是 server state
- 明确哪些是 session state
- 明确哪些是 transient UI state
- 明确哪些事件值得保留，哪些应收敛到 store

## 4.3 前端壳层与地图主控文件过载

最大热点文件表明，当前前端至少有三个“超载中心”：

- `TacticalMap.client.tsx`
- `campaign.$id.dm.tsx`
- `campaign.$id.player.tsx`

它们的问题是职责过多：

- 页面装配
- 领域状态
- WebSocket 处理
- 弹窗编排
- 目标选择
- 战斗动作入口
- 资源消耗反馈

一旦一个文件同时承担“运行态编排 + UI 呈现 + 行为控制”，后续任何改动都会扩大影响面。

## 4.4 后端 route 层过胖

`combat.py`、`characters.py`、`module_chat.py`、`modules.py` 这些文件的规模说明：

- route 不只是入口
- route 还承担了相当多的业务编排、规则判断、DB 修改和广播逻辑

这带来的问题：

- 测试粒度被迫粗
- 复用困难
- 行为不容易分层验证
- 改动一处逻辑时，很难不碰到 HTTP 细节和广播细节

当前服务层虽然存在，但还没有完全成为“系统真正的业务中枢”。

## 4.5 实时广播职责没有收口

虽然有统一的 `manager.broadcast_to_campaign()`，但发布点太散：

- route 里直接发
- service 里直接发
- websocket handler 里也发

这会导致几个问题：

- 消息契约容易漂移
- 同类事件可能有多种 payload 形态
- 很难建立统一的事件文档
- 也不利于以后补审计日志、监控、回放能力

更理想的结构应该是：

- 业务先产生 domain event
- 再由统一 publisher 转成 WebSocket payload

## 4.6 API 设计不够统一

当前前缀混用：

- `/api/...`
- `/campaigns`
- `/characters`
- `/tokens`
- `/spells`
- `/rules-embedding`

同时鉴权也混用：

- `Bearer`
- `X-User-ID`

问题不是“能不能用”，而是：

- 前端调用层必须知道很多特殊情况
- 新人难以形成一致预期
- 以后要做 SDK、文档自动化或中间层会比较痛苦

## 4.7 数据模型灵活，但约束弱

当前大量运行态和复杂结构存在 JSON / JSONB 字段中。

优点：

- 迭代快
- D&D 复杂规则可以快速承载

代价：

- 数据库层约束较弱
- schema 演进更多依赖代码
- 查询优化难度更高
- 前后端字段契约容易漂移

典型代表：

- `Character`
- `Token`
- `MonsterInstance`
- `ParsedModule`

## 4.8 source of truth 存在重复

一些运行态会在多个实体上出现，比如：

- `Character.current_hp`
- `Token.current_hp`

再加上：

- `status_effects`
- `active_effects`
- `class_feature_uses`
- `concentration_spell`

这些状态横跨角色、token、地图和战斗，容易出现：

- 修改一处但没同步另一处
- 前端以为 A 是权威，后端以为 B 是权威

这个问题不会立刻炸，但会持续拖慢后续功能开发。

## 4.9 代码库存在历史残留与双轨痕迹

目前还可以看到一些非主路径痕迹：

- `character_crud.py`
- `voice.py`
- 旧 websocket 目录残留
- 多份历史分析文档与当前代码不完全同步

这类问题对老成员影响不大，但会显著拉高新人理解成本。

---

## 5. 子系统级评价

## 5.1 前端架构

**评价**：产品能力强，运行态复杂，但边界控制开始失守。

优点：

- 页面分区明确
- 领域组件组织基本合理
- 地图 hooks 化已经迈出一步

问题：

- 超大壳层和超大地图主控
- 事件链隐式化
- 多套状态模型并存

**结论**：最需要先治理的是这里。

## 5.2 后端 API / service 架构

**评价**：整体分层方向正确，但 route-first 历史包袱明显。

优点：

- 有 service 层
- 有模型层
- 大部分业务按域分文件

问题：

- 超大 route 文件
- 广播散发
- 鉴权和接口契约混用

**结论**：这是第二优先级治理区。

## 5.3 WebSocket 架构

**评价**：方向好，结构比其他部分更健康。

优点：

- registry 模式
- manager 集中管理连接
- 消息 handler 按域拆分

问题：

- 广播 payload 规范仍然缺文档化
- HTTP 改库 -> WebSocket 广播 的通道没有收口

**结论**：不是大问题，但值得继续规范化。

## 5.4 数据模型架构

**评价**：灵活、强业务承载，但长期演进成本会上升。

优点：

- 很适合快速支持 D&D 复杂数据
- 模组解析和 AI 输出很容易落地

问题：

- JSON 负载太重
- source of truth 不总是明确
- 数据契约更依赖代码而不是 schema

**结论**：短期可继续沿用，长期要逐步类型化高频运行态。

## 5.5 AI 与模组子系统

**评价**：是整个项目里“平台化程度最高”的区域之一。

优点：

- usage-based model config
- embedding / rerank 架构清晰
- 模组解析是完整 pipeline

问题：

- route 文件过大
- 长流程任务和同步请求边界可继续优化
- `modules.py` 虽然已经把 snapshot / embedding / extraction / parse task / translate-persist / translate SSE 这几批主链收出一部分 service，但 websocket parse 主流程仍然偏重

**结论**：架构方向优秀，但也开始需要更强的任务边界。

---

## 6. 总体评分

这是主观评分，只用于帮助判断优先级：

| 维度 | 评分 | 说明 |
| --- | --- | --- |
| 顶层系统设计 | 8/10 | 主方向清楚，系统能力完整 |
| 模块边界清晰度 | 6/10 | 目录清楚，但热点区域边界开始模糊 |
| 前端可维护性 | 5/10 | 功能强，但隐式耦合重 |
| 后端可维护性 | 6/10 | 分层存在，但 route 层过胖 |
| 实时架构质量 | 7.5/10 | 已经有 registry 基础，方向健康 |
| 数据模型可演进性 | 6/10 | JSON 灵活，但长期约束偏弱 |
| AI / 模组平台化 | 8/10 | 抽象层次较好 |
| 新人接手难度 | 4.5/10 | 能接，但学习曲线陡峭 |

**综合判断**：`6.5 / 10`

这不是一个“需要推倒重来”的系统，而是一个“需要系统性收边界和降复杂度”的系统。

---

## 7. 最值得优先做的优化方向

## 7.1 P0：前端通信与状态收口

优先目标：

- 收敛 `CustomEvent`
- 给战役页建立更明确的状态中枢
- 拆地图主控和页面壳层

原因：

- 当前前端是最影响迭代效率的部分
- 每个新功能都在放大这块复杂度

## 7.2 P0：后端 route -> service 职责回收

优先目标：

- `combat`
- `characters`
- `modules`
- `module_chat`

把业务编排、状态修改、消息发布逐步移到 application service。

## 7.3 P1：统一 API 契约与鉴权模型

优先目标：

- 统一 `/api/...` 前缀
- 统一 Bearer 为主的鉴权约定
- `X-User-ID` 降级为兼容层

## 7.4 P1：给高频 JSON 运行态补类型边界

优先目标：

- token runtime payload
- character runtime payload
- concentration / casting / active_effects

先做代码层 schema 收口，不急着一次性改数据库结构。

## 7.5 P2：构建统一实时事件发布层

目标：

- 业务逻辑只产出 domain event
- WebSocket payload 由统一 publisher 转译

这样以后补：

- 监控
- 回放
- 审计
- event contract 文档

都会容易很多。

---

## 8. 不建议做的事

以下做法风险大，不建议一上来就做：

- 一次性重写地图系统
- 一次性把所有 JSON 字段关系化
- 一次性把所有请求改成 React Query
- 一次性把所有 route 文件拆完
- 先做目录重组，再想业务边界

原因很简单：

- 这个项目已经跑着很多功能
- 大爆炸式重构回归面太大
- 你更需要的是“逐步收口”，不是“整体翻新”

---

## 9. 推荐的重构策略

最佳策略不是 Big Bang，而是：

1. 先确定边界
2. 先收敛新代码入口
3. 用增量迁移替代整体替换
4. 优先治理高频热点
5. 每一轮重构都要能带来局部确定收益

对应路线图请看：

- `docs/architecture/REFACTORING_ROADMAP_2026.md`

---

## 10. 最后的判断

这个项目最可贵的地方是：它已经不是“原型”，而是一个能力非常完整的 D&D 平台。

它现在最大的问题也正因为此：

- 子系统多
- 状态多
- 实时链路多
- 平台能力多

所以后续工作的重点不该只是“再加功能”，而应该是：

- 明确边界
- 收敛通信方式
- 让每个子系统更独立
- 让新人和未来的自己都更容易维护它

如果把这件事做对，这个项目会从“强功能产品”进一步变成“可持续演进的平台”。

---

## 11. 补充审计：初始报告未覆盖的子系统与风险点

> 以下内容基于 2026-03-20 的二次深度调研补充，覆盖初始审计未充分展开的 10 个领域。

### 11.1 前端手写 Cache 层

初始报告提到了"状态管理混用"，但没有单独审计 `frontend/app/utils/` 下的 **11 个手写内存缓存文件**（约 678 行）。

**典型代表**：

| 文件 | 缓存对象 | TTL | 模式 |
|------|----------|-----|------|
| `characterCache.ts` | 角色详情 | 30s | `Map<number, CacheEntry>` + 请求去重 |
| `mapTokensCache.ts` | 地图 token 列表 | 1s | `Map<string, CacheEntry>` + 请求去重 |
| `combatStateCache.ts` | 战斗状态 | — | 手写 Map |
| `campaignMembersCache.ts` | 战役成员 | — | 手写 Map |
| `requestCache.ts` | 通用工厂 | 可配置 | `createTimedRequestCache<T>(ttl)` |

**架构判断**：

这层缓存与 Zustand（13 个 store）和 React Query 共同构成了**"三轨并存"**的前端数据管理格局：

1. **React Query** — 存在但覆盖面很小（约 10 处 `useQuery/useMutation`）
2. **Zustand stores** — 13 个，管理 UI 和会话状态
3. **手写 cache** — 11 个，管理 API 响应缓存和请求去重

`requestCache.ts` 已经提供了通用的 `createTimedRequestCache<T>()` 工厂，说明团队意识到了碎片化问题并开始收敛，但其他文件仍各自实现。这层缓存是 Phase 3"统一 server state 策略"中需要**明确退役**的候选。

### 11.2 前端 API 客户端碎片化

初始报告只提到了 `apiFetch` 和原生 `fetch` 的混用，但实际上前端至少有 **4 套 HTTP 调用方式**：

| 文件 | 模式 | 特性 |
|------|------|------|
| `utils/api-client.ts` | `apiFetch()` 函数 | 老封装，注入 Bearer + X-User-ID |
| `utils/typed-api-client.ts` | 单例 `api` 对象 | 类型化，带 `get<T>`/`post<T>` 方法 |
| `utils/fetchWithRetry.ts` | `ApiClient` 类 | 带指数退避重试 |
| `services/api.service.ts` | `BaseApiService` 类 | 新的 service 层基类 |

**碎片化的后果**：

- 错误处理行为不一致（有的吞异常返回 null，有的抛出）
- 认证注入逻辑重复
- 重试策略不统一（只有 `fetchWithRetry` 有）
- 新开发者不知道该用哪一套

**正面信号**：`services/api.service.ts` 和 `typed-api-client.ts` 代表了收敛趋势，但需要明确它们的关系和适用场景。

### 11.3 前端 Services 层的正面信号

初始报告未提及 `frontend/app/services/` 目录，但这里已经有 **7 个服务文件**在形成抽象：

- `api.service.ts` — 基础 HTTP 服务基类
- `campaign.service.ts` — 战役操作
- `character.service.ts` — 角色操作
- `chat.service.ts` — 聊天操作
- `module.service.ts` — 模组操作
- `spellDataLoader.ts` — 法术数据加载
- `campaignStorage.ts` — 战役存储

这是一个**积极的架构演进信号**：前端正在从"组件内直接 fetch"向"服务层封装"迈进。但它与手写 cache 层、typed-api-client 之间的关系还没有明确定义——三者在功能上有重叠。建议在 Phase 1 中明确这三层的分工和废弃策略。

### 11.4 后端规则引擎散落在 utils 中

后端 `app/utils/` 承载了大量 D&D 5E **核心规则引擎逻辑**，而非简单的工具函数：

| 文件 | 职责 |
|------|------|
| `class_effects.py` | 职业战斗效果（狂暴、鲁莽攻击等） |
| `race_effects.py` | 种族战斗效果（203 行） |
| `feat_effects.py` | 专长效果 |
| `spell_effects.py` | 法术效果 |
| `rules_cache.py` | 规则数据加载与缓存 |

**架构问题**：

`class_effects.py` 已经开始向 `services/effect_service.py` 委托（保留兼容层），说明团队已意识到这个问题。但从全局看，D&D 规则引擎逻辑分散在：

- `app/utils/` — 效果计算、规则数据
- `app/services/effect_service.py` — 统一效果服务（481 行，新）
- `app/services/spell_resolver.py` — 法术解析（1460 行）
- `app/services/immunity_service.py` — 免疫判定（776 行）
- `app/services/passive_feature_service.py` — 被动特性（413 行）
- `app/services/class_resource_service.py` — 职业资源（425 行）

而 `app/domain/` 几乎为空，只有 `parsing/` 子目录处理模组解析。**核心业务规则没有进入 domain 层**，这是架构上的一个显著空洞。

### 11.5 Chapter Agent 子系统

`backend/app/services/chapter_agent/` 是一个完整的 **pydantic_ai Agent 子系统**，包含 6 个文件：

- `agent.py` — Agent 工厂，创建 `pydantic_ai.Agent[AgentDeps, str]`
- `tools.py` — 4 个工具函数（`search_module_content`、`search_rules`、`get_creator_guide`、`edit_content`）
- `prompts.py` — 系统 prompt 构建器
- `schemas.py` — `RangeEdit`、`AgentSSEEvent` 等数据结构
- `history.py` — 聊天历史持久化与 pydantic_ai `ModelMessage` 转换
- `deps.py` — `AgentDeps` 依赖容器

**架构意义**：

这个子系统和项目其他 AI 调用（通过 `AIService.generate_completion()` 直接调用）是完全不同的范式——它使用 **Agent + Tool 模式**，有独立的上下文管理和工具链。如果后续有更多 Agent 场景（如战斗裁决 Agent、NPC 对话 Agent），这里的模式值得作为参考架构。

当前 AI 调用存在两种范式：

1. **直接调用**：`AIService.generate_completion()` / `generate_stream()` — 项目中大部分 AI 功能使用
2. **Agent 模式**：`chapter_agent` — 唯一一个，有工具链和历史管理

### 11.6 i18n 基础设施：存在但未被采纳

`frontend/app/utils/i18n/` 包含国际化基础设施：

- `dictionary.ts` — 集中式翻译字典（中英文映射）
- `useDictionary.ts` — React Hook 封装

**现状评估**：

从代码搜索看，`useDictionary` 的使用率**极低**——绝大多数组件仍使用硬编码中文字符串。这属于"基础设施已就位但未被推广采纳"的状态。

**建议**：在架构治理中明确它的定位：

- 如果计划国际化 → 制定采纳路线图，新组件强制使用
- 如果不计划国际化 → 标记为实验性代码，避免维护负担

### 11.7 错误处理体系分散

前端错误处理存在**多套机制并存**的局面：

| 机制 | 职责 | 位置 |
| ---- | ---- | ---- |
| `ErrorBoundary` | 通用 React 错误边界 | `components/error/ErrorBoundary.tsx` |
| `MapErrorBoundary` | Konva 地图专用错误边界 | `components/map/MapErrorBoundary.tsx` |
| `permissionErrors.ts` | 权限错误分类系统 | `utils/permissionErrors.ts` |
| `permissionQuery.ts` | 权限查询辅助 | `utils/permissionQuery.ts` |
| Toast 通知 | 用户提示 | 33 个文件使用，存在 hook 版和 CustomEvent 版两套 |

**问题**：

- 错误分类没有统一标准（有的用 HTTP status，有的用业务枚举）
- Toast 通知的触发方式不一致（hook vs CustomEvent）
- 缺少全局错误监控和上报机制

### 11.8 测试覆盖严重不足

这是整个项目**风险最高的单一问题**，直接影响重构路线图的可行性。

**后端测试现状**：

- 测试文件：~24 个（`backend/tests/`）
- 其中 unit 测试：6 个（`tests/unit/`）
- 源码文件：~224 个（`backend/app/`）
- **粗略覆盖率**：测试文件数 / 源码文件数 ≈ 10.7%

**后端测试分布**：

| 领域 | 测试文件 | 覆盖情况 |
| ---- | ---- | ---- |
| 怪物/战斗 | 6 个 | `monster_extraction`、`fireball_saves`、`control_effect`、`immunity`、`contest_checks`、`dispel_magic` |
| 角色 | 3 个 | `character_equipment`、`characters_api`、`character_sheet_service` |
| 战役 | 2 个 | `campaign_storage`、`campaign_cascade_delete` |
| 认证 | 1 个 | `auth_api` |
| 模组解析 | 2 个 | `parsers`、`appendix_identification` |
| AI | 1 个 | `json_format_agent` |

**前端测试现状**：

- Vitest 单元测试：**覆盖有限**，`frontend/tests/` 下有少量测试（如 `ErrorBoundary.test.tsx`、`useMapData.test.ts`、`useChatMessages.test.ts`、`useUndoRedo.test.ts`），但相对于组件/hook 总量覆盖率很低
- E2E 测试：分散在 `debug/` 和 `frontend/tests/` 中（如 `control-spell.spec.ts`、`i18n-translation.spec.ts`）
- 类型检查：`npm run typecheck` 可用

**风险评估**：

路线图核心是增量重构，而**没有测试覆盖的重构风险极高**。特别是：

- Phase 2 要拆的热点文件（`characters.py` ~7000 行、`combat.py`、`TacticalMap.client.tsx`）几乎没有测试保护
- 规则引擎逻辑（effect、spell、immunity）只有少量测试
- WebSocket 行为完全没有自动化回归

**建议**：在路线图中增加 **Phase 0.5：关键路径测试补全**，作为 Phase 1 重构的前提条件。

### 11.9 Domain 层空洞

`backend/app/domain/` 目录结构：

```text
domain/
  __init__.py
  parsing/
    __init__.py
    pipeline.py      — 模组解析流水线
    schemas.py        — 解析数据结构
    toc_extractor.py  — 目录提取
    oss_storage.py    — OSS 存储
    parsers/
      __init__.py
```

**问题**：`domain/` 本应是核心业务规则的归属地，但目前只有模组解析相关代码。D&D 5E 的核心规则（职业、种族、法术、效果计算）全部散落在 `utils/` 和 `services/` 中（详见 11.4）。

**建议的 domain 层扩展方向**：

- `domain/rules/` — 效果计算、属性规则、职业特性
- `domain/combat/` — 战斗裁决、伤害计算、豁免判定
- `domain/character/` — 角色创建规则、升级规则、装备规则

### 11.10 数据库迁移治理

项目当前有 **101 个 Alembic 迁移文件**，这个数字反映了：

1. **Schema 变化频率极高** — 平均每周多次迁移
2. **缺少迁移合并策略** — 没有定期 squash 或合并迁移链
3. **潜在风险** — 长迁移链增加了 `alembic upgrade head` 的执行时间和失败概率

**建议**：

- 定期（如每季度）评估是否需要 squash 已完成的迁移
- 在 CI 中加入迁移健康检查（如检测分叉、检测空迁移）
- 考虑在开发文档中记录迁移命名规范

---

## 12. 补充审计总结

初始审计报告（Sections 1-10）对系统级架构和热点问题的分析是准确的。本次补充审计聚焦的 10 个领域可归纳为三个主题：

### 主题一：中间层碎片化（11.1 - 11.3）

前端存在 4 套 HTTP 客户端 + 11 个手写 cache + 7 个 service 文件的"三层重叠"。收敛趋势已出现但未完成。

### 主题二：规则引擎无归属（11.4, 11.9）

D&D 核心规则逻辑散落在 `utils/` 和 `services/` 中，`domain/` 层几乎为空。这是后端架构最显著的结构性问题。

### 主题三：重构保护网缺失（11.8, 11.10）

测试覆盖率约 10%，前端无单元测试，101 个迁移文件无合并策略。这直接威胁到重构路线图的可行性——**没有测试保护的重构就是冒险**。

**优先级建议**：

1. **最高优先级**：补充关键路径测试（11.8）— 这是所有重构的前提
2. **高优先级**：收敛 API 客户端（11.2）和明确 cache/service/client 分工（11.1-11.3）
3. **中优先级**：启动 domain 层建设（11.9），将规则引擎逻辑归位（11.4）
4. **可延后**：i18n 定位（11.6）、迁移治理（11.10）、错误处理统一（11.7）
