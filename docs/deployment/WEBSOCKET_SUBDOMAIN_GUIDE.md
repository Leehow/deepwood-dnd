# WebSocket 专用子域名配置指南

## 概述

生产环境中，WebSocket 连接使用专用子域名 `ws.deepwood.cn` 而非主域名 `www.deepwood.cn`。这是为了**绕过 CDN**，因为大多数 CDN 不支持或不稳定支持 WebSocket 长连接。

## 架构说明

```
┌──────────────────────────────────────────────────────────┐
│                      DNS 配置                            │
├──────────────────────────────────────────────────────────┤
│  www.deepwood.cn  ──→  CDN  ──→  服务器 (60.205.209.95) │
│  deepwood.cn      ──→  CDN  ──→  服务器                  │
│                                                          │
│  ws.deepwood.cn   ──→  直接 A 记录 ──→  服务器           │
│  (绕过 CDN)                                              │
└──────────────────────────────────────────────────────────┘
```

## 前端实现

### 环境检测逻辑

所有 WebSocket composable 使用相同的判断逻辑：

```typescript
const hostname = window.location.hostname
const isProduction = hostname !== 'localhost' && hostname !== '127.0.0.1'

if (isProduction) {
    return `wss://ws.deepwood.cn/chat/api/ws/...`
} else {
    return `ws://localhost:8010/api/ws/...`
}
```

### 涉及的文件

| 文件 | 端点 | 生产 URL |
|------|------|----------|
| `useGroupChat.ts` | 群组聊天 | `wss://ws.deepwood.cn/chat/api/ws/groups/{id}` |
| `useFiles.ts` | 文件状态 | `wss://ws.deepwood.cn/chat/ws/files/status` |
| `useDocCollaboration.ts` | 文档协作 | `wss://ws.deepwood.cn/chat/api/ws/doc/{id}` |
| `useWhiteboardCollaboration.ts` | 白板协作 | `wss://ws.deepwood.cn/chat/api/ws/doc/{id}` |

## 服务端配置

### Nginx 配置要求

`ws.deepwood.cn` 需要单独的 server block：

```nginx
server {
    listen 443 ssl;
    server_name ws.deepwood.cn;

    ssl_certificate /path/to/cert.pem;
    ssl_certificate_key /path/to/key.pem;

    # WebSocket 代理 - 注意尾部斜杠
    location /chat/api/ws/ {
        proxy_pass http://127.0.0.1:8010/api/ws/;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_read_timeout 86400;  # 24小时
    }

    location /chat/ws/ {
        proxy_pass http://127.0.0.1:8010/ws/;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_read_timeout 86400;
    }
}
```

### 关键配置项

| 配置 | 说明 |
|------|------|
| `proxy_http_version 1.1` | WebSocket 需要 HTTP/1.1 |
| `Upgrade $http_upgrade` | 协议升级头 |
| `Connection "upgrade"` | 保持升级连接 |
| `proxy_read_timeout 86400` | 长连接超时（24小时） |
| **尾部斜杠** | `/chat/api/ws/` → `/api/ws/` 路径正确传递 |

---

## 开发注意事项

### 1. 新增 WebSocket 端点时

如果添加新的 WebSocket 功能，必须：

```typescript
// 正确方式：检测环境并使用专用子域名
const getWsUrl = () => {
  if (import.meta.client) {
    const hostname = window.location.hostname
    const isProduction = hostname !== 'localhost' && hostname !== '127.0.0.1'

    if (isProduction) {
      return `wss://ws.deepwood.cn/chat`  // 固定子域名
    }
  }

  // 开发环境
  const backendUrl = config.public.backendApiUrl || 'http://localhost:8010'
  return backendUrl.replace(/^http/, 'ws')
}
```

### 2. 不要使用动态域名拼接

```typescript
// 错误：不要这样做
const wsUrl = `wss://${window.location.host}/api/ws/...`

// 正确：生产环境使用固定子域名
const wsUrl = isProduction
  ? `wss://ws.deepwood.cn/chat/api/ws/...`
  : `ws://localhost:8010/api/ws/...`
```

### 3. 本地开发不受影响

本地开发时 `hostname` 为 `localhost` 或 `127.0.0.1`，会直接连接后端：

```
开发环境: ws://localhost:8010/api/ws/...
```

### 4. Nginx 路径斜杠问题

**常见错误**：

```nginx
# 错误：没有尾部斜杠会导致路径丢失
location /chat/api/ws {
    proxy_pass http://127.0.0.1:8010/api/ws;
}
# /chat/api/ws/groups/123 → /api/ws（路径丢失）

# 正确：加上尾部斜杠
location /chat/api/ws/ {
    proxy_pass http://127.0.0.1:8010/api/ws/;
}
# /chat/api/ws/groups/123 → /api/ws/groups/123
```

---

## 多项目共享注意事项

`ws.deepwood.cn` 子域名可能被多个项目共享。添加新的 WebSocket 路由时：

### 路径命名规范

```
/chat/api/ws/...     → ChatLab 项目
/schloss/api/ws/...  → Schloss 项目（如需要）
/其他项目/api/ws/... → 其他项目
```

### Nginx 配置隔离

每个项目使用独立的 location block：

```nginx
# ChatLab WebSocket
location /chat/api/ws/ {
    proxy_pass http://127.0.0.1:8010/api/ws/;
    # ...
}

# 其他项目 WebSocket（示例）
location /other/api/ws/ {
    proxy_pass http://127.0.0.1:9010/api/ws/;
    # ...
}
```

---

## 故障排查

### 问题 1: WebSocket 连接失败 (404)

**症状**: 浏览器控制台显示 WebSocket 404

**检查步骤**:
1. 确认 DNS `ws.deepwood.cn` 解析正确
2. 检查 Nginx 是否有 `ws.deepwood.cn` 的 server block
3. 确认 location 路径有尾部斜杠

### 问题 2: WebSocket 立即断开

**症状**: 连接成功但几秒后断开

**可能原因**:
- CDN 超时（确认走的是 `ws.deepwood.cn` 而非主域名）
- Nginx `proxy_read_timeout` 太短

### 问题 3: 开发环境正常，生产环境失败

**检查**:
1. 前端是否正确检测到生产环境
2. 是否使用了 `wss://ws.deepwood.cn` 而非主域名
3. SSL 证书是否覆盖 `ws.deepwood.cn`

### 调试命令

```bash
# 检查 DNS 解析
dig ws.deepwood.cn

# 测试 WebSocket 连接
curl -i -N \
  -H "Connection: Upgrade" \
  -H "Upgrade: websocket" \
  -H "Sec-WebSocket-Version: 13" \
  -H "Sec-WebSocket-Key: test" \
  https://ws.deepwood.cn/chat/api/ws/...

# 查看 Nginx 日志
tail -f /var/log/nginx/access.log | grep ws.deepwood
```

---

## 检查清单

新增 WebSocket 功能前，确认：

- [ ] 前端使用环境检测逻辑，生产环境指向 `wss://ws.deepwood.cn`
- [ ] 后端端点路径以 `/api/ws/` 或 `/ws/` 开头
- [ ] Nginx 配置了对应的 location block（带尾部斜杠）
- [ ] SSL 证书覆盖 `ws.deepwood.cn`
- [ ] 路径不与其他项目冲突
