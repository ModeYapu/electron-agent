# Electron Agent Console — 部署文档

## 一、系统架构

```
                    ┌──────────────────────────────────────┐
                    │          Nginx (HTTPS 反代)           │
                    │  /          → web-console 静态文件     │
                    │  /api/*     → relay-server :9300      │
                    │  /ws        → relay-server :9300 (WS) │
                    └────┬──────────────┬───────────────────┘
                         │              │
              ┌──────────▼──┐   ┌──────▼──────────────┐
              │ web-console │   │   relay-server      │
              │ (Vue3 SPA)  │   │   Node.js :9300     │
              │ 静态文件     │   │   HTTP + WebSocket  │
              └─────────────┘   │   + ffmpeg 录屏     │
                                └──────┬──────────────┘
                                       │ WebSocket
                          ┌────────────┼────────────┐
                          ▼            ▼            ▼
                    ┌──────────┐ ┌──────────┐ ┌──────────┐
                    │ Electron │ │ Electron │ │ Electron │
                    │ Client 1 │ │ Client 2 │ │ Client N │
                    │ (被控端)  │ │          │ │          │
                    └──────────┘ └──────────┘ └──────────┘
```

### 组件说明

| 组件 | 技术栈 | 端口 | 说明 |
|------|--------|------|------|
| **relay-server** | Node.js + Express + ws | 9300 | 中继服务器：设备注册、命令转发、认证、录屏管理 |
| **web-console** | Vue 3 + Vite + Element Plus | 静态 | 管理端 SPA：设备列表、远程操控、审计日志、录屏回放 |
| **electron-client** | Electron + CDP | 桌面应用 | 被控端：加载 H5 页面，通过 WebSocket 接收指令并执行 |
| **shared** | TypeScript 库 | - | 协议定义（命令/消息类型、设备信息结构） |
| **agent-core** | TypeScript 库 | - | Agent 核心：CDP 指令执行器、设备指纹、权限管理 |

---

## 二、服务器资源要求

### 2.1 最低配置

| 资源 | 最低 | 推荐 |
|------|------|------|
| **CPU** | 2 核 | 4 核+ |
| **内存** | 2 GB | 4 GB+ |
| **磁盘** | 20 GB | 50 GB+ (录屏文件会增长) |
| **操作系统** | Linux (Ubuntu 20.04+ / Debian 11+) 或 Windows Server 2019+ |
| **网络** | 固定 IP 或域名，管理端和 Agent 均需可达 |

### 2.2 录屏存储估算

| 分辨率 | 帧率 | 时长 | 单帧大小(JPEG) | 总大小(估算) |
|--------|------|------|---------------|-------------|
| 1920×1080 | 2 fps | 10 分钟 | ~100 KB | ~120 MB |
| 1920×1080 | 2 fps | 1 小时 | ~100 KB | ~720 MB |

录屏完成后 ffmpeg 编译为 H.264 MP4（压缩比约 15-30:1），10 分钟录屏最终约 5-8 MB。

---

## 三、依赖项

### 3.1 系统依赖

| 依赖 | 版本要求 | 用途 | 安装方式 |
|------|---------|------|---------|
| **Node.js** | ≥ 22.0.0 | 运行时 | 见下方 |
| **npm** | ≥ 10.x | 包管理 | 随 Node.js |
| **ffmpeg** | ≥ 4.x | 录屏视频合成 (H.264 编码) | `apt install ffmpeg` |
| **nginx** | ≥ 1.18 | 反向代理 + 静态文件 | `apt install nginx` |
| **git** | ≥ 2.x | 源码克隆 | `apt install git` |

#### 安装 Node.js 22+ (Ubuntu/Debian)

```bash
# 使用 NodeSource 官方源
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs

# 验证
node --version   # ≥ v22.0.0
npm --version    # ≥ 10.x
```

#### 安装 ffmpeg

```bash
sudo apt-get update
sudo apt-get install -y ffmpeg

# 验证
ffmpeg -version | head -1   # ≥ 4.x
```

**注意**：ffmpeg 必须是系统级的可执行文件（在 `$PATH` 中），relay-server 通过 `child_process.execFile('ffmpeg', [...])` 调用。某些精简版 Linux 发行版可能需要启用额外软件源才能获取（如 EPEL）。确认支持 `libx264` 编码器：

