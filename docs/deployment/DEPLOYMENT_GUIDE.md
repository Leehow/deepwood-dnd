# D&D Platform 部署文档

构建前先清理旧构建再重新构建，不然容易出现越积越多的情况（本地和生产端都是）
> 最后更新: 2026-01-21

## 服务器信息

| 项目 | 值 |
|------|-----|
| 服务器 IP | 60.205.209.95 |
| 用户 | root |
| 部署目录 | /root/dnd/ |
| 域名 | <https://www.deepwood.cn/dnd> |

## SSH 连接配置（推荐）

使用 SSH 密钥认证代替密码，在 `~/.ssh/config` 中配置：

```
Host deepwood-prod
    HostName 60.205.209.95
    User root
    IdentityFile ~/.ssh/id_rsa
```

之后可直接使用 `ssh deepwood-prod` 或 `scp file.txt deepwood-prod:/path/` 连接。

## 架构概览

```
┌─────────────────────────────────────────────────────────────┐
│                         DNS 配置                             │
├─────────────────────────────────────────────────────────────┤
│  www.deepwood.cn  ──→  CDN  ──→  Nginx  ──→  服务器         │
│  ws.deepwood.cn   ──→  直接 A 记录  ──→  Nginx (绕过 CDN)   │
└─────────────────────────────────────────────────────────────┘

                    ┌─────────────────┐
                    │     Nginx       │
                    │   (反向代理)     │
                    └────────┬────────┘
                             │
         ┌───────────────────┼───────────────────┐
         │                   │                   │
         ▼                   ▼                   ▼
   www.deepwood.cn     www.deepwood.cn     ws.deepwood.cn
     /dnd/*              /dnd/api/*           /dnd/ws/*
         │                   │                   │
         ▼                   ▼                   ▼
  ┌──────────┐        ┌──────────┐        ┌──────────┐
  │ Frontend │        │ Backend  │        │ WebSocket│
  │ :5174    │        │ :8174    │        │ :8174    │
  └──────────┘        └──────────┘        └──────────┘
```

## 服务配置

### 后端服务 (dnd-backend)

- **端口**: 8174
- **工作目录**: `/root/dnd/backend`
- **启动命令**: `python -m uvicorn app.main:app --host 0.0.0.0 --port 8174`
- **服务文件**: `/etc/systemd/system/dnd-backend.service`

```ini
# /etc/systemd/system/dnd-backend.service
[Unit]
Description=DnD Platform Backend
After=network.target postgresql.service

[Service]
Type=simple
User=root
WorkingDirectory=/root/dnd/backend
Environment="PATH=/root/dnd/backend/venv/bin"
EnvironmentFile=/root/dnd/.env
ExecStart=/root/dnd/backend/venv/bin/python -m uvicorn app.main:app --host 0.0.0.0 --port 8174
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
```

### 前端服务 (dnd-frontend)

- **端口**: 5174
- **工作目录**: `/root/dnd/frontend`
- **启动命令**: `node ./build/server/index.js`
- **进程管理**: **PM2**
- **PM2 进程名**: `dnd-frontend`

> ⚠️ **重要**: 前端服务由 PM2 管理，不要使用 systemctl 命令！

## Nginx 配置

### 主域名配置 (<www.deepwood.cn>)

```nginx
# /etc/nginx/sites-available/dnd
server {
    listen 443 ssl;
    server_name www.deepwood.cn;

    # SSL 配置 (与其他服务共用)
    ssl_certificate /path/to/cert.pem;
    ssl_certificate_key /path/to/key.pem;

    # D&D Platform API
    location /dnd/api/ {
        proxy_pass http://127.0.0.1:8174/api/;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # 文件上传大小限制 (模组 PDF 可能较大)
        client_max_body_size 100M;
    }

    # D&D Platform Frontend
    location /dnd/ {
        proxy_pass http://127.0.0.1:5174/;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

### WebSocket 子域名配置 (ws.deepwood.cn)

> ⚠️ **为什么需要专用子域名？** CDN 不支持或不稳定支持 WebSocket 长连接，使用 `ws.deepwood.cn` 直接解析到服务器 IP，绕过 CDN。

**DNS 配置：**

```
www.deepwood.cn  → CDN → 服务器
ws.deepwood.cn   → 直接 A 记录 → 服务器 (60.205.209.95)
```

**Nginx 配置：**

```nginx
server {
    listen 443 ssl;
    server_name ws.deepwood.cn;

    ssl_certificate /path/to/cert.pem;
    ssl_certificate_key /path/to/key.pem;

    # D&D Platform WebSocket
    location /dnd/ws/ {
        proxy_pass http://127.0.0.1:8174/ws/;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_read_timeout 86400;  # 24小时，保持长连接
    }
}
```

### Nginx 关键配置项

| 配置 | 说明 |
|------|------|
| `proxy_http_version 1.1` | WebSocket 需要 HTTP/1.1 |
| `Upgrade $http_upgrade` | 协议升级头 |
| `Connection "upgrade"` | 保持升级连接 |
| `proxy_read_timeout 86400` | 长连接超时（24小时） |
| **尾部斜杠** | `/dnd/ws/` → `/ws/` 路径正确传递 |

> ⚠️ **尾部斜杠很重要**：`location /dnd/ws/` 和 `proxy_pass .../ws/` 都需要尾部斜杠，否则路径会丢失！

## 环境变量配置

### 生产环境 `/root/dnd/.env`

```env
# Database
DATABASE_URL=postgresql+asyncpg://dnd_user:password@localhost/dnd_production

