# 项目后端篇

本文档聚焦 `backend/app/`，用于解释当前后端的入口、配置、安全、路由分区、服务层、WebSocket 体系、AI 与模组解析架构，以及接手时最该优先认识的热点区域。

配套文档：

- 总览：`docs/PROJECT_OVERVIEW.md`
- 新同事上手：`docs/ONBOARDING_30_MIN.md`
- 前端篇：`docs/PROJECT_FRONTEND_GUIDE.md`
- 数据模型篇：`docs/PROJECT_DATA_MODEL_GUIDE.md`

## 1. 后端定位

当前后端不是单一 REST API 服务，而是同时承担了：

- 常规 HTTP API
- 战役实时 WebSocket 通信
- 角色、战斗、法术等复杂业务逻辑
- 模组 OCR / 结构化解析
- AI 模型配置与调用
- 规则索引与向量检索
- 语音服务接入

可以把它理解为：

- 一个 FastAPI 应用
- 一个战役实时状态中枢
- 一个 AI 编排层
- 一个模组处理后端

## 2. 应用入口与生命周期

入口文件：

- `backend/app/main.py`

主要职责：

- 创建 FastAPI app
- 配置 CORS
- 挂 Trailing Slash Middleware
- 在 lifespan 中初始化数据库和 Redis
- 调 `Base.metadata.create_all`
- 注册所有 HTTP / WebSocket 路由

当前生命周期上有一个需要记住的事实：

- 仓库使用 Alembic 做迁移
- 但应用启动时又会做 `create_all`

这意味着当前是“迁移为主、启动兜底”的模式，而不是最严格的纯迁移式启动。

## 3. 配置、鉴权与数据库

关键文件：

- `backend/app/core/config.py`
- `backend/app/core/security.py`
- `backend/app/db/session.py`
- `backend/app/db/redis.py`

### 3.1 配置来源

`config.py` 提供：

- API host / port
- `DATABASE_URL`
- `REDIS_URL`
- `RESTERLAB_DATABASE_URL`
- AI 服务默认配置
- OCR / OSS / LiveKit 相关配置
- CORS 允许列表

重点注意：

- `settings = Settings()` 在 import 时就会读取环境变量
- 所以后端很多脚本和测试会被 `.env` 是否齐全直接影响

### 3.2 鉴权方式

当前鉴权并不是本地用户名密码。

流程是：

1. `POST /api/auth/login`
2. 后端调用 `resterlab_auth`
3. 用户通过外部系统认证
4. 本地 `users` 表做同步/补充
5. 后端签发 JWT
6. 后续请求通过 `require_auth` 校验

关键文件：

- `backend/app/api/routes/auth.py`
- `backend/app/services/resterlab_auth.py`
- `backend/app/core/security.py`

### 3.3 数据库 session 模式

`db/session.py` 当前采用：

- `create_async_engine`
- `async_sessionmaker`
- `get_db()` 依赖注入

`get_db()` 的特点是：

- `yield` session
- 正常结束后自动 commit
- 异常时 rollback

因此写 route / service 时要有这个上下文：

- 有些 route 里会显式 `await db.commit()`
- 但依赖本身也会在请求结束时 commit 一次

## 4. 路由层怎么读

后端最重要的入口都在：

- `backend/app/api/routes/`

与其按文件一个个背，不如按业务域理解。

## 5. 战役与成员域

核心文件：

- `campaigns.py`
- `campaign_storage.py`
- `campaign_templates.py`
- `quest_progress.py`

主要职责：

- 战役 CRUD
- 战役成员管理
- 虚拟玩家
- 当前地图与当前模块
- 战役对象存储
- 模板生成与克隆
- 剧情/任务进度

需要特别记住的点：

- `campaigns.py` 不只是最基础的 CRUD
- 它还承担了很多战役元数据和 UI 状态相关接口

## 6. 角色与成长域

核心文件：

- `characters.py`
- `character_drafts.py`
- `races.py`

### 6.1 `characters.py` 的角色

这个文件当前是后端业务热点之一，里面覆盖：

- 创建、读取、更新、删除角色
- AI 生成角色
- 高等级角色生成
- 角色头像与装备头像
- 升级、降级、重置
- 休息逻辑
- 资源使用与恢复
- 法术准备
- 多种职业特性行动

如果某个需求牵扯：

- 角色当前状态
- 职业资源
- 法术位
- 休息恢复
- 等级变化

大概率都会经过这里。

### 6.2 角色相关服务

需要同时配合阅读：

- `character_generator.py`
- `character_import_service.py`
- `character_post_creation_service.py`
- `character_sheet_service.py`
- `character_rule_registry.py`
- `class_resource_service.py`
- `passive_feature_service.py`

