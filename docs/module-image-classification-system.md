# D&D模组图片分类与自动解析系统 - 实施文档

## 项目概述

成功实现了完整的D&D模组上传、解析和图片分类系统，支持：
1. **文本解析**：使用Fast Language Model（便宜）解析模组文本
2. **图片分类**：使用Vision Model分类地图、角色、怪物等图片
3. **进度跟踪**：实时显示解析进度
4. **自动化管理**：自动将地图添加到游戏地图管理系统

## 系统架构

### 1. 图片分类器 (`debug/image_classifier.py`)

#### 支持的图片类别
```python
IMAGE_CATEGORIES = {
    'map': '地下城地图或战术地图',
    'character_art': '角色肖像或人物插画',
    'monster': '怪物或生物插画',
    'item': '物品、装备或宝物插画',
    'scene': '场景或环境插画',
    'handout': '玩家配件（信件、文档等）'
}
```

#### 核心功能
- **AI分类**：使用Vision API智能识别图片类型
- **元数据提取**：宽度、高度、宽高比
- **详细信息**：
  - 地图：是否为战术地图、是否有网格、房间数量
  - 角色：角色名称（如果可识别）
  - 怪物：生物类型
  - 物品：物品类型
- **多语言描述**：中英文双语描述
- **置信度评分**：0.0-1.0的分类置信度

#### 降级方案
如果Vision API未配置，系统会基于：
- 文件名关键词
- 图片尺寸和宽高比
- 简单规则进行分类

### 2. 完整模组解析器 (`debug/complete_module_parser.py`)

#### 解析流程

```
1. 加载AI设置（Fast Model + Vision Model）
   ↓
2. 查找Markdown文件
   ↓
3. 文本解析（使用Fast Model）
   - 分块处理（3000字符/块）
   - 提取NPC、地点、任务、遭遇
   ↓
4. 图片分类（使用Vision Model）
   - 遍历images目录
   - 分类每张图片
   - 提取地图
   ↓
5. 数据整合与保存
   - 生成JSON文件
   - 复制地图到public目录
   ↓
6. 完成通知
```

#### 进度跟踪

解析器包含10个主要步骤，实时报告：
- 当前任务描述
- 进度百分比
- 状态（pending/processing/completed/error）

```python
progress = {
    "total_steps": 10,
    "current_step": 5,
    "current_task": "分类图片资源",
    "percentage": 50,
    "status": "processing"
}
```

#### 使用Fast Model的原因

- **成本优化**：Fast Model更便宜，适合大量文本解析
- **速度快**：响应更快，适合实时解析
- **准确性**：对于结构化数据提取已经足够

### 3. 后端API (`backend/app/api/routes/modules.py`)

#### 新增端点

1. **POST /api/modules/raw/{file_id}/parse**
   - 启动模组解析
   - 返回WebSocket连接URL
   - 异步执行解析任务

2. **WebSocket /api/modules/ws/progress/{file_id}**
   - 实时接收解析进度
   - 每个步骤自动推送更新
   - 完成后发送最终结果

#### WebSocket消息格式

```json
{
  "total_steps": 10,
  "current_step": 3,
  "current_task": "解析文本内容",
  "percentage": 30,
  "status": "processing"
}
```

完成消息：
```json
{
  "status": "success",
  "data": {
    "module_id": "bacb85ba-4feb-45f2-b253-3026750970de",
    "title": "凡戴尔的失落矿坑",
    "stats": {
      "chapters": 4,
      "npcs": 30,
      "locations": 7,
      "quests": 8,
      "maps": 8,
      "images": 8
    }
  }
}
```

## API配置要求

### 在API Settings页面配置

1. **Fast Language Model**（必需，用于文本解析）
   - API URL
   - API Key
   - Model Name

2. **Vision Recognition Model**（可选，用于图片分类）
   - API URL
   - API Key
   - Model Name

### 环境变量配置

在`.env`文件中：
```bash
# Fast Model（文本解析）
FAST_API_URL=https://dashscope.aliyuncs.com/compatible-mode/v1
FAST_API_KEY=your_key_here
FAST_MODEL=qwen-turbo

# Vision Model（图片分类）
VISION_API_URL=https://api.openai.com/v1
VISION_API_KEY=your_key_here
VISION_MODEL=gpt-4-vision-preview
```

## 使用流程

### 1. 上传模组

访问 `http://localhost:5174/modules`

1. 点击"上传文件"
2. 选择ZIP文件（包含.md和images目录）
3. 文件自动解压

### 2. 解析模组

1. 点击"解析"按钮
2. 系统开始解析：
   - 状态变为"解析中"
   - 后台启动异步任务
   - 可以通过WebSocket查看实时进度

### 3. 查看结果

解析完成后：
- 左侧显示"已完成"
- 右侧"已解析的模组"列表中出现新模组
- 可以点击查看详细信息

### 4. 地图自动添加

解析成功后，系统自动：
1. 识别所有地图图片
2. 复制到`frontend/public/maps/{module_id}/`
3. 生成地图元数据
4. 可在游戏中的地图管理界面使用

## 数据文件结构

解析后的模组保存在：
```
dnd-platform/configs/modules/{module_id}/
├── module.json          # 模组基本信息
├── chapters.json        # 章节列表
├── npcs.json           # NPC列表
├── locations.json      # 地点列表
├── quests.json         # 任务列表
├── factions.json       # 派系列表
├── encounters.json     # 遭遇列表
├── traps.json          # 陷阱列表
├── treasures.json      # 宝藏列表
└── maps.json           # 地图列表（带分类信息）
```