# Resterlab Authentication (Schloss)
# ⚠️ 只读访问！schloss_production 是现有认证系统，有正在使用的数据
RESTERLAB_DATABASE_URL=postgresql://dnd_user:password@localhost/schloss_production

# Security
SECRET_KEY=your-production-secret-key

# AI Services
CST_API_KEY=xxx
CST_API_URL=https://api.cstcloud.cn/v1
QWEN_API_KEY=xxx
INFINI_API_KEY=xxx
DOC2X_API_KEY=xxx
TUZI_API_KEY=xxx
MISTRAL_API_KEY=xxx

# OSS (阿里云)
OSS_ACCESS_KEY_ID=xxx
OSS_ACCESS_KEY_SECRET=xxx
OSS_BUCKET_NAME=xxx
OSS_ENDPOINT=xxx

# LiveKit 语音聊天
LIVEKIT_API_KEY=APIKeyDND
LIVEKIT_API_SECRET=DND_Voice_Secret_2024_Secure
LIVEKIT_URL=wss://ws.deepwood.cn/livekit
```

### 前端环境变量 `/root/dnd/frontend/.env`

```env
VITE_API_URL=/dnd/api
VITE_WS_URL=wss://ws.deepwood.cn/dnd/ws
```

> ⚠️ **重要**:
>
> - API 使用相对路径，由 Nginx 代理到后端
> - **WebSocket 必须使用 `ws.deepwood.cn` 子域名**，绕过 CDN（CDN 不支持 WebSocket 长连接）

## 快速部署命令

> 以下命令使用 SSH 配置别名 `deepwood-prod`，请先配置 SSH 密钥认证。

### 后端部署

```bash
# 1. 上传后端代码 (排除 venv、__pycache__ 等)
cd backend
tar --exclude='venv' --exclude='__pycache__' --exclude='*.pyc' \
    --exclude='.pytest_cache' --exclude='htmlcov' --exclude='*.egg-info' \
    -czf backend.tar.gz app tests alembic alembic.ini requirements.txt pytest.ini

# 2. 上传并解压
scp backend.tar.gz deepwood-prod:/root/dnd/
ssh deepwood-prod "cd /root/dnd && rm -rf backend/app backend/tests && tar -xzf backend.tar.gz -C backend && rm backend.tar.gz"

# 3. 安装依赖 (如有新增)
ssh deepwood-prod "cd /root/dnd/backend && source venv/bin/activate && pip install -r requirements.txt"

# 4. 运行数据库迁移
ssh deepwood-prod "cd /root/dnd/backend && source venv/bin/activate && alembic upgrade head"

# 5. 重启后端服务
ssh deepwood-prod "systemctl restart dnd-backend"

# 6. 清理本地压缩包
rm backend.tar.gz
```

### 前端部署

```bash
# 1. 本地构建
cd frontend
rm -rf build  # 清理旧构建
npm run build

# 2. 打包构建产物（排除图片目录，生产环境使用 OSS 图片）
tar --exclude='build/client/assets' \
    --exclude='build/client/images' \
    --exclude='build/client/music' \
    -czf frontend-build.tar.gz build package.json package-lock.json app/data

# 3. 上传压缩包
scp frontend-build.tar.gz deepwood-prod:/root/dnd/frontend/

