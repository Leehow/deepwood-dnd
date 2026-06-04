# 新同事 30 分钟上手指南

这份文档假设你是第一次接手 `dw` 项目，并且希望在 30 分钟内建立一套“能定位、能运行、能开始改”的最小心智模型。

目标不是把所有业务看完，而是让你在半小时后回答下面这些问题：

- 这个项目到底做什么
- 前后端入口在哪里
- 页面和 API 是怎么串起来的
- 地图、角色、战斗、模组、AI 这几块分别在哪
- 我现在如果要修一个 bug，第一步该去翻哪个文件

## 0. 先记住这 6 句话

1. 这是一个 D&D 5E 跑团平台，不是普通后台管理系统。
2. 前端当前以 React Router 7 为主，不要被旧文档里的 Remix 表述误导。
3. 地图和战役页面是前端复杂度最高的地方。
4. 角色、战斗、模组解析是后端复杂度最高的地方。
5. 这个项目很多流程是 HTTP 和 WebSocket 混用，不是纯接口驱动。
6. 规则数据有相当一部分放在前端本地 JSON，不全在后端数据库里。

## 1. 第 0-5 分钟：先把项目跑起来

如果你本地环境已经齐备，优先用一键脚本：

```bash
cd /Users/haoli/leehow/code/dw
./dev-start.sh
```

它会启动：

- 前端：`http://localhost:5174`
- 后端：`http://localhost:8174`
- API 文档：`http://localhost:8174/docs`

常用日志：

```bash
tail -f logs/frontend.log
tail -f logs/backend.log
```

如果你要分开启动：

```bash
cd backend
source venv/bin/activate
alembic upgrade head
uvicorn app.main:app --reload --port 8174
```

```bash
cd frontend
npm run dev
```

最少需要关注的环境变量：

- 后端：`DATABASE_URL`、`REDIS_URL`
- 前端：`VITE_API_URL`、`VITE_WS_URL`
- 如果要用 AI / 语音 / OCR，再补模型和服务相关配置

## 2. 第 5-10 分钟：先读哪几个文件

不要一上来就钻进 `TacticalMap.client.tsx` 或 `characters.py`。先按这个顺序读：

1. `docs/PROJECT_OVERVIEW.md`
2. `frontend/app/root.tsx`
3. `frontend/app/routes/_index.tsx`
4. `frontend/app/routes/campaign.$id.dm.tsx`
5. `backend/app/main.py`
6. `backend/app/api/routes/campaigns.py`
7. `backend/app/api/routes/websocket_simplified.py`

这 7 个文件能帮你快速建立“页面壳层 + API 入口 + 实时入口”的第一层地图。

## 3. 第 10-15 分钟：建立顶层目录地图

把仓库理解成下面几个块：

| 目录 | 先怎么理解 |
| --- | --- |
| `frontend/` | 用户真正看到的产品界面 |
| `backend/` | API、业务编排、AI 调度、实时广播 |
| `dnd-platform/` | 模组、解析产物、资源素材 |
| `docs/` | 设计说明和接手资料 |
| `debug/` | 调试脚本和临时 spec |

然后把前后端再继续拆一层：

### 前端

- `app/routes/`
  - 页面入口
- `app/components/map/`
  - 地图系统
- `app/components/character/`
  - 角色系统
- `app/components/campaign/`
  - 战役与资源面板
- `app/components/ui/`
  - 聊天、规则面板、通用 UI
- `app/hooks/` 和 `app/utils/`
  - 通用逻辑、缓存、实时、辅助函数
- `app/data/rules/`
  - 大量本地规则数据

### 后端

- `app/api/routes/`
  - 所有 HTTP / WebSocket 入口
- `app/models/`
  - 数据库模型
- `app/services/`
  - 真正的业务逻辑
- `app/domain/parsing/`
  - 模组 OCR / 解析流水线
- `app/core/`
  - 配置、安全、日志
- `app/db/`
  - 数据库和 Redis

## 4. 第 15-20 分钟：抓住一个完整主流程

推荐你先跟一遍“进入战役并加载地图”的流程，因为它能同时串起前后端。

### 前端视角

1. 登录页：`frontend/app/routes/login.tsx`
2. 首页大厅：`frontend/app/routes/_index.tsx`
3. 进入 DM 或 Player 页：
   - `frontend/app/routes/campaign.$id.dm.tsx`
   - `frontend/app/routes/campaign.$id.player.tsx`
4. 页面里挂上地图组件：
   - `frontend/app/components/map/TacticalMap.tsx`
   - `frontend/app/components/map/TacticalMap.client.tsx`
5. 地图先走 bulk load：
   - `frontend/app/components/map/hooks/useMapData.ts`
6. 再建立 WebSocket：
   - `frontend/app/hooks/useWebSocket.ts`
   - `frontend/app/components/map/hooks/useMapWebSocket.ts`

### 后端视角

