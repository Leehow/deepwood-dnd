# DND 5E Platform 源码总览

本文档基于当前仓库源码整理，目标是给第一次接手这个项目的人一份“从代码出发”的介绍，而不是只看 README 的功能摘要。

配套导航：

- `docs/ONBOARDING_30_MIN.md`
- `docs/PROJECT_FRONTEND_GUIDE.md`
- `docs/PROJECT_BACKEND_GUIDE.md`
- `docs/PROJECT_DATA_MODEL_GUIDE.md`
- `docs/architecture/ARCHITECTURE_REVIEW_2026.md`
- `docs/architecture/REFACTORING_ROADMAP_2026.md`

适用范围：
- 仓库根目录 `dw/`
- 前端源码 `frontend/app/`
- 后端源码 `backend/app/`
- 当前文档以 2026-03 代码形态为准

重要说明：
- 一些旧文档和 README 仍然把前端称为 “Remix”，但当前代码和依赖实际上已经以 `react-router` 7 系列为主。
- 这个项目不是一个轻量 demo，而是一个规模较大的 D&D 5E 跑团平台。当前仓库内大约有：
  - `backend/app` 455 个文件
  - `frontend/app` 517 个文件
  - `backend/app/api/routes` 49 个路由模块
  - `backend/app/models` 45 个模型文件
  - `backend/app/services` 63 个服务文件
  - `frontend/app/components` 288 个组件文件

## 1. 项目定位

这是一个面向 D&D 5E 在线跑团的全栈平台，核心能力不是单一聊天室或地图页，而是把以下系统组合到了一起：

- 战役大厅与成员管理
- DM / 玩家双视角战役界面
- 实时战术地图
- 角色卡、升级、多职业、资源与状态系统
- 战斗结算、法术施放、持续效果与专注
- 商店、箱子、掉落袋、交易
- 冒险模组上传、OCR、解析、结构化和 AI 辅助
- 规则检索、模组问答、资源问答
- AI 文本/图片/头像/翻译/语音能力
- LiveKit 语音房间、语音转文字、文字转语音

如果把这个仓库当作“一个普通的 CRUD Web 项目”去理解，会很快迷路。更准确的理解方式是：

1. 前端是一个高度状态化的实时应用。
2. 后端是一个以 FastAPI 为核心、同时承担业务编排、AI 调度和实时广播的服务层。
3. 项目里有大量 D&D 规则数据和生成资产，不只是 UI 与 API 代码。

## 2. 顶层目录

| 路径 | 作用 |
| --- | --- |
| `backend/` | FastAPI 后端、数据库模型、服务层、Alembic、测试 |
| `frontend/` | React Router 前端、地图/角色/聊天/法术等 UI |
| `docs/` | 设计文档、专题分析、部署文档、历史实现说明 |
| `dnd-platform/` | 模组配置、上传内容、资源文件、解析产物 |
| `debug/` | 调试脚本、零散测试脚本、Playwright 调试用 spec |
| `logs/` | `dev-start.sh` 产生的前后端日志 |
| `scripts/` | 辅助脚本、数据修复脚本 |
| `dev-start.sh` | 一键启动前后端并写日志 |

这个仓库除了应用代码，还包含：

- 前端规则 JSON 数据
- OCR/模组解析中间产物
- 图片、音乐、地图和角色素材
- 大量设计文档和历史分析文档

因此目录体量会显著大于一般业务项目。

## 3. 当前技术栈

### 3.1 前端

当前前端核心栈如下：

- React 18
- React Router 7
- TypeScript
- Radix UI / Radix Themes
- Tailwind CSS
- TanStack React Query
- Zustand
- Konva / react-konva
- TipTap
- LiveKit Client
- Vite
- Vitest

源码入口：
- `frontend/app/root.tsx`
- `frontend/app/routes/`
- `frontend/app/components/`

### 3.2 后端

当前后端核心栈如下：

- FastAPI
- SQLAlchemy 2.0 Async
- PostgreSQL
- Redis
- Alembic
- Pydantic / pydantic-settings
- WebSocket
- httpx / aiohttp
- OpenAI 兼容 AI API
- pydantic-ai
- LiveKit token 生成

源码入口：
- `backend/app/main.py`
- `backend/app/api/routes/`
- `backend/app/services/`

### 3.3 数据与资源层

项目还有三块很重要的“半代码”层：

- `frontend/app/data/rules/`
  - 本地规则 JSON，前端很多角色、法术、职业逻辑依赖这里
