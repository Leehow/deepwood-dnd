# D&D Platform 部署计划

> 创建时间: 2026-01-21
> 状态: 待执行

## 生产环境现状

### 服务器信息
| 项目 | 值 |
|------|-----|
| IP | 60.205.209.95 |
| OS | Ubuntu 24.04 (kernel 6.8.0) |
| 内存 | 14GB (可用 13GB) |
| 磁盘 | 99GB (可用 57GB) |
| Python | 3.12.3 |
| Node.js | 20.19.5 |
| PostgreSQL | **18.1** (比文档中的 12 新很多) |

### 已占用端口
| 端口 | 服务 |
|------|------|
| 3010 | chatlab-frontend (PM2) |
| 3011 | schloss-frontend (systemd) |
| 8010 | chatlab-backend (systemd) |
| 8011 | schloss-backend (systemd) |
| 5432 | PostgreSQL |
| **5174** | **空闲 ✓** |
| **8174** | **空闲 ✓** |

### 现有数据库
- `chatlab_production` (owner: chatlab)
- `schloss_production` (owner: schloss)

### SSL 证书
- 主域名: `/root/cer/20540365_deepwood/deepwood.cn.pem`
- WebSocket: `/root/cer/ws_deepwood/ws.deepwood.cn.pem`

---

## 部署步骤

### 阶段 1: 服务器准备

#### 1.1 创建目录结构
```bash
ssh deepwood-prod
mkdir -p /root/dnd/{backend,frontend,backups,logs}
```

#### 1.2 创建数据库

```bash
# 创建 D&D 数据库和用户
sudo -u postgres psql <<EOF
CREATE USER dnd_user WITH PASSWORD 'your_secure_password';
CREATE DATABASE dnd_production OWNER dnd_user;
GRANT ALL PRIVILEGES ON DATABASE dnd_production TO dnd_user;

-- 连接到新数据库并创建扩展
\c dnd_production
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
EOF

# ⚠️ 单独执行：授权 dnd_user 只读访问 schloss_production（用于认证）
sudo -u postgres psql -d schloss_production <<EOF
-- 只授予 SELECT 权限，不能修改！
GRANT CONNECT ON DATABASE schloss_production TO dnd_user;
GRANT USAGE ON SCHEMA public TO dnd_user;
GRANT SELECT ON TABLE users TO dnd_user;
EOF
```

> ⚠️ **重要提醒**:
> - `schloss_production` 是现有的 Schloss 认证系统，**有正在使用的数据**
> - D&D 项目**只读取** `schloss_production.users` 表进行登录验证
> - **绝对不要修改** `schloss_production` 的任何数据！
> - 用户数据（角色、战役等）存储在 `dnd_production`，与 Schloss 完全隔离

#### 1.3 创建 Python 虚拟环境
```bash
cd /root/dnd/backend
python3 -m venv venv
source venv/bin/activate
pip install --upgrade pip
```

---

### 阶段 2: 环境配置

#### 2.0 LiveKit 语音服务器

> ✅ **LiveKit 已在生产环境配置完成**，无需额外操作。

| 配置项 | 值 |
|--------|-----|
| 状态 | 运行中 (systemd: `livekit.service`) |
| HTTP 端口 | 7880 |
| WebRTC TCP | 7881 |
| RTC UDP | 50000-60000 |
| TURN 域名 | voice.deepwood.cn |
| API Key | `APIKeyDND` |
| API Secret | `DND_Voice_Secret_2024_Secure` |
| Nginx 路由 | `ws.deepwood.cn/livekit/` → `127.0.0.1:7880` |

后端 `.env` 配置（与现有配置匹配）：
```env
LIVEKIT_API_KEY=APIKeyDND
LIVEKIT_API_SECRET=DND_Voice_Secret_2024_Secure
LIVEKIT_URL=wss://ws.deepwood.cn/livekit
```

