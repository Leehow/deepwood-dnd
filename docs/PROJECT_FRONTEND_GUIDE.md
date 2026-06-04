# 项目前端篇

本文档聚焦 `frontend/app/`，用于解释当前前端的真实结构、核心页面、地图架构、状态管理方式，以及什么地方最容易出复杂度。

配套文档：

- 总览：`docs/PROJECT_OVERVIEW.md`
- 新同事上手：`docs/ONBOARDING_30_MIN.md`
- 后端篇：`docs/PROJECT_BACKEND_GUIDE.md`
- 数据模型篇：`docs/PROJECT_DATA_MODEL_GUIDE.md`

## 1. 前端定位

这个前端不是传统“页面 + 表单 + 列表”的壳层，而是一个高度客户端化的实时应用。

它同时承担：

- 页面路由和 UI 展示
- 战役内地图交互
- 角色卡、法术、快捷栏等复杂状态
- WebSocket 实时消息消费
- 一部分规则数据驱动和派生计算
- 音乐、语音、PWA 和本地缓存

换句话说，后端负责持久化和编排，前端负责呈现与大量即时交互，两边都不轻。

## 2. 当前技术栈

当前前端主要依赖：

- React 18
- React Router 7
- TypeScript
- Vite
- Tailwind CSS
- Radix UI / Radix Themes
- TanStack React Query
- Zustand
- Konva / react-konva
- TipTap
- LiveKit Client
- Vitest

需要特别注意的一点：

- 旧文档中常写 “Remix”
- 但当前依赖和代码风格已经明显更接近 React Router 7 方案

## 3. 目录结构怎么读

建议把 `frontend/app/` 按下面方式理解：

| 路径 | 用途 |
| --- | --- |
| `routes/` | 页面入口 |
| `components/campaign/` | 战役页壳层与资源侧边内容 |
| `components/map/` | 地图系统 |
| `components/character/` | 角色展示、创建、升级与装备 |
| `components/combat/` | 战斗 UI |
| `components/spell/` | 法术卡片、筛选、施法相关 UI |
| `components/chat/` | 浮动聊天窗与筛选 |
| `components/hotbar/` | 快捷栏系统 |
| `components/ui/` | 通用 UI、规则面板、聊天面板 |
| `hooks/` | 页面级或领域级 hooks |
| `stores/` | Zustand store |
| `utils/` | API、缓存、日志、规则辅助函数 |
| `data/rules/` | 本地规则 JSON |

如果你第一次接手，不要从 `components/` 盲扫；先从 `routes/` 找到入口，再顺着 import 链进入各领域。

## 4. 应用壳层与全局行为

入口文件：

- `frontend/app/root.tsx`

这里做了几件会影响全项目的事情：

- 配置 Radix Theme
- 创建 React Query `QueryClient`
- 安装 `fetch` 拦截器
- 初始化 i18n 字典
- 注册 Service Worker
- 根据 token 做基础路由保护
- 记录最近一次战役路由
- 在首页与登录页挂载音乐播放器

因此调试全局问题时，先看 `root.tsx`：

- API 地址不对
- token 注入异常
- PWA 恢复异常
- 某些页面被强制跳登录
- Service Worker 相关问题

都可能和这里有关。

## 5. 页面入口

最重要的路由如下：

| 页面 | 文件 | 说明 |
| --- | --- | --- |
| 战役大厅 | `routes/_index.tsx` | 战役列表、模板预览、进入战役 |
| 登录页 | `routes/login.tsx` | 平台登录 |
| DM 战役页 | `routes/campaign.$id.dm.tsx` | DM 视角控制台 |
| 玩家战役页 | `routes/campaign.$id.player.tsx` | 玩家视角控制台 |
| 模组页 | `routes/modules.tsx` | 原始文件与解析模组管理 |
| 法术页 | `routes/spells.tsx` | 法术大全 |
| AI 配置页 | `routes/api-settings.tsx` | 模型、TTS、STT 配置 |
| 角色页 | `routes/character.tsx` | 角色相关页面 |

其中最需要优先认识的是：

- `campaign.$id.dm.tsx`
- `campaign.$id.player.tsx`

这两个文件都是战役页的装配中心：

- 地图
- 角色面板
- 语音
- 音乐
- 聊天
- 规则面板
- 战斗
- 商店/资源面板
- 快捷栏与施法逻辑

很多需求虽然看起来是“地图需求”或“角色需求”，最后还是要回到这两个页面处理装配逻辑。

## 6. API 与请求层

关键文件：

- `frontend/app/config/api.ts`
- `frontend/app/utils/api-client.ts`
- `frontend/app/services/api.service.ts`

### 6.1 `config/api.ts`

职责：

- 统一 `API_BASE_URL`
- 统一 `API_WS_BASE_URL`
- 构造 HTTP / WebSocket 地址

默认回退：