- `dnd-platform/`
  - 模组上传目录、解析结果目录、平台资源
- `docs/`
  - 历史设计与实现说明，很多信息有价值，但不一定和当前源码完全同步

## 4. 架构总览

可以把当前系统理解为下面几层：

1. 前端页面层
   - 首页、登录页、DM 界面、玩家界面、模组页、法术页、配置页
2. 前端组件与状态层
   - 地图、角色卡、聊天、法术面板、交易、浮窗、音频、缓存、WebSocket hook
3. 后端 API 层
   - 战役、角色、地图、战斗、模组、AI、语音、资源、权限
4. 后端服务层
   - 规则组装、角色生成、法术解析、模组 OCR/解析、AI 调用、嵌入索引、WebSocket handler
5. 数据层
   - PostgreSQL 持久化业务状态
   - Redis 缓存
   - OSS / 外部对象存储保存图片与资源
6. 外部平台层
   - Resterlab 用户认证
   - OpenAI 兼容模型服务
   - Mistral OCR / Doc2X / Dashscope / LiveKit

## 5. 前端源码导览

### 5.1 前端入口与全局行为

`frontend/app/root.tsx` 是全局入口，里面做了几件关键事：

- 注册 Radix Theme
- 初始化 React Query `QueryClient`
- 安装 `fetch` 拦截器
- 初始化国际化字典
- 注册 Service Worker
- 根据本地 token 做路由保护
- 在首页和登录页显示全局音乐播放器
- 持久化最近一次战役路由，用于 PWA 恢复

这里可以看出前端不是传统 SSR-only 页面，而是明显偏客户端应用：

- 本地存储依赖较多
- 会主动 patch `window.fetch`
- 会维护 WebSocket、音频和 PWA 行为

### 5.2 前端主要路由

当前 `frontend/app/routes/` 的核心页面如下：

| 路由 | 文件 | 作用 |
| --- | --- | --- |
| `/` | `frontend/app/routes/_index.tsx` | 战役大厅、模板预览、进入/创建战役 |
| `/login` | `frontend/app/routes/login.tsx` | 登录页 |
| `/campaign/:id/dm` | `frontend/app/routes/campaign.$id.dm.tsx` | DM 控制台 |
| `/campaign/:id/player` | `frontend/app/routes/campaign.$id.player.tsx` | 玩家视图 |
| `/campaign/:id/storage` | `frontend/app/routes/campaign.$id.storage.tsx` | 战役存储相关页面 |
| `/modules` | `frontend/app/routes/modules.tsx` | 原始模组与解析模组管理 |
| `/spells` | `frontend/app/routes/spells.tsx` | 法术大全 |
| `/character` | `frontend/app/routes/character.tsx` | 角色页面 |
| `/api-settings` | `frontend/app/routes/api-settings.tsx` | AI / 语音模型配置页 |
| `/api-usage` | `frontend/app/routes/api-usage.tsx` | 用量/配置相关页面 |
| `test-*` | 多个 `test-*.tsx` | 前端联调或开发阶段测试页面 |

其中最重要的两个页面是：

- `campaign.$id.dm.tsx`
- `campaign.$id.player.tsx`

这两个文件当前都非常大：

- `campaign.$id.dm.tsx` 约 3215 行
- `campaign.$id.player.tsx` 约 3793 行

它们本质上承担了“战役壳层容器”的角色，把地图、聊天、角色、语音、音乐、战斗、法术和各种弹窗全部拼装起来。

### 5.3 前端组件分区

`frontend/app/components/` 基本按照业务域拆分，主要有：

- `campaign/`
  - 战役头部、创建战役、资源库、地图管理、时间设置、语音面板、商店/箱子/模板等
- `map/`
  - TacticalMap、图层、迷雾、地形、标记、覆盖层、上下文菜单、地图 hooks
- `character/`
  - 角色展示、创建向导、升级、装备、法术、职业特性、状态效果
- `combat/`
  - 战斗面板、先攻、反应、战斗摘要
- `spell/`
  - 法术卡片、选择器、施法动作、统一施法对话框
- `chat/`
  - 浮动聊天窗、筛选面板、未读提示
- `hotbar/`
  - 快捷栏、能力/法术确认弹窗
- `trade/`
  - 玩家交易
- `ui/`
  - 聊天面板、规则面板、通知、工具栏、LaTeX 渲染、通用对话框

这套组件结构说明前端业务已经非常细：

- 不只是“地图 + 聊天”
- 还包含音效、资源消耗、交易流程、施法阶段、职业能力面板、规则查询等细颗粒交互