这些 service 的存在说明：

- route 层已经很重
- 但核心规则逻辑也在逐步下沉

## 7. 地图与实时状态域

核心文件：

- `tokens.py`
- `map_settings.py`
- `map_view_state.py`
- `fog_of_war.py`
- `map_terrain.py`
- `drawings.py`
- `rulers.py`
- `map_markers.py`
- `ai_map_markers.py`
- `map_bulk_data.py`
- `module_maps.py`

这一域的职责是把战役地图变成一个持久化、可同步、可广播的“战术状态空间”。

### 7.1 `tokens.py`

这是地图域最关键的文件之一，负责：

- token 创建与删除
- 位置、尺寸、HP
- active effects
- aura
- 阵营
- 变形
- 专注法术
- 施法中状态
- 幻象 / 伪装图
- 掉落袋

它和 `combat.py`、`spell_cast.py`、前端地图消息是强耦合的。

### 7.2 `map_bulk_data.py`

这个接口虽然文件不大，但非常重要，因为它决定了前端地图初始化性能。

它会把下面这些一次性打包返回给前端：

- tokens
- fog
- terrain
- rulers
- drawings
- markers
- map_settings
- view_state

## 8. 战斗与法术域

核心文件：

- `combat.py`
- `spell_cast.py`
- `spell_resolver.py`
- `effect_service.py`
- `immunity_service.py`

### 8.1 `combat.py`

这是当前后端最大的业务文件之一，当前约 7967 行。

它覆盖：

- 攻击
- 反应
- 额外效果
- 豁免
- 能力检定
- 对抗检定
- 法术叙事
- 区域法术结算
- ongoing save / condition save / escape attempt
- death save

它还会配合：

- token 状态修改
- WebSocket 广播
- 法术解析
- 职业特性与种族特性的特殊判定

### 8.2 `spell_cast.py`

它更偏施法状态机，负责：

- 开始施法
- 长施法 / 仪式施法
- 立即完成施法
- 到点施法结算
- 幻术图像生成

### 8.3 `spell_resolver.py`

这是战斗和法术之间的重要桥梁，适合用来理解：

- 法术目标选择
- 法术上下文
- 效果如何从 spell data 进入战斗结算

## 9. 实体与资源域

核心文件：

- `items.py`
- `shops.py`
- `chests.py`
- `monster_instances.py`
- `monster_avatars.py`
- `map_library.py`
- `cover_library.py`

这块很容易被低估，但其实是平台战役资源体验的重要组成。

### 9.1 物品

`items.py` 支持：

- campaign 物品库
- AI 导入
- 自定义解析
- 从模组导入
- 头像生成

### 9.2 商店与箱子

`shops.py` 和 `chests.py` 不只是 CRUD，还包含：

- 库存
- 买卖与金币结算
- 开锁、拆陷阱、搜刮
- 头像生成

### 9.3 怪物实例

`monster_instances.py` 支持：

- campaign 内怪物实例化
- 召唤物 / 伙伴
- 快速 NPC 生成
- 自定义怪物解析
- 从模组导入
- 怪物转箱子

这块会同时连接：

- 地图 token
- 战斗系统
- 资源掉落

## 10. 模组、解析与知识库域

核心文件：

- `modules.py`
- `module_chat.py`
- `module_chat_sessions.py`
- `module_notes.py`
- `custom_modules.py`
- `chapter_agent.py`
- `rules_chat.py`
- `rules_embedding.py`
- `resource_chat.py`

### 10.1 `modules.py`

这是模组管理的总入口之一，负责：

- 原始文件上传
- parse 任务与 WebSocket
- 解析结果查看
- 共享、复制、导出
- 翻译、嵌入
- 章节 / 怪物 / 物品重提取

当前它已经不只是文件上传接口，而是一个模组工作台后端。

### 10.2 解析流水线

关键文件：

- `domain/parsing/pipeline.py`
- `services/mistral_ocr_service.py`
- `services/module_image_classifier.py`
- `services/monster_item_extractor.py`

典型流程：

1. 读原始文件
2. OCR
3. 图片上传 OSS
4. 图片分类
5. TOC 提取
6. 怪物 / 物品抽取
7. 结果入库

它还支持：

- 进度回调
- 取消
- 任务持久化
- 前端进度流

### 10.3 知识问答与 RAG

关键文件：

- `module_embedding_service.py`
- `rules_embedding_service.py`
- `module_chat.py`
- `rules_chat.py`
- `resource_chat.py`

当前做法不是简单全文搜索，而是：

