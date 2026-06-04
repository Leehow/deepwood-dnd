# TacticalMap.client.tsx 重构指南

## 重构概述

将 `TacticalMap.client.tsx`（836行，16个hooks）拆分：

### 拆分计划

#### 1. 自定义 Hooks

**useMapState.ts** (~100行)
- 缩放/平移状态
- 视口计算

**useMapTokens.ts** (~150行)
- Token状态管理
- Token移动处理

**useMapFog.ts** (~100行)
- 战争迷雾状态
- 迷雾绘制

**useMapDrawings.ts** (~100行)
- 绘图状态
- 标尺/形状

#### 2. 子组件

**MapCanvas.tsx** (~200行)
- Konva Stage/Layer
- 基础渲染

**MapTokenLayer.tsx** (~150行)
- Token渲染
- 拖拽处理

**MapFogLayer.tsx** (~100行)
- 迷雾渲染

**MapToolbar.tsx** (~80行)
- 工具选择
- 缩放控制

## 文件结构

```
app/components/map/
├── TacticalMap.client.tsx (~200行)
├── MapCanvas.tsx
├── MapTokenLayer.tsx
├── MapFogLayer.tsx
├── MapToolbar.tsx
├── hooks/
│   ├── useMapState.ts
│   ├── useMapTokens.ts
│   ├── useMapFog.ts
│   └── useMapDrawings.ts
└── index.ts
```

## 性能优化

1. **视口裁剪** - 只渲染可见区域的tokens
2. **requestAnimationFrame** - 平滑动画
3. **Konva缓存** - 静态层缓存
4. **事件节流** - 减少重绘