### 5.4 地图系统

地图是前端最重的子系统。

关键文件：

- `frontend/app/components/map/TacticalMap.tsx`
- `frontend/app/components/map/TacticalMap.client.tsx`
- `frontend/app/components/map/hooks/useMapData.ts`
- `frontend/app/components/map/hooks/useMapWebSocket.ts`
- `frontend/app/components/map/hooks/useMapEvents.ts`
- `frontend/app/components/map/hooks/useMapState.ts`

当前结构特征：

- `TacticalMap.tsx` 本身是一个轻包装，延迟加载客户端地图组件
- 真正的核心逻辑集中在 `TacticalMap.client.tsx`
- `TacticalMap.client.tsx` 当前约 15593 行，是整个前端最重的热点之一
- 地图又通过 hooks 拆出数据加载、WebSocket、事件处理、状态管理等子层

地图系统承担的能力包括：

- 地图图片加载
- Token 放置、移动、删除
- HP、临时 HP、状态效果、光环、阵营
- 绘图、测距、迷雾、地形
- 地图标记、AI 标记
- 法术范围、伤害数字、夜晚/照明/遮蔽覆盖层
- 角色快捷栏瞄准
- 地图视口状态同步

一个很重要的实现点是 `useMapData.ts`：

- 初始加载优先走 `/api/campaigns/{id}/map-bulk-data`
- 用一次请求替代多次并发请求
- 加载完以后在前端补全 token 对应角色的 HP 派生值
- 对部分默认 HP 做后台持久化

这说明地图初始化阶段已经做了明显的性能优化。

### 5.5 前端实时通信

前端实时通信有两层：

#### 全局连接层

关键文件：
- `frontend/app/hooks/useWebSocket.ts`

特点：
- 共享连接池 `sharedConnections`
- 以 `campaignId:userId:role` 为 key 复用连接
- 统一消息格式 `{ type, data }`
- 自动重连、心跳、延迟测量
- 多订阅者复用单条连接

#### 地图消息分发层

关键文件：
- `frontend/app/components/map/hooks/useMapWebSocket.ts`

特点：
- 根据 `message.type` 分发 token、HP、状态、迷雾、地形、绘图、战斗结果等消息
- 通过 DOM CustomEvent 继续向角色面板、伤害浮字、死亡豁免 UI 等模块广播
- 负责把后端消息折叠成 React 状态更新

换句话说：

- `useWebSocket.ts` 负责“连上”
- `useMapWebSocket.ts` 负责“懂消息”

### 5.6 前端状态管理

前端状态管理并不是单一方案，而是组合式的：

- React 本地 state
- React Query 远程数据缓存
- Zustand 全局 store
- 各种 `*Cache.ts` 工具做短期缓存
- `localStorage` / `sessionStorage` 做持久化

当前 store 主要包括：

- `voiceStore.ts`
- `campaignMusicStore.ts`
- `onlineStore.ts`
- `tradeStore.ts`
- `floatingTokenPanelStore.ts`
- `floatingFilterPanelStore.ts`
- `moduleStore.ts`

当前 utils 里还能看到很多“专门缓存”：

- `characterCache.ts`
- `campaignMembersCache.ts`
- `combatStateCache.ts`
- `mapTokensCache.ts`
- `moduleMapsCache.ts`
- `characterResourcesCache.ts`

这类缓存说明前端在大页面里非常依赖“多块状态局部刷新”，而不是每次整页重取。

### 5.7 规则数据与本地 JSON

`frontend/app/data/rules/` 是非常关键的数据目录。

当前这里保存了大量规则与结构化资源：

- 种族、职业、背景、技能
- 法术、法术位、职业资源
- 装备、魔法物品
- 专长、条件、疾病、毒药
- 众神、位面、世界观、NPC 模板

目录中的 README 明确写了一个原则：

- 这里应该是前端规则数据的单一真相源
- 通过动态 import 读取
- 尽量不要再从 `public/` 拿重复副本

这对理解角色系统很重要，因为很多角色派生逻辑不是只靠后端 API，而是“前端规则 JSON + 角色状态 + 运行时计算”共同完成。

### 5.8 前端的维护热点

当前最重的几个热点文件是：

- `frontend/app/components/map/TacticalMap.client.tsx`
- `frontend/app/routes/campaign.$id.dm.tsx`
- `frontend/app/routes/campaign.$id.player.tsx`

如果要做后续重构，通常会从这几类方向开始：