```bash
ffmpeg -encoders 2>/dev/null | grep libx264
# 期望输出: V..... libx264  libx264 H.264 / AVC / MPEG-4 AVC ...
```

### 3.2 npm 依赖（自动安装）

项目通过 monorepo 管理，`npm install` 时自动安装所有子包的依赖：

**relay-server 核心依赖**:
- `express` 4.x — HTTP 框架
- `ws` 8.x — WebSocket 服务端
- `jsonwebtoken` 9.x — JWT 认证
- `cors` 2.x — 跨域支持
- `express-rate-limit` 7.x — 登录频率限制
- `dotenv` 17.x — 环境变量加载

**构建工具**:
- `typescript` 5.9.x
- `tsx` 4.x — 开发模式运行（`tsx watch`）

---

## 四、部署步骤

### 4.1 克隆项目

```bash
git clone <repo-url> /opt/electron-agent
cd /opt/electron-agent
```

### 4.2 安装依赖并构建

```bash
# 安装所有依赖 (monorepo)
npm install

# 全量构建 (按依赖顺序: shared → agent-core → relay-server → web-console)
npm run build
```

> **构建顺序**：shared（协议库）→ agent-core（执行器）→ relay-server（服务端）→ web-console（前端 SPA）。
> `npm run build` 已配置为按 workspace 顺序构建。

#### 各子包构建产物

| 子包 | 构建命令 | 产物 |
|------|---------|------|
| `packages/shared` | `tsc` | `dist/` (JS + .d.ts) |
| `packages/agent-core` | `tsc` | `dist/` (JS + .d.ts) |
| `apps/relay-server` | `tsc` | `dist/` (Node.js 可执行) |
| `apps/web-console` | `vite build` | `dist/` (静态 HTML/JS/CSS) |
| `apps/electron-client` | `tsc + electron-builder` | `build/*.exe` (仅 Windows 需要) |

> **注意**：`electron-client` 只在需要构建被控端安装包时编译，服务器部署**不需要**构建 electron-client。

### 4.3 配置 relay-server

创建环境变量文件：

```bash
# 创建 .env 文件
cat > apps/relay-server/.env << 'EOF'
# ========== 必需配置 ==========
NODE_ENV=production
PORT=9300

# ========== 认证凭据 (生产环境必须设置，否则启动失败) ==========
# Agent 连接令牌 — Electron Client 与此 token 匹配才能连接
AGENT_TOKEN=your-agent-token-here-change-me

# 管理后台用户名
ADMIN_USERNAME=admin

# 管理后台密码 — 登录 web-console 使用
ADMIN_PASSWORD=your-admin-password-change-me

# 管理员 API Token — 备用认证方式
ADMIN_TOKEN=your-admin-token-change-me

# JWT 签名密钥 — 用于生成和验证登录 token
JWT_SECRET=your-jwt-secret-change-me-min-32-chars
EOF
```

**⚠️ 生产环境安全要求**：
- **必须**设置所有 5 个凭据变量（`AGENT_TOKEN`、`ADMIN_PASSWORD`、`ADMIN_TOKEN`、`JWT_SECRET`）
- 所有凭据使用 `openssl rand -hex 32` 生成强随机值
- `.env` 文件权限设为 `600`（`chmod 600 apps/relay-server/.env`）
- 切勿将 `.env` 提交到版本控制

### 4.4 配置 web-console 生产环境变量

```bash
cat > apps/web-console/.env.production << 'EOF'
# 生产环境：API 和 WebSocket 地址
# 当 web-console 和 relay-server 同机部署时使用 localhost
# 分离部署时改为 relay-server 所在服务器的 IP/域名
VITE_API_URL=http://localhost:9300
VITE_WS_URL=ws://localhost:9300/ws
EOF
```

> **注意**：这两个变量在 `vite build` 时编译进 JS 产物，而非运行时读取。
> 如果 relay-server 在不同服务器上，修改这里的地址后**必须重新构建 web-console**。

### 4.5 配置 Electron Client（被控端）

在 `apps/electron-client/config.default.json` 中配置：

```json
{
  "serverUrl": "ws://<relay-server-ip>:9300/ws",
  "agentToken": "your-agent-token-here-change-me",
  "h5Url": "https://your-h5-app.example.com/#/index"
}
```

