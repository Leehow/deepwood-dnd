# 种族背景图片功能

## 功能概述

在角色创建向导的种族选择步骤中，每个种族卡片现在都有一个AI生成的背景图片，增强视觉效果和沉浸感。

## 技术实现

### 后端API

**端点**: `POST /api/ai-settings/generate-race-image`

**参数**:

- `race_name` (query): 种族英文名称
- `race_name_cn` (query): 种族中文名称  
- `user_id` (query, optional): 用户ID，默认为 "demo_user"

**功能**:

1. 从数据库获取用户的AI设置
2. 验证图片生成模型已配置
3. 使用配置的图片生成模型生成种族背景图
4. 返回base64编码的图片数据

**Prompt模板**:

```
A majestic D&D {race_name} ({race_name_cn}) character in dark fantasy style, 
dramatic lighting with warm amber and golden highlights, mysterious atmosphere, 
detailed fantasy art, cinematic composition, dark background with glowing amber accents, 
epic fantasy illustration
```

### 前端实现

**文件**: `frontend/app/components/character/CharacterCreationWizard.tsx`

**关键修改**:

1. **状态管理**:

   ```typescript
   const [raceImages, setRaceImages] = useState<Record<string, string>>({});
   const [loadingImages, setLoadingImages] = useState(false);
   ```

2. **图片生成**:
   - 当向导打开时自动触发
   - 为所有9个种族并行生成背景图
   - 失败时不影响其他种族的生成

3. **UI显示**:
   - 背景图片作为绝对定位元素，opacity 20%，带模糊效果
   - 内容层级使用 `z-10` 确保在图片上方
   - 加载时显示动画提示

## 风格统一

所有生成的图片遵循统一的暗黑奇幻风格：

- **色调**: 暗色背景 + 琥珀色/金色高光
- **氛围**: 神秘、史诗、戏剧性
- **构图**: 电影级构图，细节丰富
- **主题**: D&D奇幻风格

这与整个应用的UI主题保持一致（暗黑奇幻 + 琥珀色强调）。

## 使用的AI模型

使用用户在"API设置"页面配置的**图片生成模型**（Image Generation Model）。

支持OpenAI DALL-E兼容的API格式：

- 请求格式: `/images/generations`
- 响应格式: base64_json
- 图片尺寸: 512x512 (适合卡片背景)

## 用户体验

1. **首次打开**: 显示"正在生成种族背景图片..."提示
2. **生成完成**: 图片淡入显示，提升视觉效果
3. **失败处理**: 单个种族失败不影响其他种族，卡片仍可正常使用

## 性能考虑

- 图片仅在向导首次打开时生成一次
- 使用状态缓存，避免重复生成
- 并行请求提高生成速度
- 失败时优雅降级，不阻塞用户操作

## 图片生成

### 生成脚本

使用 `debug/generate_race_images_simple.py` 脚本一次性生成所有种族背景图：

```bash
python debug/generate_race_images_simple.py
```

**特点**:

- 从数据库读取用户配置的图片生成模型
- 使用chat completion端点（支持图片生成）
- 自动跳过已存在的图片
- 统一的暗黑奇幻风格prompt

### 已生成图片

所有9个种族的背景图已预先生成并保存在 `frontend/public/images/races/`:

- `dwarf.png` - 矮人
- `elf.png` - 精灵
- `halfling.png` - 半身人
- `human.png` - 人类
- `dragonborn.png` - 龙裔
- `gnome.png` - 侏儒
- `half_elf.png` - 半精灵
- `half_orc.png` - 半兽人
- `tiefling.png` - 提夫林

**图片规格**:

- 格式: PNG
- 尺寸: 512x512
- 平均大小: 1.3MB
- 风格: 暗黑奇幻 + 琥珀色调

## 未来优化

1. **图片压缩**: 优化PNG文件大小以提升加载速度
2. **响应式尺寸**: 提供多种尺寸以适配不同设备
3. **自定义**: 允许用户上传自定义种族背景图
4. **质量选项**: 提供不同质量/尺寸选项以平衡性能和视觉效果