- 文本切块
- embedding
- 相似度召回
- 可选 rerank
- 聊天型回答

`module_embedding_service.py` 已经体现出比较完整的检索流水线设计。

## 11. AI 模型配置与使用域

关键文件：

- `ai_settings.py`
- `ai_model_service.py`
- `ai_service.py`

### 11.1 模型配置

当前 AI 配置采用两层：

- `AIAPISettings`
- `AIModelConfig`

其中：

- 每个 `model_type` 对应一个具体模型配置
- `usage_configs` 决定某个业务用途应该走哪个模型类型

### 11.2 `ai_model_service.py`

这是 AI 路由选择的核心。

它维护了：

- `DEFAULT_USAGE_CONFIGS`
- `DEFAULT_USAGE_PARAMS`

也就是说，系统不是只区分“聊天模型 / 视觉模型”，而是会按业务用途选模型，比如：

- `module_chat_query`
- `module_refresh_toc`
- `dice_analyze`
- `combat_attack_narrative`
- `avatar_player`
- `map_generation`
- `chapter_agent`

这套 usage -> model_type -> config 的映射，是理解 AI 能力接入方式的关键。

### 11.3 `ai_service.py`

这是更底层的 OpenAI 兼容调用封装，支持：

- 普通 completion
- 流式 completion
- tools / function calling
- 模型列表获取
- 连接测试

并且已经对部分模型做了参数兼容性处理，比如：

- 对 `gpt-5` 类模型省略不兼容的采样参数

## 12. WebSocket 体系

关键文件：

- `api/routes/websocket_simplified.py`
- `services/websocket_manager.py`
- `services/websocket_handlers/registry.py`
- `services/websocket_handlers/*.py`

### 12.1 当前结构

现在的 WebSocket 入口已经是“薄入口 + handler registry”模式：

1. `websocket_simplified.py`
   - 校验 campaign
   - 建连接
   - 心跳 ping/pong
   - 接收消息
   - 调 registry.dispatch
2. `websocket_manager.py`
   - 保存 campaign -> connections
   - 广播给 campaign / role / 指定用户
3. `registry.py`
   - 按 `message.type` 选择 handler
4. 各个 handler
   - chat / map / fog / dice / trade / time / terrain / music / voice 等

### 12.2 为什么重要

这个结构决定了：

- 新增实时消息类型时，不一定要去改入口
- 可以在 handler 层做更细的职责分离
- 这是一个比“巨型 websocket.py”更健康的方向

## 13. 语音系统

关键文件：

- `api/routes/voice.py`

它包含三类能力：

1. `POST /api/voice/token/{campaign_id}`
   - 生成 LiveKit token
2. `POST /api/voice/transcribe`
   - 语音转文字
3. `POST /api/voice/synthesize` / `synthesize-stream`
   - 文字转语音

注意点：

- STT 模型和普通多模态模型的调用方式不同
- Dashscope 又有自己的一套兼容分支
- 语音这块不是只依赖 LiveKit，LiveKit 主要负责实时房间

## 14. 后端测试与验证

常用检查：

```bash
cd backend
pytest
```

重点测试目录：

- `backend/tests/`
- `backend/tests/unit/`

当前覆盖的主题包括：

- 认证
- 战役删除级联
- character API
- contest checks
- control effect
- spell logic
- immunity service
- parser / monster extraction
- item payload normalization

如果你改的是：

- 法术 / 战斗逻辑
- 角色资源恢复
- 解析器

优先去找有没有对应 pytest 可补。

## 15. 当前后端维护热点

最需要谨慎对待的区域：

- `api/routes/characters.py`
- `api/routes/combat.py`
- `api/routes/modules.py`
- `api/routes/module_chat.py`
- `api/routes/tokens.py`

这些区域的问题不在于“代码不好”，而在于：

- 历史积累深
- 业务耦合多
- 改一个地方容易影响多个子系统

## 16. 建议阅读顺序

建议按下面顺序读：

1. `backend/app/main.py`
2. `backend/app/core/config.py`
3. `backend/app/core/security.py`
4. `backend/app/db/session.py`
5. `backend/app/api/routes/campaigns.py`
6. `backend/app/api/routes/websocket_simplified.py`
7. `backend/app/services/websocket_manager.py`
8. `backend/app/api/routes/tokens.py`
9. `backend/app/api/routes/characters.py`
10. `backend/app/api/routes/combat.py`
11. `backend/app/api/routes/spell_cast.py`
12. `backend/app/api/routes/modules.py`
13. `backend/app/domain/parsing/pipeline.py`
14. `backend/app/services/ai_model_service.py`

这样读，你会先抓住应用骨架，再进入复杂业务域。