- 把页面容器进一步拆成业务片段
- 把地图状态从超大组件继续下沉到 hooks / domain modules
- 把角色、法术、快捷栏的事件链拆成更独立的子系统

## 6. 后端源码导览

### 6.1 后端入口

`backend/app/main.py` 是应用入口，主要负责：

- 创建 FastAPI 应用
- 配置 CORS
- 注册 Trailing Slash Middleware
- 在 lifespan 中初始化数据库与 Redis
- `Base.metadata.create_all`
- 注册全部 HTTP 与 WebSocket 路由

这里有一个实际需要注意的点：

- 应用启动时会执行 `Base.metadata.create_all`
- 但仓库同时也使用 Alembic 作为迁移体系

这意味着当前项目是“迁移驱动 + 启动时兜底建表”并存，不是最严格的纯 Alembic 模式。

### 6.2 配置与安全

关键文件：

- `backend/app/core/config.py`
- `backend/app/core/security.py`
- `backend/app/db/session.py`
- `backend/app/db/redis.py`

配置层主要提供：

- `DATABASE_URL`
- `REDIS_URL`
- `RESTERLAB_DATABASE_URL`
- OpenAI 兼容 AI 服务 URL / KEY
- Doc2X / Mistral / OSS 配置
- LiveKit 配置
- CORS 列表

安全层主要提供：

- JWT 创建和校验
- `require_auth`
- Bearer Token 用户提取

认证方案不是自建账号密码系统，而是：

1. 登录时走 `Resterlab` 外部认证
2. 在本地 `users` 表里创建/同步平台用户
3. 返回平台自己的 JWT
4. 前端把 token 和用户信息放进 `localStorage`

### 6.3 后端路由分区

后端路由文件很多，最容易理解的方式是按业务域分组：

#### 战役与成员

核心文件：

- `backend/app/api/routes/campaigns.py`
- `backend/app/api/routes/campaign_storage.py`
- `backend/app/api/routes/campaign_templates.py`
- `backend/app/api/routes/quest_progress.py`

主要能力：

- 创建/更新/删除战役
- 战役成员、加入、虚拟玩家
- 当前地图与模块选择
- 玩家笔记、侧边栏状态
- 战役模板与模板克隆
- 战役对象存储与 ACL
- 任务/剧情进度

#### 角色与成长

核心文件：

- `backend/app/api/routes/characters.py`
- `backend/app/api/routes/character_drafts.py`
- `backend/app/api/routes/races.py`

主要能力：

- 角色创建、导入、读取、更新、删除
- 描述生成角色、高等级 DM 角色生成
- 角色头像与装备头像
- 升级、降级、重置到 1 级
- 休息、资源消耗/恢复
- 法术准备
- 多种职业特性行动
- 角色草稿保存

`characters.py` 当前约 7012 行，是后端最重的业务文件之一，几乎已经承载了一个独立子系统。

#### 地图与战斗态

核心文件：

- `backend/app/api/routes/tokens.py`
- `backend/app/api/routes/map_settings.py`
- `backend/app/api/routes/map_view_state.py`
- `backend/app/api/routes/fog_of_war.py`
- `backend/app/api/routes/map_terrain.py`
- `backend/app/api/routes/rulers.py`
- `backend/app/api/routes/drawings.py`
- `backend/app/api/routes/map_markers.py`
- `backend/app/api/routes/ai_map_markers.py`
- `backend/app/api/routes/map_bulk_data.py`
- `backend/app/api/routes/module_maps.py`

主要能力：

- Token CRUD、位置、尺寸、HP、状态、光环、阵营
- 专注法术、施法中状态、变形、伪装、幻象图
- 视口位置保存
- 迷雾、地形、绘图、测距、地图标记
- 地图批量初始加载
- 冒险模组地图与战役地图绑定

#### 战斗与法术

核心文件：

- `backend/app/api/routes/combat.py`
- `backend/app/api/routes/spell_cast.py`

主要能力：

- 攻击、反应、叙事生成
- 额外效果
- 豁免、能力检定、对抗检定
- 法术结算、区域法术、持续区域结算
- ongoing save / condition save / escape attempt
- death save
- 长施法 / ritual casting
- 幻术图像生成与幻术库

`combat.py` 当前约 7967 行，是另一个重要超级热点文件。

#### 实体与资源

核心文件：

- `backend/app/api/routes/items.py`
- `backend/app/api/routes/shops.py`
- `backend/app/api/routes/chests.py`
- `backend/app/api/routes/monster_instances.py`
- `backend/app/api/routes/monster_avatars.py`
- `backend/app/api/routes/cover_library.py`
- `backend/app/api/routes/map_library.py`