# 4. 服务器上解压并重启
ssh deepwood-prod "cd /root/dnd/frontend && rm -rf build app/data && tar -xzf frontend-build.tar.gz && rm frontend-build.tar.gz && find . -name '._*' -delete && npm install --production && pm2 restart dnd-frontend && pm2 save"

# 5. 清理本地压缩包
rm frontend-build.tar.gz
```

> ⚠️ **重要**: `app/data` 目录包含规则数据（races.json, classes.json 等），后端 API 依赖这些文件！

> ⚠️ **重要**: **不要上传图片目录**！生产环境图片来自 OSS，参见「静态资源管理」章节。

> ⚠️ **警告**: 不要使用 `scp -r build` 逐个文件上传，可能会被服务器封禁！

> ⚠️ **重要**: 解压前必须先 `rm -rf build`！否则新旧文件混合会导致问题

### 一键部署脚本

```bash
#!/bin/bash
# deploy.sh - 一键部署脚本

set -e

echo "=== D&D Platform 部署 ==="

# 部署后端
echo "[1/4] 构建后端..."
cd backend
tar --exclude='venv' --exclude='__pycache__' --exclude='*.pyc' \
    --exclude='.pytest_cache' --exclude='htmlcov' \
    -czf ../backend.tar.gz app tests alembic alembic.ini requirements.txt pytest.ini
cd ..

echo "[2/4] 上传后端..."
scp backend.tar.gz deepwood-prod:/root/dnd/
ssh deepwood-prod "cd /root/dnd && rm -rf backend/app backend/tests && tar -xzf backend.tar.gz -C backend && rm backend.tar.gz && cd backend && source venv/bin/activate && alembic upgrade head && systemctl restart dnd-backend"
rm backend.tar.gz

# 部署前端
echo "[3/4] 构建前端..."
cd frontend
rm -rf build
npm run build
# 排除图片目录，生产环境使用 OSS 图片
tar --exclude='build/client/assets' \
    --exclude='build/client/images' \
    --exclude='build/client/music' \
    -czf ../frontend-build.tar.gz build package.json package-lock.json app/data
cd ..

echo "[4/4] 上传前端..."
scp frontend-build.tar.gz deepwood-prod:/root/dnd/frontend/
ssh deepwood-prod "cd /root/dnd/frontend && rm -rf build app/data && tar -xzf frontend-build.tar.gz && rm frontend-build.tar.gz && find . -name '._*' -delete && npm install --production && pm2 restart dnd-frontend && pm2 save"
rm frontend-build.tar.gz

echo "=== 部署完成 ==="
```

## 服务管理命令

```bash
# SSH 登录服务器
ssh deepwood-prod

# 查看服务状态
systemctl status dnd-backend      # 后端用 systemd
pm2 status                        # 前端用 PM2

# 重启服务
systemctl restart dnd-backend     # 后端
pm2 restart dnd-frontend          # 前端

# 查看日志
journalctl -u dnd-backend -f      # 后端日志
pm2 logs dnd-frontend             # 前端日志

# 健康检查
curl http://localhost:8174/api/health
```

## 首次部署设置

### 1. 创建目录结构

```bash
ssh deepwood-prod
mkdir -p /root/dnd/{backend,frontend}
```

### 2. 设置 Python 虚拟环境

```bash
cd /root/dnd/backend
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt

# 安装额外依赖（requirements.txt 中可能未列出）
pip install Pillow bcrypt pgvector 'pydantic[email]' livekit-api
```

### 3. 创建数据库

```bash
# 创建 D&D 数据库和用户
sudo -u postgres psql <<EOF
CREATE USER dnd_user WITH PASSWORD 'your_password';
CREATE DATABASE dnd_production OWNER dnd_user;
GRANT ALL PRIVILEGES ON DATABASE dnd_production TO dnd_user;

-- 连接到新数据库并创建扩展
\c dnd_production
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "vector";  -- 用于 embedding 向量搜索
EOF

# ⚠️ 授权 dnd_user 只读访问 schloss_production（用于认证）
sudo -u postgres psql -d schloss_production <<EOF
-- 只授予 SELECT 权限，不能修改！
GRANT CONNECT ON DATABASE schloss_production TO dnd_user;
GRANT USAGE ON SCHEMA public TO dnd_user;
GRANT SELECT ON TABLE users TO dnd_user;
EOF
```

> ⚠️ **重要提醒**:
>
> - `schloss_production` 是现有的 Schloss 认证系统，**有正在使用的数据**
> - D&D 项目**只读取** `schloss_production.users` 表进行登录验证
> - **绝对不要修改** `schloss_production` 的任何数据！

### 3.5 首次数据库迁移（全新数据库）

> ⚠️ **仅适用于全新数据库**：如果是增量部署，直接使用 `alembic upgrade head`。

由于项目的 alembic 迁移是增量式的，全新数据库需要先从 SQLAlchemy 模型创建表，再标记 alembic 版本：

```bash
cd /root/dnd/backend
source venv/bin/activate

