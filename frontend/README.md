# DND 5E 跑团平台 - 前端

基于 Remix + React + Konva.js 构建的 D&D 5E 在线跑团平台前端。

## 技术栈

- **框架**: Remix (全栈 React 框架)
- **UI 组件**: Radix UI + Radix Themes
- **样式**: Tailwind CSS
- **地图渲染**: Konva.js + react-konva
- **状态管理**: Zustand (计划中)
- **数据获取**: React Query
- **类型**: TypeScript

## 功能特性

### ✅ 已实现

- 🏠 **首页** - 欢迎页面，展示平台特性
- 🎮 **房间大厅** - 创建/加入战役
- 👑 **DM 界面** - 城主控制台
  - 战术地图（网格系统）
  - Token 拖拽移动
  - 工具栏（选择、移动、测距等）
  - 角色/怪物管理面板
  - 聊天系统
  - 虚拟骰子
- 🎲 **玩家界面** - 玩家视图
  - 受限的地图视图
  - 角色卡展示
  - 队伍成员列表
  - 聊天和笔记
  - 虚拟骰子

### 🚧 待实现

- [ ] WebSocket 实时同步
- [ ] 战争迷雾系统
- [ ] 测距工具
- [ ] 绘图工具
- [ ] 角色创建器
- [ ] 法术管理
- [ ] 物品栏系统
- [ ] AI DM 助手集成

## 快速开始

### 安装依赖

```bash
npm install
```

### 开发模式

```bash
npm run dev
```

访问 http://localhost:5174

### 构建生产版本

```bash
npm run build
npm start
```

## 项目结构

```
frontend/
├── app/
│   ├── routes/                    # 路由页面
│   │   ├── _index.tsx            # 首页
│   │   ├── lobby.tsx             # 房间大厅
│   │   ├── campaign.$id.dm.tsx   # DM 界面
│   │   └── campaign.$id.player.tsx # 玩家界面
│   ├── components/               # 组件
│   │   ├── map/                  # 地图相关
│   │   │   └── TacticalMap.tsx  # 战术地图
│   │   ├── ui/                   # UI 组件
│   │   │   ├── Toolbar.tsx      # 工具栏
│   │   │   └── ChatPanel.tsx    # 聊天面板
│   │   ├── dice/                 # 骰子
│   │   │   └── DiceRoller.tsx   # 骰子投掷器
│   │   └── character/            # 角色
│   │       ├── CharacterPanel.tsx # 角色面板
│   │       └── CharacterSheet.tsx # 角色卡
│   ├── styles/                   # 样式
│   │   └── tailwind.css         # Tailwind 配置
│   └── root.tsx                  # 根组件
├── public/                       # 静态资源
├── package.json
├── tsconfig.json
├── tailwind.config.ts
└── vite.config.ts
```

## 核心组件说明

### TacticalMap (战术地图)

基于 Konva.js 的战术地图组件，支持：
- 网格系统（40px = 5尺）
- Token 拖拽移动
- 自动吸附到网格
- HP 条显示
- DM/玩家权限控制

```tsx
<TacticalMap
  campaignId="123"
  isDM={true}
  selectedTool="select"
  showGrid={true}
  showFogOfWar={true}
/>
```

### DiceRoller (虚拟骰子)

支持所有 DND 骰子类型：
- d4, d6, d8, d10, d12, d20, d100
- 调整值（+/-）
- 结果显示

### CharacterSheet (角色卡)

显示角色完整信息：
- 基本信息（种族、职业、等级）
- HP 和 AC
- 六大属性值
- 技能列表
- 快捷动作

## 样式系统

使用 Tailwind CSS + 自定义奇幻风格：

```css
/* 奇幻按钮 */
.btn-fantasy

/* 次要按钮 */
.btn-secondary

/* 卡片 */
.card

/* 输入框 */
.input
```

## 路由说明

- `/` - 首页
- `/lobby` - 房间大厅
- `/campaign/:id/dm` - DM 控制台
- `/campaign/:id/player` - 玩家视图

## 开发注意事项

1. **地图性能优化**
   - 使用 Konva 的 Layer 分层渲染
   - Token 数量超过 100 时考虑虚拟化

2. **WebSocket 集成**
   - 需要连接到 FastAPI 后端的 WebSocket 端点
   - 消息格式需要与后端协商

3. **响应式设计**
   - 地图组件会根据窗口大小自动调整
   - 移动端暂不支持

## 下一步开发

1. **WebSocket 实时同步**
   - 创建 `app/lib/websocket.ts`
   - 实现 Token 位置同步
   - 实现聊天消息同步

2. **战争迷雾**
   - 基于角色视野范围
   - 使用 Konva Clip 实现

3. **角色创建器**
   - 集成 `configs/races.json`
   - 集成 `configs/classes.json`
   - 多步骤表单

## 许可证

MIT