主要能力：

- 物品 CRUD、AI 导入、自定义解析、从模组导入
- 商店、库存、买卖
- 箱子、陷阱、开锁、拆陷阱、搜刮
- 怪物实例、召唤物、NPC 快速生成、转箱子
- 怪物头像库
- 封面图与地图图库

#### 模组、解析与知识库

核心文件：

- `backend/app/api/routes/modules.py`
- `backend/app/api/routes/module_chat.py`
- `backend/app/api/routes/module_chat_sessions.py`
- `backend/app/api/routes/module_notes.py`
- `backend/app/api/routes/custom_modules.py`
- `backend/app/api/routes/chapter_agent.py`
- `backend/app/api/routes/rules_chat.py`
- `backend/app/api/routes/rules_embedding.py`
- `backend/app/api/routes/resource_chat.py`

主要能力：

- PDF / Markdown / ZIP 上传
- 模组解析任务与 WebSocket 进度
- 解析结果查看、翻译、嵌入、导出、共享、复制
- 模组问答、多会话、实体识别、地图生成
- 自定义模组编辑
- 章节 Agent
- 规则库索引与检索
- 资源问答，并从对话直接生成遭遇、商店、物品、箱子、场景

#### AI 与系统配置

核心文件：

- `backend/app/api/routes/ai_settings.py`
- `backend/app/api/routes/ai_sessions.py`
- `backend/app/api/routes/optimization.py`

主要能力：

- 模型配置、连通性测试、模型测试
- 角色背景、外观、性格、头像等 AI 生成
- DC 生成、检定分析
- 怪物/物品结构化解析
- 各类 usage-config 的统一配置
- 战役级 AI 会话
- 代码优化/性能指标相关实验接口

#### 用户、认证、语音

核心文件：

- `backend/app/api/routes/auth.py`
- `backend/app/api/routes/users.py`
- `backend/app/api/routes/voice.py`

主要能力：

- 登录、获取当前用户
- 用户偏好设置
- LiveKit 语音 token
- 语音转文字
- 可用音色查询
- TTS 合成与流式合成

### 6.4 WebSocket 架构

当前 WebSocket 已经不是早期那种“一个超大 if/else 文件”，而是做了 registry 化。

关键文件：

- `backend/app/api/routes/websocket_simplified.py`
- `backend/app/services/websocket_manager.py`
- `backend/app/services/websocket_handlers/registry.py`
- `backend/app/services/websocket_handlers/*.py`

当前结构如下：

1. `websocket_simplified.py`
   - 提供 `/ws/{campaign_id}`
   - 做 campaign 存在性校验
   - 维护心跳 ping/pong
   - 读取消息并交给 registry
2. `ConnectionManager`
   - 以 `campaign_id -> set[WebSocket]` 维护连接
   - 保存每条连接的 `user_id` / `role`
   - 支持 campaign 广播、按角色广播、按用户定向广播
3. `HandlerRegistry`
   - 根据 `message.type` 找具体 handler
4. 各 handler
   - `chat_handler`
   - `map_handler`
   - `fog_handler`
   - `drawing_handler`
   - `dice_handler`
   - `trade_handler`
   - `voice_handler`
   - `time_handler`
   - `terrain_handler`
   - `music_handler`
   - 等等

后端统一规范了消息格式：

```json
{
  "type": "token_move",
  "data": {
    "token_id": 123,
    "position": { "x": 10, "y": 12 }
  }
}
```

这一点和前端 `useWebSocket.ts` 的 canonical message 格式是对应的。

### 6.5 后端模型层

模型数量很多，但可以按核心实体理解。

#### 用户与战役

核心表：

- `users`
- `campaigns`
- `campaign_members`
- `campaign_storage`
- `campaign_storage_acl`
- `campaign_templates`

这里承载：

- 用户身份
- 战役元数据
- 成员角色
- 战役对象存储
- 模板体系

#### 角色与战斗对象

核心表：

- `characters`
- `tokens`
- `monster_instances`
- `monster_avatars`
- `reward_history`

其中 `characters` 非常重，包含：

- 基础资料
- 外观、背景、性格
- 属性、熟练、专精
- 法术、法术位、准备法术
- 资源池、状态效果、快捷栏
- 装备、货币
- XP、里程碑等级、多职业、等级历史
- 专长与选项

`tokens` 也非常关键，它不是单一角色 token，而是一个多态承载体，可以代表：