# 1. 从 SQLAlchemy 模型创建所有表
python -c "
import asyncio
from app.db.session import Base, engine
from app.models import *

async def create_tables():
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    print('Tables created successfully')

asyncio.run(create_tables())
"

# 2. 标记 alembic 为最新版本
alembic stamp head
```

### 4. 设置 PM2

```bash
cd /root/dnd/frontend
npm install --production

# 使用 remix-serve 启动，指定端口 5174
PORT=5174 pm2 start ./node_modules/.bin/remix-serve --name dnd-frontend -- ./build/server/index.js
pm2 save
pm2 startup  # 设置开机自启
```

### 5. 启用 systemd 服务

```bash
systemctl daemon-reload
systemctl enable dnd-backend
systemctl start dnd-backend
```

### 6. 配置 Nginx

```bash
ln -s /etc/nginx/sites-available/dnd /etc/nginx/sites-enabled/
nginx -t
systemctl reload nginx
```

## 端口冲突处理

### 后端端口 8174 冲突

```bash
systemctl stop dnd-backend
fuser -k 8174/tcp
sleep 2
systemctl start dnd-backend
```

### 前端端口 5174 冲突

```bash
pm2 stop dnd-frontend
pm2 delete dnd-frontend
fuser -k 5174/tcp
sleep 2
cd /root/dnd/frontend
PORT=5174 pm2 start ./node_modules/.bin/remix-serve --name dnd-frontend -- ./build/server/index.js
pm2 save
```

## 数据库

- **类型**: PostgreSQL
- **连接**: 通过 DATABASE_URL 环境变量配置
- **备份**: 定期备份存放在 `/root/dnd/backups/` 目录

### 数据库备份

```bash
# 手动备份
pg_dump -U postgres dnd_production > /root/dnd/backups/dnd_$(date +%Y%m%d_%H%M%S).sql

# 自动备份 (crontab)
0 3 * * * pg_dump -U postgres dnd_production > /root/dnd/backups/dnd_$(date +\%Y\%m\%d).sql
```

### 版本要求

| 组件 | 本地开发 | 生产环境 |
|------|----------|----------|
| PostgreSQL | 15+ | 12+ |
| Python | 3.11+ | 3.11+ |
| Node.js | 20+ | 20+ |

## 常见问题

### Q: 后端服务启动失败

检查端口是否被占用，使用上述端口冲突处理命令。查看日志：

```bash
journalctl -u dnd-backend -n 50
```

### Q: 前端页面不更新

确认 `build` 目录已正确上传，并使用 `pm2 restart dnd-frontend` 重启服务。

### Q: WebSocket 连接失败

1. **确认使用 `ws.deepwood.cn` 子域名**（不是 `www.deepwood.cn`）
2. 检查 DNS：`dig ws.deepwood.cn` 应直接解析到服务器 IP
3. 检查 Nginx 配置中 `ws.deepwood.cn` 的 server block
4. 确认 location 路径有**尾部斜杠**：`/dnd/ws/` 不是 `/dnd/ws`
5. SSL 证书是否覆盖 `ws.deepwood.cn`

**调试命令：**

```bash
# 测试 WebSocket 握手
curl -i -N \
  -H "Connection: Upgrade" \
  -H "Upgrade: websocket" \
  -H "Sec-WebSocket-Version: 13" \
  -H "Sec-WebSocket-Key: test" \
  https://ws.deepwood.cn/dnd/ws/1

