# DND 5E 平台（Remix + FastAPI）项目总览

本文档面向开发者，帮助你快速理解项目结构、技术栈、运行方式、测试方法与常见问题。后端监听 8174 端口，前端监听 5174 端口。

## 1. 架构与技术栈

- 前端：Remix v2 + React 18 + TypeScript
  - 状态：Zustand（持久化 localStorage）
  - 数据：React Query
  - 画布：Konva.js（react-konva）
  - UI：Tailwind CSS + Radix UI
  - 构建：Vite
- 后端：FastAPI（ASGI）
  - DB：PostgreSQL（asyncpg + SQLAlchemy 2.0）
  - 缓存：Redis
  - 迁移：Alembic
  - 实时：WebSocket
  - 校验：Pydantic v2 + pydantic-settings
- AI 服务（OpenAI 兼容协议）：
  - CST Cloud（gpt-oss-120b、deepseek-r1）
  - Infini AI（gemini-2.5-flash、gpt-5）
  - Alibaba Qwen（图像生成）
  - Doc2X（PDF 解析）

## 2. 目录结构（顶层）

```
./
├── backend/            # FastAPI 后端（端口 8174）
├── frontend/           # Remix 前端（端口 5174）
├── docs/               # 文档（本文件）
├── debug/              # 调试与测试脚本/日志
├── dnd-platform/       # 资源/配置/样例模块上传目录
├── config/             # 额外配置
├── playwright.config.ts# Playwright E2E 配置（以 frontend dev 为 webServer）
└── package.json        # 顶层 Dev 依赖（Playwright）
```

常用子目录（示例）：
- backend/app/core/config.py：后端配置（环境变量、CORS、WS 心跳等）
- backend/app/main.py：FastAPI 入口（中间件、路由、lifespan、WS）
- frontend/app/config/api.ts：前端 API 基地址（VITE_API_URL 或默认 http://localhost:8174）
- frontend/app/components/canvas/：Konva 画布系统（Token、Fog of War、Ruler 等）

## 3. 启动与构建

### 后端（FastAPI）
```bash
cd backend
# 首次：创建并激活虚拟环境
python -m venv venv
source venv/bin/activate  # Windows: venv\Scripts\activate

# 安装依赖
pip install -r requirements.txt

# 数据库迁移（推荐始终走 Alembic）
./venv/bin/alembic upgrade head

# 启动（两种方式等价）
uvicorn app.main:app --reload --host 0.0.0.0 --port 8174
# 或
python -m uvicorn app.main:app --reload --port 8174
```
- API 文档：/docs（Swagger），/redoc（ReDoc）
- 健康检查：GET /health

### 前端（Remix）
```bash
cd frontend
npm install
npm run dev
# 本地访问 http://localhost:5174
```
- 生产构建：`npm run build`，服务：`npm start`

## 4. 环境变量

后端（backend/.env）：
- DATABASE_URL：PostgreSQL 连接串
- REDIS_URL：Redis 连接串
- DEFAULT_AI_API_URL / DEFAULT_AI_API_KEY：AI 默认配置
- DOC2X_API_KEY / DOC2X_API_URL：Doc2X 配置
- CORS_ORIGINS_RAW：可选（逗号或换行分隔）；不设置则使用默认白名单（含 5173~5183、3000、5174 等）

前端（frontend/.env）：
- VITE_API_URL：后端 API 地址（缺省为 http://localhost:8174）
- VITE_WS_URL：WebSocket 服务地址（如适用）

## 5. 关键模块与数据流

### 5.1 模组解析流水线（backend/app/domain/parsing/）
- toc_ai.py：目录结构解析
- content.py：章节内容提取
- monster.py：怪物属性与能力
- item.py：道具与装备
- map.py：地图元数据与资源链接
- orchestrator.py：编排、进度跟踪、错误恢复；支持规则与 AI 混合

