# Electron Agent 部署指南

生产环境部署的完整指南，包括 Docker 部署、Nginx 反向代理配置、TLS 设置等。

## 📋 目录

- [Docker 部署](#docker-部署)
- [手动部署](#手动-部署)
- [Nginx 反向代理](#nginx-反向代理)
- [TLS 配置](#tls-配置)
- [环境变量配置](#环境变量配置)
- [安全检查清单](#安全检查清单)
- [监控与维护](#监控与维护)

## 🐳 Docker 部署

### 前置要求

- Docker 20.10+
- Docker Compose 2.0+
- 至少 2GB 可用内存
- 至少 10GB 可用磁盘空间

### 快速部署

1. **准备配置文件**
```bash
# 复制环境变量模板
cp .env.example .env

# 编辑配置文件
nano .env
```

2. **设置关键变量**
```bash
# 生成安全的 JWT_SECRET
JWT_SECRET=$(openssl rand -base64 32)
echo "JWT_SECRET=$JWT_SECRET" >> .env

# 设置管理员密码
ADMIN_PASSWORD=$(openssl rand -base64 16)
echo "ADMIN_PASSWORD=$ADMIN_PASSWORD" >> .env
```

3. **构建并启动服务**
```bash
# 构建镜像
docker-compose build

# 启动服务
docker-compose up -d

# 查看日志
docker-compose logs -f
```

4. **验证部署**
```bash
# 检查服务状态
docker-compose ps

# 检查健康状态
curl http://localhost:9300/health
curl http://localhost/health
```

### 高级配置

#### 自定义网络
```yaml
# docker-compose.override.yml
version: '3.8'

services:
  relay-server:
    networks:
      - electron-agent-network
      - custom-network

networks:
  custom-network:
    external: true
```

#### 资源限制
```yaml
services:
  relay-server:
    deploy:
      resources:
        limits:
          cpus: '2'
          memory: 1G
        reservations:
          cpus: '0.5'
          memory: 512M
```

#### 日志配置
```yaml
services:
  relay-server:
    logging:
      driver: "json-file"
      options:
        max-size: "10m"
        max-file: "3"
```

### 容器管理

```bash
# 查看日志
docker-compose logs relay-server
docker-compose logs web-console

# 重启服务
docker-compose restart relay-server

# 更新服务
docker-compose pull
docker-compose up -d

# 停止服务
docker-compose down

# 清理数据
docker-compose down -v
```

## 🔧 手动部署

### 系统要求

- Node.js 22+
- npm 10+
- 2GB+ RAM
- 10GB+ 磁盘空间

### 1. 安装系统依赖

#### Ubuntu/Debian
```bash
sudo apt update
sudo apt install -y nodejs npm nginx
```

#### CentOS/RHEL
```bash
sudo yum install -y nodejs npm nginx
```

#### macOS
```bash
brew install node npm nginx
```

### 2. 部署 Relay Server

```bash
# 克隆项目
git clone <repository-url>
cd electron-agent

# 安装依赖
npm install

# 构建项目
npm run build

# 配置环境变量
cp .env.example .env
nano .env

# 启动服务
cd apps/relay-server
npm run build
NODE_ENV=production PORT=9300 npm start
```

### 3. 部署 Web Console

```bash
# 构建静态文件
cd apps/web-console
npm run build

# 复制到 Nginx 目录
sudo cp -r dist /usr/share/nginx/html/electron-agent

# 配置 Nginx (见下一节)
```

### 4. 使用 PM2 管理进程

```bash
# 安装 PM2
npm install -g pm2

# 创建进程配置
cat > ecosystem.config.js << EOF
module.exports = {
  apps: [{
    name: 'electron-agent-relay',
    script: 'apps/relay-server/dist/index.js',
    instances: 2,
    exec_mode: 'cluster',
    env: {
      NODE_ENV: 'production',
      PORT: 9300
    },
    error_file: '/var/log/electron-agent/error.log',
    out_file: '/var/log/electron-agent/out.log',
    log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
    merge_logs: true,
    autorestart: true,
    max_restarts: 10,
    min_uptime: '10s'
  }]
};
EOF

# 启动服务
pm2 start ecosystem.config.js

# 保存进程列表
pm2 save

# 设置开机自启
pm2 startup
```

## 🌐 Nginx 反向代理

### 基础配置

```nginx
# /etc/nginx/sites-available/electron-agent
server {
    listen 80;
    server_name your-domain.com;

    # 重定向到 HTTPS
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl http2;
    server_name your-domain.com;

    # SSL 证书配置 (见 TLS 配置)
    ssl_certificate /etc/ssl/certs/electron-agent.crt;
    ssl_certificate_key /etc/ssl/private/electron-agent.key;

    # 安全头部
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-XSS-Protection "1; mode=block" always;

    # 静态文件
    location / {
        root /usr/share/nginx/html/electron-agent;
        try_files $uri $uri/ /index.html;
    }

    # WebSocket 代理
    location /ws {
        proxy_pass http://localhost:9300;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        
        # WebSocket 超时设置
        proxy_read_timeout 3600s;
        proxy_send_timeout 3600s;
        proxy_connect_timeout 60s;
    }

    # API 代理
    location /api/ {
        proxy_pass http://localhost:9300/api/;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        
        proxy_connect_timeout 60s;
        proxy_send_timeout 60s;
        proxy_read_timeout 60s;
    }

    # 健康检查
    location /health {
        access_log off;
        return 200 "OK";
        add_header Content-Type text/plain;
    }
}
```

### 启用配置

```bash
# 创建符号链接
sudo ln -s /etc/nginx/sites-available/electron-agent /etc/nginx/sites-enabled/

# 测试配置
sudo nginx -t

# 重载 Nginx
sudo systemctl reload nginx
```

## 🔒 TLS 配置

### 使用 Let's Encrypt

```bash
# 安装 Certbot
sudo apt install certbot python3-certbot-nginx

# 获取证书
sudo certbot --nginx -d your-domain.com

# 自动续期
sudo certbot renew --dry-run
```

### 使用自签名证书 (开发环境)

```bash
# 创建证书目录
sudo mkdir -p /etc/ssl/private

# 生成私钥
sudo openssl genrsa -out /etc/ssl/private/electron-agent.key 2048

# 生成证书
sudo openssl req -new -x509 -key /etc/ssl/private/electron-agent.key \
  -out /etc/ssl/certs/electron-agent.crt -days 365 \
  -subj "/C=US/ST=State/L=City/O=Organization/CN=your-domain.com"
```

### SSL 最佳实践

```nginx
# 强 SSL 配置
ssl_protocols TLSv1.2 TLSv1.3;
ssl_ciphers 'ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256:ECDHE-ECDSA-AES256-GCM-SHA384:ECDHE-RSA-AES256-GCM-SHA384';
ssl_prefer_server_ciphers on;

# 会话缓存
ssl_session_cache shared:SSL:10m;
ssl_session_timeout 10m;

# OCSP Stapling
ssl_stapling on;
ssl_stapling_verify on;
ssl_trusted_certificate /etc/ssl/certs/chain.crt;
```

## ⚙️ 环境变量配置

### 生产环境配置

```bash
# /etc/electron-agent/env
# 服务器配置
PORT=9300
NODE_ENV=production

# JWT 认证
JWT_SECRET=your-production-jwt-secret-at-least-32-characters-long

# 管理员凭证
ADMIN_USERNAME=admin
ADMIN_PASSWORD=your-secure-admin-password

# 遗留令牌 (迁移期使用)
AGENT_TOKEN=dev-agent-token-123
ADMIN_TOKEN=dev-admin-token-456

# 性能优化
ADAPTIVE_QUALITY=true
INITIAL_QUALITY=70
ADAPTIVE_FPS=true
BATCH_INTERVAL=500

# 隐私保护
MASK_ENABLED=false
MASK_BLUR_RADIUS=10

# 速率限制
LOGIN_RATE_LIMIT=5
COMMAND_RATE_LIMIT=10

# 日志配置
LOG_LEVEL=info
AUDIT_LOGGING=true

# 网络配置
WEBSOCKET_TIMEOUT=3600
MAX_CONNECTIONS=100
```

### 配置文件权限

```bash
# 设置适当的权限
sudo chmod 600 /etc/electron-agent/env
sudo chown root:root /etc/electron-agent/env
```

## 🔐 安全检查清单

### 部署前检查

- [ ] 修改默认管理员密码
- [ ] 设置强 JWT_SECRET (至少 32 字符)
- [ ] 启用 HTTPS/TLS
- [ ] 配置防火墙规则
- [ ] 启用审计日志
- [ ] 配置日志轮转
- [ ] 设置监控告警
- [ ] 定期备份数据

### 网络安全

```bash
# 防火墙配置 (UFW)
sudo ufw allow 22/tcp    # SSH
sudo ufw allow 80/tcp    # HTTP
sudo ufw allow 443/tcp   # HTTPS
sudo ufw enable

# 限制内部端口访问
sudo ufw deny 9300/tcp  # 仅允许本地访问
```

### 应用安全

- [ ] 启用速率限制
- [ ] 配置 CORS 策略
- [ ] 实施访问控制
- [ ] 启用隐私遮罩
- [ ] 加密敏感数据

### 数据保护

```bash
# 设置日志轮转
sudo nano /etc/logrotate.d/electron-agent

/var/log/electron-agent/*.log {
    daily
    rotate 30
    compress
    delaycompress
    missingok
    notifempty
    create 0640 www-data www-data
    sharedscripts
    postrotate
        systemctl reload electron-agent > /dev/null 2>&1 || true
    endscript
}
```

## 📊 监控与维护

### 系统监控

#### Prometheus 配置
```yaml
# prometheus.yml
scrape_configs:
  - job_name: 'electron-agent'
    static_configs:
      - targets: ['localhost:9300']
    metrics_path: '/metrics'
```

#### Grafana 仪表板
- 服务可用性
- 响应时间
- 错误率
- 资源使用率

### 日志监控

```bash
# 实时查看日志
sudo journalctl -u electron-agent -f

# 查看错误日志
tail -f /var/log/electron-agent/error.log

# 搜索特定事件
grep "ERROR" /var/log/electron-agent/out.log
```

### 健康检查

```bash
# 创建健康检查脚本
cat > /usr/local/bin/electron-agent-health.sh << 'EOF'
#!/bin/bash
curl -f http://localhost:9300/health || exit 1
curl -f http://localhost/health || exit 1
echo "All services healthy"
EOF

chmod +x /usr/local/bin/electron-agent-health.sh

# 添加到 crontab
crontab -e
# 添加: */5 * * * * /usr/local/bin/electron-agent-health.sh
```

### 备份策略

```bash
# 数据库备份脚本
cat > /usr/local/bin/electron-agent-backup.sh << 'EOF'
#!/bin/bash
BACKUP_DIR="/var/backups/electron-agent"
DATE=$(date +%Y%m%d_%H%M%S)

mkdir -p $BACKUP_DIR

# 备份配置文件
cp /etc/electron-agent/env $BACKUP_DIR/env_$DATE

# 备份日志
tar -czf $BACKUP_DIR/logs_$DATE.tar.gz /var/log/electron-agent/

# 清理 30 天前的备份
find $BACKUP_DIR -name "*.tar.gz" -mtime +30 -delete
find $BACKUP_DIR -name "env_*" -mtime +30 -delete
EOF

chmod +x /usr/local/bin/electron-agent-backup.sh

# 添加到 crontab (每天凌晨 2 点)
crontab -e
# 添加: 0 2 * * * /usr/local/bin/electron-agent-backup.sh
```

### 故障恢复

```bash
# 服务重启
pm2 restart electron-agent-relay
sudo systemctl restart nginx

# 完整重启
docker-compose restart

# 紧急回滚
docker-compose down
docker-compose up -d --scale relay-server=1

# 查看详细日志
docker-compose logs --tail=500 relay-server
```

## 🚨 故障排除

### 常见问题

1. **WebSocket 连接失败**
   - 检查防火墙规则
   - 验证 Nginx 代理配置
   - 检查 SSL 证书有效性

2. **高内存使用**
   - 调整批处理间隔
   - 降低 JPEG 质量
   - 限制并发连接数

3. **认证失败**
   - 验证 JWT_SECRET 配置
   - 检查令牌过期时间
   - 查看审计日志

### 调试模式

```bash
# 启用调试日志
LOG_LEVEL=debug npm start

# WebSocket 调试
wscat -c "ws://localhost:9300/ws?token=dev-admin-token-456"

# API 测试
curl -X POST http://localhost:9300/api/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"admin123"}'
```

## 📞 获取帮助

- 查看项目文档: [README.md](../README.md)
- 提交问题: GitHub Issues
- 技术支持: admin@example.com