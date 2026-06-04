# Equipment Icon Style Guide

本文档描述了 D&D 平台装备图标的设计规范和配色方案。

## 图标风格

所有装备图标采用统一的扁平化游戏图标风格：

- **设计风格**: 扁平化 (Flat Design) / 卡通风格
- **形状**: 简洁几何形状，清晰的轮廓线
- **细节**: 简约设计，避免过多细节
- **构图**: 物品居中显示

## 配色方案

### 背景色

所有图标使用统一的深棕色背景：

| 用途 | 颜色代码 | 颜色名称 |
|------|----------|----------|
| 主背景 | `#5D4037` | 深棕色 (Dark Brown) |

### 点缀色

图标使用暖色调配色，主要点缀色：

| 用途 | 颜色代码 | 颜色名称 |
|------|----------|----------|
| 主色调 | `#FF9800` / `#FFA726` | 橙色 (Orange) |
| 辅助色 | `#26A69A` / `#009688` | 青色 (Teal) |
| 高光 | `#FFF3E0` / `#FFE0B2` | 浅橙色 (Light Orange) |
| 阴影 | `#3E2723` | 深棕色 (Dark Brown) |

## AI 生成 Prompt

使用 tu-zi API (gemini-2.5-flash-image-vip) 生成图标时，使用以下 prompt 后缀：

```
flat design game icon, simple shapes, solid dark brown background color #5D4037,
centered item, minimalist style, no transparency, warm color palette with orange
and teal accents, clean vector art style
```

### 完整 Prompt 示例

```
Create a leather coin pouch with gold coins, flat design game icon, simple shapes,
solid dark brown background color #5D4037, centered item, minimalist style,
no transparency, warm color palette with orange and teal accents, clean vector art style
```

## 图标分类

根据物品类型，图标风格略有差异但保持整体一致：

| 物品类型 | 特点 |
|----------|------|
| 武器 (Weapons) | 金属质感，锐利线条 |
| 护甲 (Armor) | 金属/皮革质感，防护感 |
| 工具 (Tools) | 木质/金属质感，实用风格 |
| 冒险装备 (Adventuring Gear) | 皮革/布料质感，旅行风格 |
| 药水 (Potions) | 玻璃质感，魔法光效 |
| 乐器 (Musical Instruments) | 木质质感，优雅造型 |
| 背景物品 (Background Items) | 根据具体物品特点设计 |

## 文件规范

- **格式**: PNG
- **尺寸**: 建议 512x512 或更高分辨率
- **命名**: 使用小写字母和下划线，如 `pouch_with_15gp.png`
- **位置**: `/frontend/public/assets/equipment-icons/`

## 生成脚本

图标生成脚本位于：`/backend/debug/generate_background_icons.py`

### API 配置

```python
API_URL = "https://api.tu-zi.com/v1/chat/completions"
MODEL = "gemini-2.5-flash-image-vip"
```

## 示例对比

### 正确风格

- 深棕色纯色背景
- 扁平化设计
- 橙色/青色点缀
- 简洁线条

### 错误风格

- 透明背景
- 写实/3D风格
- 过多细节
- 不统一的配色