流程：
1) 用户上传模块（PDF/Markdown）到 /api/modules/upload
2) 后端保存至 /dnd-platform/upload/{user_id}/
3) 触发 /api/modules/{module_id}/parse
4) 编排器执行各解析器，持续产出进度
5) 结果写入 /parsed/ 子目录（JSON）
6) 前端轮询 /api/modules/{module_id}/parse-status 获取状态

### 5.2 WebSocket（战役实时通信）
- 连接分组：按 campaign_id
- 消息类型：chat、map_update、token_move、dice_roll、drawing、fog_update
- 持久化：雾/地图位置等状态进库（如 map_view_state、fog_of_war、tokens、drawings 等表）
- 自动重连：前端处理网络波动

### 5.3 画布系统（frontend/app/components/canvas/）
- Token 放置/移动
- 工具：绘图/测距/选择
- 雾（Fog of War）：后端持久化
- 网格：战斗用栅格

## 6. 数据库与迁移

- ORM：SQLAlchemy 2.0；驱动：asyncpg
- 迁移：Alembic（严格使用 Alembic 作为单一真相来源）
- AI 设置已规范化为 3NF：
  - ai_api_settings：API 配置（url、key、provider）
  - ai_model_configs：模型定义，关联 API 配置
  - 其他核心表：users、campaigns、characters、tokens、drawings、fog_of_war、map_view_state、shops、shop_inventory 等

## 7. API 约定

后端典型路由：
```python
@router.post("/endpoint")
async def endpoint_name(...):
    # Async DB ops
    return ResponseModel(...)
```
前端调用：
```ts
const resp = await fetch(`${API_BASE_URL}/endpoint`, {
  method: 'POST',
  headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
  body: JSON.stringify(data)
});
```

## 8. 测试与调试

- E2E：Playwright（基于 frontend dev server）
```bash
# 需要前端 5174 可用（配置已在 playwright.config.ts 的 webServer 指定）
npx playwright test
npx playwright test --ui
```
- 后端单测：pytest
```bash
pytest backend/tests/
pytest backend/tests/test_parsers.py
```
- 日志与调试：建议将调试脚本/输出统一放在 /debug/ 下；尽量保留完整终端日志，便于复现与定位。

## 9. 开发规范与常见问题

- 文件粒度：尽量小于 400 行，按功能拆分
- 虚拟环境：后端必须在项目 venv 中运行（若遇到缺少 asyncpg，大概率未激活 venv）
- 环境安全：不要提交 .env，敏感信息从环境读取
- AI 接口：遵循 OpenAI 兼容协议；gpt-5 模型不支持温度/Top‑p/Max Tokens 等参数
- 调试准则：
  - 测试/调试时在终端打印完整日志，禁止“静默 tail/延迟输出”等做法
  - 使用 AI 方法时避免“自动回退/重试隐藏逻辑”，以免掩盖真实问题
- 前端 API：通过 frontend/app/config/api.ts 读取 VITE_API_URL，默认回退 http://localhost:8174
- CORS：后端通过 settings.get_cors_origins() 统一管理，默认包含常见本地端口（5173~5183、3000 等）

## 10. 常用命令速查

```bash
# 后端开发
cd backend && source venv/bin/activate && uvicorn app.main:app --reload --port 8174

# 前端开发
cd frontend && npm run dev

# 数据库迁移
cd backend && ./venv/bin/alembic upgrade head
alembic revision --autogenerate -m "desc"

# 测试
npx playwright test
pytest backend/tests/

# 构建
cd frontend && npm run build
```

## 11. 贡献与代码评审

- PR 前确保：本地通过单测/基础 E2E；无明显 Lint/Type 错误
- 数据变更：遵循 Alembic；避免手工 DDL
- 文档：变更涉及架构/流程时应更新 docs/

——
如需更详细的技术说明，请参考 CLAUDE.md、backend/README.md、frontend/README.md 以及 docs/ 下的专题文档。