- 角色
- 怪物实例
- 物品
- 商店
- 掉落袋
- 箱子

并额外维护：

- 地图位置
- HP / 临时 HP
- 死亡豁免
- Active effects
- Active auras
- Transformation data
- Concentration spell
- Casting in progress
- Disguise / illusion 数据

#### 地图状态

核心表：

- `map_settings`
- `map_view_state`
- `fog_of_war`
- `map_terrain`
- `drawings`
- `rulers`
- `map_markers`
- `ai_map_markers`
- `module_maps`

这些表共同组成地图的“持久化战术层”。

#### 模组与知识库

核心表：

- `raw_module_files`
- `parsed_modules`
- `module_parse_tasks`
- `custom_modules`
- `module_embeddings`
- `module_chat_messages`
- `module_chat_sessions`
- `module_notes`
- `rules_embeddings`
- `rules_chat_messages`
- `resource_chat_messages`

这里不仅保存模组正文，还保存：

- OCR/解析结果
- AI 会话记录
- 嵌入状态
- 笔记
- 问答历史

#### 资源与场景对象

核心表：

- `items`
- `shops`
- `shop_inventory`
- `chests`
- `chest_inventory`
- `user_maps`
- `user_avatars`
- `user_covers`

### 6.6 服务层

服务层是后端真正的“复杂度承载区”。

当前可以大致分为以下几类：

#### AI / 模型访问

- `ai_model_service.py`
- `ai_service.py`
- `json_format_agent.py`
- `translation_service.py`

职责：

- 根据 usage 查配置
- 调 OpenAI 兼容 chat/completions
- 处理流式输出
- 工具调用
- 严格 JSON 输出
- 翻译与格式恢复

其中 `ai_service.py` 里还能看到针对 `gpt-5` 这类模型对采样参数的特殊处理。

#### 角色 / 规则 / 法术

- `character_generator.py`
- `dm_character_generator.py`
- `character_import_service.py`
- `character_post_creation_service.py`
- `character_sheet_service.py`
- `character_rule_registry.py`
- `class_resource_service.py`
- `spell_resolver.py`
- `effect_service.py`
- `immunity_service.py`
- `passive_feature_service.py`

职责：

- 角色生成与导入
- 角色派生属性计算
- 职业资源
- 法术解析与目标结算
- 效果判定
- 免疫/抗性处理
- 被动特性修正

#### 模组 / OCR / 结构化

- `mistral_ocr_service.py`
- `doc2x_service.py`
- `module_parsing_service.py`
- `module_file_manager.py`
- `module_image_classifier.py`
- `monster_item_extractor.py`
- `monster_parser_service.py`
- `magic_item_parser.py`
- `module_embedding_service.py`
- `chapter_splitter.py`
- `chapter_agent/*`

职责：

- OCR
- 图片分类
- 章节拆分
- 怪物/物品抽取
- 模组嵌入
- 模组 Agent 化问答和工具链

#### 地图 / 资源 / 生成

- `map_generation_service.py`
- `avatar_service.py`
- `campaign_template_service.py`
- `entity_creation_service.py`
- `campaign_rule_assembler.py`

职责：

- AI 地图生成
- 头像生成
- 模板复制与应用
- 从对话生成实体
- 根据战役拼装角色创建可选项

#### WebSocket

- `websocket_manager.py`
- `websocket_handlers/*`

这部分已经形成了“连接管理 + handler 注册表 + 业务 handler”的比较清晰结构。

### 6.7 模组解析流水线

模组解析是后端另一个值得单独理解的子系统。

关键文件：

- `backend/app/api/routes/modules.py`
- `backend/app/domain/parsing/pipeline.py`
- `backend/app/domain/parsing/toc_extractor.py`
- `backend/app/domain/parsing/oss_storage.py`

根据 `pipeline.py`，当前真实流程大体是：

1. 上传原始文件（PDF / Markdown / ZIP）
2. OCR 转 Markdown
3. 抽取图片与表格
4. 图片上传 OSS
5. 按需做图片分类
6. TOC 提取与重组
7. 关联图片/表格与章节
8. 抽取怪物与物品
9. 入库生成 `ParsedModule`

这套流程还支持：

- 解析进度回调
- 取消令牌
- 任务状态持久化
- WebSocket 进度推送

也就是说，它更像一个小型异步工作流，而不是单个同步接口。

## 7. 关键运行流程

### 7.1 登录流程

前端：
- `frontend/app/routes/login.tsx`
- `frontend/app/utils/auth.ts`
- `frontend/app/utils/api-client.ts`

