# 前端部署指南

## 概述

本项目使用 **OSS（阿里云对象存储）** 托管静态资源（图片、音乐等），以减少部署包大小并提升加载速度。

- **生产环境**：静态资源从 OSS 加载
- **开发环境**：静态资源从本地 `/public/` 目录加载

## 静态资源架构

### 资源分类

| 类型 | 本地路径 | 大小 | 说明 |
|------|----------|------|------|
| 法术图标 | `public/assets/spell-icons/` | ~200MB | 法术图标 |
| 装备图标 | `public/assets/equipment-icons/` | ~150MB | 装备图标 |
| 神祇图标 | `public/assets/god-icons/` | ~50MB | 神祇头像 |
| 技能图标 | `public/assets/skill-icons/` | ~20MB | 技能图标 |
| 状态图标 | `public/assets/condition-icons/` | ~10MB | 状态效果图标 |
| 属性图标 | `public/assets/ability-icons/` | ~5MB | 属性图标 |
| 职业图片 | `public/images/classes/` | ~15MB | 职业介绍图 |
| 种族图片 | `public/images/races/` | ~15MB | 种族介绍图 |
| 怪物图片 | `public/images/monsters/` | ~20MB | 怪物头像 |
| 头像 | `public/images/avatars/` | ~5MB | 角色头像 |
| 商店图片 | `public/images/shops/` | ~2MB | 商店背景 |
| 物品图片 | `public/images/items/` | ~5MB | 物品图片 |
| 背景音乐 | `public/music/` | ~7MB | 背景音乐 |

**总计：约 600MB 静态资源**

### URL 解析逻辑

资源 URL 由 `app/utils/asset-url.ts` 统一管理：

```typescript
// 核心逻辑
const USE_OSS = import.meta.env.PROD;

export function getAssetUrl(localPath: string): string {
  if (USE_OSS && mapping[normalizedPath]) {
    return mapping[normalizedPath];  // OSS URL
  }
  return `${BASE_PATH}/${normalizedPath}`;  // 本地路径
}
```

**使用示例：**

```typescript
import { getAssetUrl } from '~/utils/asset-url';

// 图片
<img src={getAssetUrl('assets/spell-icons/fireball.png')} />

// 背景图
style={{ backgroundImage: `url(${getAssetUrl('images/classes/fighter.png')})` }}

// 音乐
new Audio(getAssetUrl('music/Dragon\'s End.mp3'))
```

## OSS 配置

### 1. 阿里云 OSS 跨域配置（必须）

在阿里云 OSS 控制台配置跨域规则，否则会出现 `ERR_BLOCKED_BY_ORB` 错误：

**路径**：OSS 控制台 → Bucket → 数据安全 → 跨域设置 → 创建规则

| 配置项 | 值 |
|--------|-----|
| 来源 | `https://www.deepwood.cn` |
| 允许 Methods | `GET, HEAD` |
| 允许 Headers | `*` |
| 暴露 Headers | `ETag, Content-Length, Content-Type` |
| 缓存时间 | `86400` (1天) |

**完整跨域规则示例（JSON）：**

```json
{
  "CORSRule": [
    {
      "AllowedOrigin": ["https://www.deepwood.cn", "http://localhost:5174"],
      "AllowedMethod": ["GET", "HEAD"],
      "AllowedHeader": ["*"],
      "ExposeHeader": ["ETag", "Content-Length", "Content-Type"],
      "MaxAgeSeconds": 86400
    }
  ]
}
```

### 2. 上传静态资源到 OSS

使用上传脚本将本地资源上传到 OSS：

```bash
cd backend
source venv/bin/activate
python scripts/upload_static_assets_to_oss.py
```

**脚本功能：**
- 自动将 PNG/JPG 图片转换为 WebP 格式（压缩率 ~90%）
- SVG 文件保持原格式
- 音频文件直接上传
- 生成文件哈希避免缓存问题
- 生成 `frontend/public/oss-asset-mapping.json` 映射文件

**上传结果示例：**
```
原始大小: 601.61 MB
上传大小: 45.40 MB (WebP压缩)
压缩率: 92.5%
```

### 3. OSS 映射文件

上传完成后会生成 `frontend/public/oss-asset-mapping.json`：