# 查看 Nginx 日志
tail -f /var/log/nginx/access.log | grep ws.deepwood
```

### Q: WebSocket 连接后立即断开

**可能原因：**

- 走了 CDN（CDN 会断开长连接）→ 确认用 `ws.deepwood.cn`
- Nginx `proxy_read_timeout` 太短 → 应设为 `86400`（24小时）

### Q: API 返回 502

检查后端服务是否正常运行：

```bash
curl http://localhost:8174/api/health
systemctl status dnd-backend
```

### Q: 模组上传失败 (413 错误)

增大 Nginx 的 `client_max_body_size`：

```nginx
client_max_body_size 100M;
```

## 静态资源（图片）管理

### 架构说明

项目采用**双态资源架构**：本地开发使用本地图片，生产环境使用阿里云 OSS。

```
┌─────────────────────────────────────────────────────────────┐
│                    静态资源架构                              │
├─────────────────────────────────────────────────────────────┤
│  开发环境 (npm run dev)                                      │
│  └─ getAssetUrl('assets/spell-icons/fireball.png')          │
│     → /assets/spell-icons/fireball.png (本地文件)            │
├─────────────────────────────────────────────────────────────┤
│  生产环境 (npm run build)                                    │
│  └─ getAssetUrl('assets/spell-icons/fireball.png')          │
│     → https://deepwood.oss.../dnd-static/...fireball.webp   │
└─────────────────────────────────────────────────────────────┘
```

### 资源目录结构

```
frontend/public/
├── assets/
│   ├── spell-icons/      # 法术图标 (~500个)
│   ├── equipment-icons/  # 装备图标 (~300个)
│   ├── god-icons/        # 神祇图标
│   ├── skill-icons/      # 技能图标
│   ├── condition-icons/  # 状态图标
│   ├── ability-icons/    # 能力图标
│   └── ui/               # UI 元素
├── images/
│   ├── classes/          # 职业图片
│   ├── races/            # 种族图片
│   ├── monsters/         # 怪物图片
│   └── ui/               # UI 图片
├── music/                # 背景音乐
├── oss-asset-mapping.json  # ⚠️ OSS URL 映射表（必须包含）
├── bg-dragon.jpg
├── bg-tavern.jpg
└── logo.svg
```

### 关键文件

| 文件 | 作用 |
|------|------|
| `frontend/app/utils/asset-url.ts` | 统一的资源 URL 解析工具 |
| `frontend/public/oss-asset-mapping.json` | 本地路径 → OSS URL 映射表 |
| `backend/scripts/upload_static_assets_to_oss.py` | 上传静态资源到 OSS 的脚本 |

### URL 解析逻辑

```typescript
// frontend/app/utils/asset-url.ts
const USE_OSS = import.meta.env.PROD;  // 生产环境自动启用 OSS

export function getAssetUrl(localPath: string): string {
  if (USE_OSS && mapping[localPath]) {
    return mapping[localPath];  // 返回 OSS URL
  }
  return `/${localPath}`;  // 返回本地路径
}
```

### ⚠️ 部署注意事项

> **重要**: 生产环境图片来自 OSS，**部署时不要上传图片目录**！

**原因**：
1. 图片文件体积大（约 500MB+），上传耗时且浪费带宽
2. 生产环境通过 `oss-asset-mapping.json` 引用 OSS 图片
3. 服务器不需要本地图片文件

**必须包含的文件**：
- `oss-asset-mapping.json` - OSS URL 映射表，**必须上传**

**不需要上传的目录**：
- `public/assets/` - 所有图标图片
- `public/images/` - 所有图片
- `public/music/` - 背景音乐（如果也在 OSS）

### OSS 资源更新流程

当本地新增或修改图片时，需要同步到 OSS：

```bash
# 1. 在本地运行上传脚本
cd backend
source venv/bin/activate
python scripts/upload_static_assets_to_oss.py

# 2. 脚本会自动：
#    - 将 PNG/JPG 转换为 WebP 格式
#    - 计算文件 hash 生成唯一文件名
#    - 上传到 OSS 的 dnd-static/ 目录
#    - 更新 frontend/public/oss-asset-mapping.json

# 3. 提交更新后的映射文件
cd ../frontend
git add public/oss-asset-mapping.json
git commit -m "chore: update OSS asset mapping"
```

### OSS 路径规范

| 资源类型 | OSS 路径前缀 |
|----------|-------------|
| 静态资源（图标等） | `dnd-static/assets/...` |
| 动态头像（怪物/物品） | `dnd-avatars/{type}/{date}/...` |
| 模组图片 | `dnd-modules/{module_id}/images/...` |
| 地图图片 | `dnd-maps/{date}/...` |

## 注意事项

- 部署完成后记得将修改提交 git
- 大型 PDF 模组上传可能需要较长时间，注意超时设置
- AI 服务需要有效的 API Key，否则相关功能不可用
- 生产环境密钥不要提交到代码仓库
- **部署前端时不要上传图片目录**，生产环境使用 OSS 图片