#### 2.1 后端环境变量 `/root/dnd/.env`
```env
# Database
DATABASE_URL=postgresql+asyncpg://dnd_user:your_secure_password@localhost/dnd_production

# Resterlab Authentication (Schloss)
RESTERLAB_DATABASE_URL=postgresql://dnd_user:your_secure_password@localhost/schloss_production

# Security
SECRET_KEY=生成一个安全的密钥

# AI Services (从本地 .env 复制)
CST_API_KEY=xxx
CST_API_URL=https://api.cstcloud.cn/v1
QWEN_API_KEY=xxx
INFINI_API_KEY=xxx
DOC2X_API_KEY=xxx
TUZI_API_KEY=xxx
MISTRAL_API_KEY=xxx

# OSS
OSS_ACCESS_KEY_ID=xxx
OSS_ACCESS_KEY_SECRET=xxx
OSS_BUCKET_NAME=xxx
OSS_ENDPOINT=xxx

# LiveKit 语音聊天
LIVEKIT_API_KEY=your_livekit_api_key
LIVEKIT_API_SECRET=your_livekit_api_secret
LIVEKIT_URL=wss://ws.deepwood.cn/livekit
```

#### 2.2 前端环境变量 `/root/dnd/frontend/.env`
```env
VITE_API_URL=/dnd/api
VITE_WS_URL=wss://ws.deepwood.cn/dnd/ws
```

---

### 阶段 3: Nginx 配置

#### 3.1 添加到 `/etc/nginx/sites-enabled/deepwood`

在 `www.deepwood.cn` server block 中添加：

```nginx
    # ============ D&D Platform ============

    # D&D Frontend
    location /dnd/ {
        proxy_pass http://127.0.0.1:5174/;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # 禁用 HTML 缓存
        add_header Cache-Control "no-cache, no-store, must-revalidate" always;
        add_header Pragma "no-cache" always;
    }

    # D&D API
    location ^~ /dnd/api/ {
        proxy_pass http://127.0.0.1:8174/api/;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # 文件上传限制
        client_max_body_size 100M;

        # SSE 流式响应
        proxy_buffering off;
        proxy_cache off;
        proxy_set_header X-Accel-Buffering no;
        proxy_read_timeout 1800s;
    }
```

#### 3.2 添加到 `ws.deepwood.cn` server block

```nginx
    # D&D Platform WebSocket
    location /dnd/ws/ {
        proxy_pass http://127.0.0.1:8174/ws/;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 86400;
    }
```

#### 3.3 验证并重载 Nginx
```bash
nginx -t && systemctl reload nginx
```

---

### 阶段 4: Systemd 服务配置

#### 4.1 创建后端服务 `/etc/systemd/system/dnd-backend.service`
```ini
[Unit]
Description=DnD Platform Backend
After=network.target postgresql.service

[Service]
Type=simple
User=root
WorkingDirectory=/root/dnd/backend
Environment="PATH=/root/dnd/backend/venv/bin"
EnvironmentFile=/root/dnd/.env
ExecStart=/root/dnd/backend/venv/bin/python -m uvicorn app.main:app --host 127.0.0.1 --port 8174
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
```

#### 4.2 启用服务
```bash
systemctl daemon-reload
systemctl enable dnd-backend
```

---

### 阶段 5: 代码部署

#### 5.1 后端部署
```bash
# 本地执行
cd /Users/haoli/leehow/code/dw/backend
tar --exclude='venv' --exclude='__pycache__' --exclude='*.pyc' \
    --exclude='.pytest_cache' --exclude='htmlcov' \
    -czf ../backend.tar.gz app alembic alembic.ini requirements.txt

scp ../backend.tar.gz deepwood-prod:/root/dnd/
rm ../backend.tar.gz

# 服务器执行
ssh deepwood-prod "cd /root/dnd && tar -xzf backend.tar.gz -C backend && rm backend.tar.gz"
ssh deepwood-prod "cd /root/dnd/backend && source venv/bin/activate && pip install -r requirements.txt"
```

#### 5.2 数据库迁移
```bash
ssh deepwood-prod "cd /root/dnd/backend && source venv/bin/activate && alembic upgrade head"
```