后端：
- `backend/app/api/routes/auth.py`
- `backend/app/core/security.py`
- `backend/app/services/resterlab_auth.py`

流程：

1. 用户在登录页输入邮箱和密码
2. 前端请求 `POST /api/auth/login`
3. 后端通过 `Resterlab` 校验
4. 若本地 `users` 不存在则创建
5. 后端签发 JWT
6. 前端把 token 与 user 存入 `localStorage`
7. 后续 API 通过 `api-client.ts` 自动注入 `Authorization` 和 `X-User-ID`

### 7.2 进入战役流程

前端首页 `/_index.tsx` 会：

- 拉取战役列表
- 检查当前用户是否为战役成员
- 支持加入战役
- 跳转到 DM 或 Player 页面

进入战役页面后，容器页会同时拉起：

- Campaign 基础数据
- 地图 bulk 数据
- WebSocket
- 聊天
- 角色/队伍信息
- 语音 / 音乐 / 侧边栏状态

### 7.3 地图初始化流程

主要路径：

1. 选择当前地图 URL
2. `useMapData.ts` 加载背景图
3. 调用 `/api/campaigns/{campaignId}/map-bulk-data`
4. 一次性拿到 token / fog / terrain / rulers / drawings / markers / map_settings / view_state
5. 前端再根据角色数据补全某些 token 的派生 HP
6. 建立 WebSocket 实时同步后续变动

这是当前地图页性能设计里最重要的一条链路。

### 7.4 战斗 / 法术流程

战斗不完全依赖 WebSocket，而是：

- 复杂结算通常先走 HTTP
- 结果再通过 WebSocket 广播到同战役其他客户端

典型例子：

- 攻击、豁免、对抗、法术结算由 `combat.py` / `spell_cast.py` 完成
- Token HP、状态、专注、施法中状态由 API 改写数据库
- 后端再广播 `token_hp_update`、`token_active_effects_update` 等消息
- 前端地图和角色面板一起消费这些消息

这也是为什么这个项目里 HTTP 和 WebSocket 是强耦合共存，而不是二选一。

### 7.5 模组解析流程

典型路径：

1. 前端 `/modules` 上传原始文件
2. 后端写入 `raw_module_files`
3. 通过任务和 WebSocket 跟踪解析进度
4. 解析完成后生成 `parsed_modules`
5. 前端支持查看章节、怪物、物品、图片、表格
6. 后续还能继续做翻译、嵌入、分享、复制、AI 辅助地图生成

### 7.6 语音流程

语音系统分成三块：

1. 实时房间
   - `POST /api/voice/token/{campaign_id}`
   - 用 LiveKit token 进入战役语音房
2. 语音转文字
   - `POST /api/voice/transcribe`
   - 根据模型类型选择 Whisper 风格接口或多模态 chat 接口
3. 文字转语音
   - `GET /api/voice/available-voices`
   - `POST /api/voice/synthesize`
   - `POST /api/voice/synthesize-stream`

同时 WebSocket 里还有 `voice_join` / `voice_leave` 来同步战役内在线语音成员状态。

## 8. 本地开发与运行

### 8.1 后端

```bash
cd backend
python -m venv venv
source venv/bin/activate
pip install -r requirements.txt
alembic upgrade head
uvicorn app.main:app --reload --port 8174
```

关键依赖：

- PostgreSQL
- Redis
- `.env` 配置

### 8.2 前端

```bash
cd frontend
npm install
npm run dev
```

默认本地端口：

- 前端 `5174`
- 后端 `8174`

### 8.3 一键启动

仓库根目录提供：

```bash
./dev-start.sh
```

它会：

- 启动后端
- 启动前端
- 输出彩色日志
- 把日志写入 `logs/backend.log` 和 `logs/frontend.log`

### 8.4 关键环境变量

至少要关注这些：

- `DATABASE_URL`
- `REDIS_URL`
- `RESTERLAB_DATABASE_URL`
- `DEFAULT_AI_API_URL`
- `DEFAULT_AI_API_KEY`
- `DOC2X_API_KEY`
- `MISTRAL_API_KEY`
- `OSS_ACCESS_KEY_ID`
- `OSS_ACCESS_KEY_SECRET`
- `OSS_BUCKET_NAME`
- `LIVEKIT_API_KEY`
- `LIVEKIT_API_SECRET`
- `LIVEKIT_URL`
- `VITE_API_URL`
- `VITE_WS_URL`