| 字段 | 说明 |
|------|------|
| `serverUrl` | relay-server 的 WebSocket 地址，Agent 启动后连接此地址 |
| `agentToken` | 必须与 relay-server `.env` 中的 `AGENT_TOKEN` 一致 |
| `h5Url` | Electron 客户端加载的远程 H5 页面 URL |

构建 Electron 客户端安装包：

```bash
# Windows
cd apps/electron-client
npx electron-builder --win

# macOS
npx electron-builder --mac

# Linux
npx electron-builder --linux
```

---

## 五、Nginx 配置

### 5.1 完整配置示例

```nginx
# /etc/nginx/sites-available/electron-agent
server {
    listen 80;
    server_name your-domain.com;

    # 强制 HTTPS (推荐)
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    server_name your-domain.com;

    # ========== SSL 证书 ==========
    ssl_certificate     /etc/nginx/ssl/your-domain.crt;
    ssl_certificate_key /etc/nginx/ssl/your-domain.key;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;

    # ========== 日志 ==========
    access_log /var/log/nginx/electron-agent.access.log;
    error_log  /var/log/nginx/electron-agent.error.log;

    # ========== 客户端最大请求体 ==========
    client_max_body_size 100M;

    # ========== web-console 静态文件 ==========
    root /opt/electron-agent/apps/web-console/dist;
    index index.html;

    # SPA fallback: 所有非文件路径返回 index.html
    location / {
        try_files $uri $uri/ /index.html;
    }

    # ========== API 代理到 relay-server ==========
    location /api/ {
        proxy_pass http://127.0.0.1:9300;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # 录屏视频下载可能较大，关闭缓冲
        proxy_buffering off;
        proxy_read_timeout 300s;
    }

    # ========== WebSocket 代理到 relay-server ==========
    location /ws {
        proxy_pass http://127.0.0.1:9300;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # WebSocket 超时：1 小时无活动断开
        proxy_read_timeout 3600s;
        proxy_send_timeout 3600s;
    }

    # ========== 健康检查端点 (无需认证) ==========
    location /health {
        proxy_pass http://127.0.0.1:9300;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
    }

    # ========== 安全加固 ==========
    # 隐藏 Nginx 版本
    server_tokens off;

    # 安全头
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-XSS-Protection "1; mode=block" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;
}
```

### 5.2 启用站点

```bash
sudo ln -s /etc/nginx/sites-available/electron-agent /etc/nginx/sites-enabled/
sudo nginx -t          # 测试配置
sudo systemctl reload nginx
```

### 5.3 仅内网部署（无 SSL）

如果仅在内网使用，可以只用 HTTP：

```nginx
server {
    listen 80;
    server_name _;

    root /opt/electron-agent/apps/web-console/dist;
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;
    }

    location /api/ {
        proxy_pass http://127.0.0.1:9300;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_buffering off;
        proxy_read_timeout 300s;
    }

    location /ws {
        proxy_pass http://127.0.0.1:9300;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_read_timeout 3600s;
        proxy_send_timeout 3600s;
    }
}
```

---

## 六、进程管理

### 6.1 systemd 服务 (推荐)

创建 systemd service 文件：

```bash
sudo cat > /etc/systemd/system/electron-agent-relay.service << 'EOF'
[Unit]
Description=Electron Agent Relay Server
After=network.target

[Service]
Type=simple
User=www-data
WorkingDirectory=/opt/electron-agent/apps/relay-server
Environment=NODE_ENV=production
ExecStart=/usr/bin/node dist/index.js
Restart=always
RestartSec=5

# 安全加固
NoNewPrivileges=yes
PrivateTmp=yes
ProtectSystem=strict
ProtectHome=yes
ReadWritePaths=/opt/electron-agent/apps/relay-server/recordings

[Install]
WantedBy=multi-user.target
EOF
```

启动服务：

```bash
sudo systemctl daemon-reload
sudo systemctl enable electron-agent-relay
sudo systemctl start electron-agent-relay
sudo systemctl status electron-agent-relay
```

### 6.2 查看日志

```bash
# systemd 日志
sudo journalctl -u electron-agent-relay -f

# 应用日志（nginx）
sudo tail -f /var/log/nginx/electron-agent.access.log
sudo tail -f /var/log/nginx/electron-agent.error.log
```

### 6.3 PM2 进程管理 (备选)