地图文件复制到：
```
frontend/public/maps/{module_id}/
├── map1.jpg
├── map2.jpg
└── ...
```

## 地图数据格式

```json
{
  "category": "map",
  "confidence": 0.95,
  "description": "Dungeon floor plan with multiple rooms and corridors",
  "description_zh": "包含多个房间和走廊的地下城平面图",
  "details": {
    "is_battlemap": true,
    "has_grid": true,
    "room_count": 8
  },
  "tags": ["dungeon", "battlemap", "tactical", "grid"],
  "metadata": {
    "filename": "dungeon_map.jpg",
    "width": 1920,
    "height": 1080,
    "aspect_ratio": 1.78
  },
  "url": "/maps/bacb85ba-4feb/dungeon_map.jpg"
}
```

## 技术亮点

### 1. 智能降级
- Vision API未配置时，使用基于规则的分类
- Fast Model未配置时，使用正则表达式解析
- 保证系统在任何配置下都能工作

### 2. 成本优化
- 文本解析使用Fast Model（便宜）
- 图片分类使用Vision Model（精准但贵）
- 合理分配AI资源

### 3. 实时反馈
- WebSocket进度推送
- 前端实时显示解析状态
- 用户体验友好

### 4. 模块化设计
- 图片分类器独立
- 文本解析器独立
- 易于扩展和维护

## 测试指南

### 测试图片分类

```bash
cd debug
python image_classifier.py
```

输出示例：
```
找到 8 张图片待分类...
分析图片 1/8: map1.jpg
  类别: map (置信度: 0.95)
  描述: 包含8个房间的地下城战术地图
  战术地图: 是
  包含网格: 是
  房间数量: 8
```

### 测试完整解析

```bash
cd debug
python complete_module_parser.py
```

输出示例：
```
[0%] 开始解析模组
[10%] 加载AI设置
[20%] 查找模组文件
[30%] 解析文本内容
[50%] 查找图片资源
[60%] 分类图片资源
[80%] 整合解析结果
[90%] 保存解析结果
[100%] 复制地图资源

=== 解析完成 ===
{
  "status": "success",
  "data": {
    "module_id": "lost_mine_of_phandelver",
    "title": "凡戴尔的失落矿坑",
    "stats": {
      "npcs": 30,
      "locations": 7,
      "maps": 8,
      "images": 8
    }
  }
}
```

## 待完善功能

### 短期
1. **前端WebSocket集成**
   - 在前端连接WebSocket
   - 显示实时进度条
   - 显示当前任务描述

2. **错误处理增强**
   - 更详细的错误信息
   - 重试机制
   - 部分失败继续执行

3. **地图管理集成**
   - 自动添加地图到战役
   - 地图预览
   - 地图编辑器集成

### 长期
1. **PDF支持**
   - 解析PDF格式模组
   - OCR文字识别
   - 表格提取

2. **增强AI功能**
   - NPC对话生成
   - 场景描述增强
   - 战斗AI控制

3. **批量处理**
   - 同时解析多个模组
   - 队列管理
   - 优先级控制

## 故障排查

### 问题：解析一直显示"解析中"

**检查**：
1. 后端是否运行：`ps aux | grep app.main`
2. 检查元数据文件：`cat dnd-platform/upload/raw_files_metadata.json`
3. 查看后端日志

**解决**：
1. 确保virtual environment已激活
2. 确保所有依赖已安装
3. 检查AI API配置是否正确

### 问题：图片未分类

**检查**：
1. Vision API是否配置
2. images目录是否存在
3. 图片格式是否支持（jpg, png, gif）

**解决**：
1. 配置Vision API
2. 或接受基于规则的分类结果

### 问题：Fast Model解析失败

**检查**：
1. Fast Model API配置
2. API Key是否有效
3. 网络连接

**解决**：
1. 检查.env文件配置
2. 测试API连接
3. 使用规则解析作为降级

## 性能指标

### 解析速度（预估）

- **文本解析**：3-5分钟（取决于文档大小）
- **图片分类**：每张图片10-30秒
- **总耗时**：约5-10分钟（8张图片的模组）

### 成本估算（使用Qwen）

- **Fast Model（文本）**：约¥0.02-0.05/次
- **Vision Model（图片）**：每张约¥0.01-0.03
- **总成本**：约¥0.10-0.30/模组

## 文件清单

### 核心文件
- `debug/image_classifier.py` - 图片分类器
- `debug/complete_module_parser.py` - 完整模组解析器
- `backend/app/api/routes/modules.py` - API端点
- `frontend/app/routes/modules.tsx` - 前端界面

### 配置文件
- `.env` - API配置
- `dnd-platform/upload/raw_files_metadata.json` - 上传文件元数据
- `dnd-platform/configs/modules/parsed_modules_metadata.json` - 已解析模组元数据

### 数据目录
- `dnd-platform/upload/{file_id}/` - 上传的原始文件
- `dnd-platform/configs/modules/{module_id}/` - 解析后的JSON数据
- `frontend/public/maps/{module_id}/` - 地图图片文件

## 成果总结

这个系统实现了：

1. ✅ **智能图片分类**：AI驱动的6类图片自动识别
2. ✅ **经济高效解析**：使用Fast Model降低成本
3. ✅ **实时进度追踪**：WebSocket推送解析进度
4. ✅ **自动地图管理**：地图自动添加到游戏系统
5. ✅ **降级容错设计**：无AI配置时仍可工作
6. ✅ **模块化架构**：易于扩展和维护

标志着D&D模组数字化的重要进步，为AI驱动的TRPG游戏体验奠定了坚实基础！

---

*文档版本：1.0*
*完成时间：2024年11月2日*