```json
{
  "assets/spell-icons/fireball.png": "https://deepwood.oss-cn-beijing.aliyuncs.com/dnd-static/assets/spell-icons/fireball_abc123.webp",
  "images/classes/fighter.png": "https://deepwood.oss-cn-beijing.aliyuncs.com/dnd-static/images/classes/fighter_def456.webp",
  "music/Dragon's End.mp3": "https://deepwood.oss-cn-beijing.aliyuncs.com/dnd-static/music/Dragon's%20End_ghi789.mp3"
}
```

## 构建与部署

### 标准构建（包含所有资源）

```bash
cd frontend
npm run build
```

构建产物包含所有静态资源，约 **810MB**。

### 优化构建（推荐）

使用优化脚本，构建后移除 OSS 托管的资源：

```bash
cd frontend
./scripts/build-optimized.sh
```

**优化效果：**
- 初始构建大小：810MB
- 优化后大小：34MB
- 打包后大小：17MB

**脚本流程：**
1. 执行 `npm run build`
2. 删除 OSS 托管的目录和文件
3. 清理空目录
4. 创建 `frontend-build.tar.gz` 部署包

### 部署到服务器

```bash
# 上传部署包
scp frontend-build.tar.gz user@server:/path/to/deploy/

# 在服务器上
cd /path/to/deploy
tar -xzf frontend-build.tar.gz
npm install --production
pm2 restart frontend
```

## 添加新的静态资源

### 1. 添加本地文件

将文件放入 `public/` 目录对应位置。

### 2. 更新上传脚本（如需要）

如果是新的目录，在 `backend/scripts/upload_static_assets_to_oss.py` 中添加：

```python
ASSET_DIRS = [
    # ... 现有目录
    "your/new/directory",  # 新目录
]
```

### 3. 重新上传到 OSS

```bash
cd backend && python scripts/upload_static_assets_to_oss.py
```

### 4. 在代码中使用

```typescript
import { getAssetUrl } from '~/utils/asset-url';

const url = getAssetUrl('your/new/directory/file.png');
```

### 5. 更新优化构建脚本（如需要）

在 `frontend/scripts/build-optimized.sh` 中添加新目录：

```bash
OSS_DIRS=(
    # ... 现有目录
    "build/client/your/new/directory"
)
```

## 常见问题

### Q: 图片/音乐加载失败，显示 ERR_BLOCKED_BY_ORB

**原因**：OSS 未配置跨域规则

**解决**：按照上方「OSS 跨域配置」章节配置 CORS 规则

### Q: 开发环境图片正常，生产环境 404

**原因**：资源未上传到 OSS 或映射文件未更新

**解决**：
1. 运行 `python scripts/upload_static_assets_to_oss.py`
2. 确认 `oss-asset-mapping.json` 包含该资源
3. 重新构建部署

### Q: 本地开发时想测试 OSS URL

**方法**：使用 `getOSSUrl()` 函数：

```typescript
import { getOSSUrl } from '~/utils/asset-url';

// 始终返回 OSS URL（如果存在）
const ossUrl = getOSSUrl('assets/spell-icons/fireball.png');
```

### Q: 如何检查资源是否有 OSS 映射

```typescript
import { hasOSSUrl } from '~/utils/asset-url';

if (hasOSSUrl('assets/spell-icons/fireball.png')) {
  console.log('资源已上传到 OSS');
}
```

## 环境变量

### 前端 `.env`

```env
# API 地址
VITE_API_URL=http://localhost:8174

# WebSocket 地址
VITE_WS_URL=ws://localhost:8174

# 构建时的 BASE_PATH（部署到子路径时使用）
VITE_BASE_PATH=/dnd
```

### 生产构建

```bash
# 设置 BASE_PATH 进行构建
VITE_BASE_PATH=/dnd npm run build
```

## 相关文件

| 文件 | 说明 |
|------|------|
| `app/utils/asset-url.ts` | 资源 URL 解析工具 |
| `public/oss-asset-mapping.json` | OSS 映射配置（自动生成） |
| `scripts/build-optimized.sh` | 优化构建脚本 |
| `backend/scripts/upload_static_assets_to_oss.py` | OSS 上传脚本 |