1. 战役 API：
   - `backend/app/api/routes/campaigns.py`
2. 地图 bulk API：
   - `backend/app/api/routes/map_bulk_data.py`
3. WebSocket 入口：
   - `backend/app/api/routes/websocket_simplified.py`
4. 广播管理：
   - `backend/app/services/websocket_manager.py`
5. 具体消息处理：
   - `backend/app/services/websocket_handlers/*.py`

如果你能把这条链路讲清楚，说明项目主干已经进脑子了。

## 5. 第 20-25 分钟：认出 4 个高复杂度区域

这一步不是为了立刻重构，而是为了避免误判工作量。

### 5.1 地图系统

先看：

- `frontend/app/components/map/TacticalMap.client.tsx`
- `frontend/app/components/map/hooks/useMapData.ts`
- `frontend/app/components/map/hooks/useMapWebSocket.ts`

要点：

- 这里不仅是画地图
- 还包含 token、HP、迷雾、地形、法术范围、绘图、覆盖层、交互菜单、动画和事件广播

### 5.2 战役容器页

先看：

- `frontend/app/routes/campaign.$id.dm.tsx`
- `frontend/app/routes/campaign.$id.player.tsx`

要点：

- 这两个页面是“平台壳”
- 很多面板都在这里装配

### 5.3 角色与战斗后端

先看：

- `backend/app/api/routes/characters.py`
- `backend/app/api/routes/combat.py`
- `backend/app/api/routes/spell_cast.py`

要点：

- 角色成长、资源池、特性、法术、动作很多都在这里落地
- 一个改动经常会同时影响角色数据、token 状态和前端快捷栏

### 5.4 模组与 AI

先看：

- `backend/app/api/routes/modules.py`
- `backend/app/domain/parsing/pipeline.py`
- `backend/app/api/routes/module_chat.py`
- `backend/app/services/ai_model_service.py`

要点：

- 模组不是单一上传接口，而是 OCR + 结构化 + 问答 + 向量化的组合系统

## 6. 第 25-30 分钟：为自己准备第一天的工作习惯

### 先学会用这些文件

- `frontend/app/utils/api-client.ts`
  - 统一注入 `Authorization` 和 `X-User-ID`
- `frontend/app/config/api.ts`
  - API / WS 地址来源
- `backend/app/core/config.py`
  - 后端环境变量入口
- `backend/app/db/session.py`
  - 数据库 session 模式
- `backend/app/core/security.py`
  - JWT 鉴权

### 先记住这些项目事实

- 旧文档里有些说法已经过时，要优先相信源码
- 前端大量依赖本地规则 JSON
- 后端有大量 JSON/JSONB 字段，不是所有业务都拆成强关系表
- 项目里很多状态是“角色表 + token 表 + WebSocket 广播”共同维护的
- 大页面里会使用短期缓存、DOM 自定义事件和 WebSocket 同时配合

### 你的第一个小任务最好选什么

推荐优先做这些类型：

- 单个 API 字段补齐
- 单个前端面板的展示修复
- 单个 WebSocket 消息类型联调
- 单个规则 JSON 的接入或修正
- 单条角色资源或法术逻辑修复

不推荐第一天直接动这些：

- `TacticalMap.client.tsx` 的大重构
- `characters.py` / `combat.py` 的全局整理
- 模组解析流水线的结构性改造

## 7. 新同事最常见的 8 个误区

1. 以为前端只是页面层，实际上它还承担了不少规则和派生计算。
2. 以为所有业务状态都在数据库里，实际上还有前端规则 JSON 和客户端缓存。
3. 以为 WebSocket 只负责聊天，实际上地图、奖励、交易、时间、音乐都在走它。
4. 以为战斗只在 `combat.py`，实际上 `tokens.py`、`spell_cast.py`、角色与前端快捷栏都会参与。
5. 以为模组解析只是上传 PDF，实际上还包含 OCR、图片分类、TOC、实体抽取、嵌入和问答。
6. 以为所有文档都可靠，实际上部分历史文档和当前代码已经有漂移。
7. 以为 `apiFetch` 只是一个 fetch 包装，实际上它是鉴权和 API 地址统一入口。
8. 以为“修角色问题”只动后端就够，经常还要同步前端派生展示和 token 更新。

## 8. 建议继续读的文档

半小时结束后，下一步建议按这个顺序继续：

1. `docs/PROJECT_OVERVIEW.md`
2. `docs/PROJECT_FRONTEND_GUIDE.md`
3. `docs/PROJECT_BACKEND_GUIDE.md`
4. `docs/PROJECT_DATA_MODEL_GUIDE.md`
5. `docs/ARCHITECTURE_ANALYSIS.md`

## 9. 一句话版本的接手策略

先把“战役页 -> 地图 -> API -> WebSocket -> 数据模型”这条主干读通，再去看角色细节、法术细节和模组 AI 细节；这样你会快很多，也不容易在超大文件里迷路。