```bash
npm install -g pm2

# 启动
pm2 start apps/relay-server/dist/index.js \
    --name electron-agent-relay \
    --cwd apps/relay-server

# 开机自启
pm2 save
pm2 startup

# 查看状态
pm2 status
pm2 logs electron-agent-relay
```

---

## 七、录屏数据管理

### 7.1 目录结构

```
apps/relay-server/recordings/
├── <deviceId>_<timestamp>/
│   ├── frame_00001.jpg
│   ├── frame_00002.jpg
│   └── output.mp4
└── <deviceId>_<timestamp>/
    └── ...
```

### 7.2 自动清理 (cron)

录屏帧文件（JPEG）在 ffmpeg 编译完成后不会自动删除，建议配置定时清理：

```bash
# 每天凌晨 3 点清理 7 天前的录屏目录
cat > /etc/cron.daily/cleanup-recordings << 'EOF'
#!/bin/bash
RECORDINGS_DIR=/opt/electron-agent/apps/relay-server/recordings
find "$RECORDINGS_DIR" -mindepth 1 -maxdepth 1 -type d -mtime +7 -exec rm -rf {} \;
EOF

chmod +x /etc/cron.daily/cleanup-recordings
```

### 7.3 磁盘监控

建议配置磁盘使用率告警：

```bash
# 录屏目录超过 80% 磁盘使用率时告警
df -h /opt/electron-agent/apps/relay-server/recordings | \
    awk 'NR==2 {gsub(/%/,""); if($5>80) print "WARNING: recording disk usage at " $5 "%"}'
```

---

## 八、验证部署

### 8.1 健康检查

```bash
# relay-server
curl http://localhost:9300/health
# 期望: {"status":"ok","uptime":...}

# 通过 nginx
curl https://your-domain.com/health
# 期望: {"status":"ok","uptime":...}
```

### 8.2 登录测试

```bash
curl -X POST https://your-domain.com/api/login \
    -H "Content-Type: application/json" \
    -d '{"username":"admin","password":"your-admin-password"}'
# 期望: {"token":"eyJhbG...","expiresIn":...}
```

### 8.3 WebSocket 测试

```bash
# 安装 wscat
npm install -g wscat

# 连接测试 (使用 ADMIN_TOKEN)
wscat -c "wss://your-domain.com/ws?token=your-admin-token"
# 连接成功后会收到: {"type":"server:connected","role":"admin",...}
```

### 8.4 管理端访问

浏览器打开 `https://your-domain.com`：
1. 使用 `admin` / `your-admin-password` 登录
2. 确认能看到"设备列表"页面（即使无设备在线也应显示空列表）
3. 在 Electron Client 上安装并启动，确认设备出现在列表中

---

## 九、常见问题

### Q: `JWT_SECRET` / 凭据未设置导致启动失败
```
FATAL: JWT_SECRET environment variable must be set in production
```
**解决**：检查 `apps/relay-server/.env` 是否创建且包含所有必需变量。

### Q: ffmpeg 找不到或缺少 libx264
```
Error: spawn ffmpeg ENOENT
```
**解决**：`sudo apt install ffmpeg`，确保 `ffmpeg` 在 `$PATH` 中。

### Q: WebSocket 连接失败
```
WebSocket connection to 'ws://...' failed
```
**排查**：
1. relay-server 是否运行：`curl http://localhost:9300/health`
2. nginx 是否代理 WebSocket：检查 `proxy_set_header Upgrade` 配置
3. Agent Token 是否匹配：检查 client 的 `agentToken` 与 server 的 `AGENT_TOKEN`

### Q: web-console 页面空白 / 404
**解决**：检查 nginx 配置中的 SPA fallback：`try_files $uri $uri/ /index.html;`

### Q: 端口冲突
```bash
# 查看 9300 端口占用
sudo lsof -i :9300
# 修改端口：编辑 .env 中的 PORT 变量 + nginx 配置中的 proxy_pass
```

---

## 十、升级流程

```bash
cd /opt/electron-agent
git pull

# 安装可能新增的依赖
npm install

# 重新构建
npm run build

# 重启服务
sudo systemctl restart electron-agent-relay

# 验证
curl http://localhost:9300/health
```

> **注意**：升级后需重新构建 web-console（如果前端代码有变更），并将新的 `dist/` 部署到 nginx。
> Electron Client 的升级需重新构建安装包并分发到各被控机器。