生产环境里建议显式覆盖配置文件中的默认值，尤其是语音和 JWT 相关配置。

## 9. 测试与质量现状

当前测试主要分三类：

### 9.1 后端 pytest

目录：
- `backend/tests/`

覆盖内容包括：

- 认证 API
- 战役删除级联
- Campaign storage
- 角色 API
- 对抗检定
- 控制效果逃脱
- 火球术 / 驱散魔法等法术逻辑
- 免疫服务
- 头像与物品相关接口
- 模组解析器
- 一些 unit tests，例如：
  - `test_campaign_rule_assembly.py`
  - `test_item_payload_normalizer.py`
  - `test_thunderbolt_strike.py`

### 9.2 前端类型检查

命令：

```bash
cd frontend
npm run typecheck
```

### 9.3 Playwright / 调试 spec

当前 `playwright.config.ts` 指向：

- `debug/*.spec.ts`

仓库规范和旧文档里有时会写 `frontend/tests`，但当前根配置实际更偏向使用 `debug/` 里的调试/回归 spec。

## 10. 当前维护视角下的几个事实

如果后续你要继续演进这个项目，下面这些判断很重要。

### 10.1 当前代码已经明显超出“小项目”规模

表现为：

- 业务域很多
- 超大文件很多
- HTTP + WebSocket + AI + 本地规则数据同时并存
- 前端和后端都存在多个“准子系统”

### 10.2 文档与源码存在漂移

当前比较明显的漂移包括：

- 前端实际依赖更接近 React Router 7，而不是旧文档中的 Remix 表述
- Playwright 实际配置和部分说明文档不完全一致
- 旧分析文档提到的一些文件大小和结构已经不是当前版本

所以后续开发时，建议优先信任源码和本文件，再回头参考专题设计文档。

### 10.3 当前最大的维护热点不是“功能缺失”，而是复杂度管理

最值得持续治理的区域：

- 地图主组件
- DM / 玩家战役页面
- 角色与战斗大文件
- AI 与规则数据的边界
- 大量局部缓存和事件广播链

### 10.4 这个项目已经形成了几条明确的主干能力

最成熟的主干包括：

- 战役大厅与成员体系
- 角色与地图协同
- Token 战斗状态流转
- 模组解析和结构化
- AI 辅助资源生成
- 语音和音乐体验增强

## 11. 阅读源码的推荐顺序

如果你是第一次接手，建议按下面顺序读：

1. `frontend/app/root.tsx`
2. `frontend/app/routes/_index.tsx`
3. `frontend/app/routes/campaign.$id.dm.tsx`
4. `frontend/app/components/map/TacticalMap.tsx`
5. `frontend/app/components/map/hooks/useMapData.ts`
6. `frontend/app/components/map/hooks/useMapWebSocket.ts`
7. `backend/app/main.py`
8. `backend/app/api/routes/campaigns.py`
9. `backend/app/api/routes/characters.py`
10. `backend/app/api/routes/tokens.py`
11. `backend/app/api/routes/combat.py`
12. `backend/app/api/routes/websocket_simplified.py`
13. `backend/app/services/websocket_manager.py`
14. `backend/app/api/routes/modules.py`
15. `backend/app/domain/parsing/pipeline.py`

按这个顺序读，能先抓住“页面 -> 地图 -> API -> 实时 -> 模组”的主骨架，再去看职业特性、法术细节和 AI 子系统。

## 12. 相关文档推荐

如果你已经看完这份总览，下一步建议继续看：

- `docs/ONBOARDING_30_MIN.md`
- `docs/PROJECT_FRONTEND_GUIDE.md`
- `docs/PROJECT_BACKEND_GUIDE.md`
- `docs/PROJECT_DATA_MODEL_GUIDE.md`
- `docs/architecture/ARCHITECTURE_REVIEW_2026.md`
- `docs/architecture/REFACTORING_ROADMAP_2026.md`
- `docs/ARCHITECTURE_ANALYSIS.md`
- `docs/DEEP_DIVE_IMPLEMENTATION.md`
- `docs/CODEBASE_ANALYSIS_INDEX.md`
- `docs/MOD_SYSTEM_DESIGN.md`
- `docs/REALTIME_CHARACTER_SYNC.md`
- `docs/SPELL_SYSTEM_DESIGN_FRONTEND.md`
- `docs/XP_AND_CURRENCY_REWARD_SYSTEM_DESIGN.md`
- `docs/deployment/DEPLOYMENT_GUIDE.md`

这些文档更适合专题深入；而本文档更适合作为入口。