- HTTP：`http://localhost:8174`
- WS：根据 HTTP 自动把 `http` 改成 `ws`

### 6.2 `utils/api-client.ts`

这是前端真正该优先使用的 fetch 入口。

它会负责：

- 把 `/api/...` 相对路径改成真正的后端地址
- 自动注入 `Authorization: Bearer`
- 自动注入 `X-User-ID`
- patch 全局 `window.fetch`

如果某个页面没走 `apiFetch`，很容易出现：

- 本地地址写死
- 忘记带 token
- 忘记带用户头

### 6.3 `services/api.service.ts`

这是一层更“类库化”的 HTTP 封装，适合抽可复用 service。

特点：

- 标准 GET / POST / PUT / PATCH / DELETE 方法
- URL 参数拼接
- 统一错误处理
- `APIError` 类型

注意：

- 当前 `patch()` 实现内部实际用的是 `POST`
- 如果你新增真正的 HTTP PATCH 语义，需要先确认这里是否符合预期

## 7. 实时通信与消息流

关键文件：

- `frontend/app/hooks/useWebSocket.ts`
- `frontend/app/components/map/hooks/useMapWebSocket.ts`
- `frontend/app/hooks/useReconnectingWebSocket.ts`
- `frontend/app/hooks/useVoiceChat.ts`

### 7.1 连接层

`useWebSocket.ts` 的作用不是简单 new 一个 `WebSocket`，而是做了共享连接管理：

- 多订阅者共享一条连接
- 以 `campaignId:userId:role` 做 key
- 自动心跳、延迟监控、重连
- 统一消息格式 `{ type, data }`

这意味着如果你在战役页多个组件里同时订阅 WebSocket，不一定会创建多条物理连接。

### 7.2 业务消息层

`useMapWebSocket.ts` 负责消费战役中的业务消息，比如：

- token 放置、移动、删除
- HP 更新
- active effects / auras
- 死亡豁免
- 变形 / 专注 / 施法中状态
- 地形、迷雾、绘图、标记
- 战斗结果

这里还有一个很重要的模式：

- 收到消息后除了更新 React state
- 还会派发 DOM `CustomEvent`

这样做的结果是：

- 某些角色面板和浮动 UI 不必完全走 React props 层层传递
- 但也带来了事件链分散的问题

调试消息链时要同时找：

- WebSocket onMessage
- `setState`
- `window.dispatchEvent`
- 对应 `addEventListener`

## 8. 地图系统

地图系统是前端最大的复杂度来源。

关键文件：

- `components/map/TacticalMap.tsx`
- `components/map/TacticalMap.client.tsx`
- `components/map/hooks/useMapData.ts`
- `components/map/hooks/useMapEvents.ts`
- `components/map/hooks/useMapState.ts`
- `components/map/hooks/useMapWebSocket.ts`

### 8.1 当前结构

`TacticalMap.tsx` 只是轻包装：

- 处理客户端延迟加载
- `Suspense` fallback

真正的主体是 `TacticalMap.client.tsx`。

当前它非常大，意味着：

- 里面保留了大量交互整合逻辑
- 它不是单纯 canvas 渲染文件，而是“地图总控”

### 8.2 地图初始化

由 `useMapData.ts` 驱动，核心特点是：

- 优先用 `/api/campaigns/{campaignId}/map-bulk-data`
- 一次拿到 token / fog / terrain / rulers / drawings / markers / map_settings / view_state
- 减少页面初始阶段的多请求风暴
- 对某些 token 的角色 HP 在前端补全后再后台持久化

这是一个理解前端性能优化的重要切入点。

### 8.3 地图不是单独的“地图”

地图里实际揉进了很多系统：

- Token 生命周期
- 角色状态同步
- 光照 / 夜晚 / 遮蔽
- 法术覆盖层
- 伤害浮字
- 选择菜单与右键菜单
- 迷雾和地形
- 玩家 note / 物品 token / 商店 token / 掉落袋 token

所以地图问题经常不是 `map/` 一个目录能解决的，还会牵扯：

- `character/`
- `combat/`
- `spell/`
- `hotbar/`
- 后端 token / combat / spell API

## 9. 角色系统

关键文件与目录：

- `components/character/CharacterPanel.tsx`
- `components/character/CharacterDisplay.tsx`
- `components/character/CharacterCreationWizardV2.tsx`
- `components/character/EnhancedLevelUpModal.tsx`
- `components/character/CharacterDisplay/`
- `hooks/useCharacterSpellcasting.ts`
- `hooks/useMulticlass.ts`
- `hooks/usePassiveFeatures.ts`

### 9.1 角色展示和编辑不是一个组件

角色系统至少分为三层：

1. 战役页里的角色容器
   - 负责选择当前角色、打开弹窗、接收战役上下文
2. `CharacterDisplay`
   - 负责角色展示、装备、法术、职业特性等具体区块