#### 5.3 启动后端
```bash
ssh deepwood-prod "systemctl start dnd-backend && systemctl status dnd-backend"
```

#### 5.4 前端部署
```bash
# 本地执行
cd /Users/haoli/leehow/code/dw/frontend
rm -rf build
npm run build
tar -czf ../frontend-build.tar.gz build package.json package-lock.json

scp ../frontend-build.tar.gz deepwood-prod:/root/dnd/frontend/
rm ../frontend-build.tar.gz

# 服务器执行
ssh deepwood-prod "cd /root/dnd/frontend && tar -xzf frontend-build.tar.gz && rm frontend-build.tar.gz && npm install --production"
ssh deepwood-prod "cd /root/dnd/frontend && PORT=5174 pm2 start ./build/server/index.js --name dnd-frontend && pm2 save"
```

---

### 阶段 6: 验证

#### 6.1 健康检查
```bash
# 后端 API
curl http://localhost:8174/api/health

# 前端
curl -I https://www.deepwood.cn/dnd/

# WebSocket (握手测试)
curl -i -N \
  -H "Connection: Upgrade" \
  -H "Upgrade: websocket" \
  -H "Sec-WebSocket-Version: 13" \
  -H "Sec-WebSocket-Key: test" \
  https://ws.deepwood.cn/dnd/ws/1
```

#### 6.2 日志检查
```bash
journalctl -u dnd-backend -f    # 后端日志
pm2 logs dnd-frontend           # 前端日志
```

---

## 检查清单

### 部署前
- [ ] 本地测试通过
- [ ] 确认所有 API Key 有效
- [ ] 备份生产数据库（如有）

### 阶段 1: 服务器准备
- [ ] 创建目录 `/root/dnd/`
- [ ] 创建数据库 `dnd_production`
- [ ] 创建 Python 虚拟环境

### 阶段 2: 环境配置
- [x] LiveKit 已配置完成 ✅
- [ ] 创建 `/root/dnd/.env`
- [ ] 创建 `/root/dnd/frontend/.env`

### 阶段 3: Nginx
- [ ] 添加 `/dnd/*` 路由到 www.deepwood.cn
- [ ] 添加 `/dnd/ws/*` 路由到 ws.deepwood.cn
- [x] `/livekit/*` 已配置在 ws.deepwood.cn ✅
- [ ] `nginx -t` 验证通过
- [ ] `systemctl reload nginx`

### 阶段 4: Systemd
- [ ] 创建 `dnd-backend.service`
- [ ] `systemctl enable dnd-backend`

### 阶段 5: 代码部署
- [ ] 上传后端代码
- [ ] 安装后端依赖
- [ ] 运行数据库迁移
- [ ] 启动后端服务
- [ ] 上传前端代码
- [ ] 安装前端依赖
- [ ] PM2 启动前端

### 阶段 6: 验证
- [ ] 后端 API 响应正常
- [ ] 前端页面加载正常
- [ ] WebSocket 连接正常
- [ ] 用户登录功能正常
- [ ] 战役创建功能正常
- [ ] 语音聊天功能正常（LiveKit 连接）

---

## 回滚计划

如果部署失败：

```bash
# 停止服务
systemctl stop dnd-backend
pm2 stop dnd-frontend

# 删除 Nginx 配置中的 /dnd 相关部分
vim /etc/nginx/sites-enabled/deepwood
nginx -t && systemctl reload nginx

# 可选：删除目录
rm -rf /root/dnd

# 可选：删除数据库
sudo -u postgres psql -c "DROP DATABASE dnd_production;"
sudo -u postgres psql -c "DROP USER dnd_user;"
```

---

## 注意事项

1. **PostgreSQL 版本**: 生产环境是 18.1，比文档中的 12 新很多，兼容性应该没问题

2. **WebSocket 子域名**: 必须使用 `ws.deepwood.cn`，SSL 证书已存在

3. **端口选择**: 使用 5174/8174 与本地开发一致，便于调试

4. **首次部署**: 需要创建测试用户和初始数据