3. 创建 / 升级 / 导入向导
   - 独立 modal / wizard

### 9.2 角色派生并不完全依赖后端

前端会结合：

- 角色当前状态
- 本地规则 JSON
- 工具函数与 hooks

来计算：

- 属性修正
- 熟练项
- 法术展示
- 特性展示
- 速度和部分派生值

所以角色界面的 bug 经常需要前后端一起看。

## 10. 法术、快捷栏与战斗交互

关键目录：

- `components/spell/`
- `components/hotbar/`
- `components/combat/`
- `utils/sidebarCasting.ts`
- `utils/spellHelpers.ts`
- `utils/spellModifiers.ts`

当前结构特点：

- 法术列表与战役内施法是两套相关但不完全相同的 UI
- 快捷栏承担了很多战役内动作入口
- 快捷栏触发后会进入目标选择、距离判断、资源消耗、后端施法或战斗 API

因此：

- 法术问题可能出在 `spell/`
- 也可能出在 `hotbar/`
- 还可能在 `campaign.$id.dm.tsx` / `campaign.$id.player.tsx`
- 或后端 `combat.py` / `spell_cast.py`

## 11. 聊天、规则与资源问答

关键区域：

- `components/ui/ChatPanel.tsx`
- `components/chat/`
- `components/ui/RulesPanel.tsx`
- `components/ui/Module_AIQueryTab.tsx`
- `components/ui/Resource_AIQueryTab.tsx`

这块可以粗分成三类：

- 战役聊天
- 规则查询
- 模组 / 资源 AI 问答

它们在 UI 上有相似性，但后端目的地不一样：

- 普通聊天：战役聊天 / WebSocket
- 规则问答：rules chat / embedding
- 模组问答：module chat
- 资源问答：resource chat

## 12. 前端状态管理方式

当前状态管理是“组合拳”：

- React state
- React Query
- Zustand
- 短期缓存 util
- `localStorage` / `sessionStorage`
- DOM CustomEvent

### 12.1 Zustand store

代表性 store：

- `voiceStore.ts`
- `campaignMusicStore.ts`
- `tradeStore.ts`
- `onlineStore.ts`
- `moduleStore.ts`

### 12.2 缓存 util

代表性缓存：

- `characterCache.ts`
- `campaignMembersCache.ts`
- `combatStateCache.ts`
- `mapTokensCache.ts`
- `moduleMapsCache.ts`
- `characterResourcesCache.ts`

### 12.3 什么时候选哪种方式

一般经验：

- 页面局部交互：React state
- 远程查询结果：React Query 或 cache util
- 跨组件共享且偏 UI / session 级状态：Zustand
- 战役内消息联动：WebSocket + CustomEvent

## 13. 规则 JSON 与内容数据

关键目录：

- `frontend/app/data/rules/`

这里是很多功能的底层数据源，包含：

- 种族
- 职业与职业进程
- 背景
- 法术
- 装备
- 专长
- 条件
- 世界观 / 众神 / NPC 模板

当前 README 明确建议把它当作单一真相源。

这意味着：

- 你修一个职业特性 UI 时，先确认是代码问题还是规则 JSON 问题
- 很多“后端没返回”的内容，其实本来就设计成前端本地导入

## 14. 测试与本地验证

前端当前最实用的检查包括：

```bash
cd frontend
npm run typecheck
npm run test
```

根目录 Playwright 配置当前主要指向：

- `debug/*.spec.ts`

如果你要做前端修复，最少建议完成：

1. 相关页面手工验证
2. `npm run typecheck`
3. 如果涉及关键交互，再补一个最小回归测试

## 15. 当前前端维护热点

最值得特别小心的区域：

- `components/map/TacticalMap.client.tsx`
- `routes/campaign.$id.dm.tsx`
- `routes/campaign.$id.player.tsx`
- `components/character/CharacterDisplay/`
- `components/ui/ChatPanel.tsx`

原因不是这些文件“写得差”，而是它们承担了太多装配责任。

改这些区域时，建议：

- 先找完整调用链
- 先确认是否有 WebSocket / CustomEvent 参与
- 先确认数据是来自后端、前端 cache 还是本地规则 JSON

## 16. 建议阅读顺序

建议按下面顺序继续深入：

1. `frontend/app/root.tsx`
2. `frontend/app/utils/api-client.ts`
3. `frontend/app/routes/_index.tsx`
4. `frontend/app/routes/campaign.$id.dm.tsx`
5. `frontend/app/routes/campaign.$id.player.tsx`
6. `frontend/app/components/map/TacticalMap.tsx`
7. `frontend/app/components/map/hooks/useMapData.ts`
8. `frontend/app/components/map/hooks/useMapWebSocket.ts`
9. `frontend/app/components/character/CharacterPanel.tsx`
10. `frontend/app/components/character/CharacterDisplay.tsx`

读完这条链，你对前端主干就不会陌生了。
