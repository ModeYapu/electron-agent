# Electron Agent — 远程监控与操作平台

> 对 Electron 应用内嵌 Web 页面（**含第三方页面**）进行远程监控与操作的平台。
> 基于 Chrome DevTools Protocol (CDP)，绕过 CSP 和跨域限制，实现对任意内嵌页面的深度控制。

## 核心场景

- 🔍 **第三方页面监控**：Electron 加载腾讯人脸识别 / 支付页面 / 任何外部 URL，管理端实时查看截图、网络请求、控制台日志
- 🖱️ **远程操作**：通过 CDP Input 事件模拟真实用户点击、输入、滚动，绕过 CSP
- 📊 **全链路调试**：网络抓包、JS 错误追踪、DOM 检查器、控制台日志 — 远程 DevTools
- 🍪 **状态管理**：远程读写 Cookie / localStorage / sessionStorage

## 架构

```
┌──────────────────────────────────────────────────────────┐
│                   Web 管理端 (浏览器)                      │
│                   Vue3 + Element Plus                    │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐   │
│  │ 设备列表  │ │ 实时截图  │ │ 网络面板  │ │ 控制台   │   │
│  │ DOM检查器 │ │ 远程操作  │ │ 错误监控  │ │ 审计日志 │   │
│  └──────────┘ └──────────┘ └──────────┘ └──────────┘   │
└────────────────────────┬─────────────────────────────────┘
                         │ WebSocket (JSON)
┌────────────────────────┴─────────────────────────────────┐
│                  中继服务器 (Node.js)                      │
│  Express + ws | JWT 认证 | 设备注册 | 指令转发 | 审计存储   │
└────────────────────────┬─────────────────────────────────┘
                         │ WebSocket (JSON)
┌────────────────────────┴─────────────────────────────────┐
│               Electron 客户端 (Agent)                     │
│  ┌──────────────────────────────────────────────────┐    │
│  │ Agent 模块                                        │    │
│  │  • CDP Bridge (webContents.debugger)              │    │
│  │  • 截图 (capturePage + 自适应画质/帧率 + 隐私遮罩) │    │
│  │  • 指令执行 (click/type/eval/cookie/storage)     │    │
│  │  • 事件上报 (network/console/error + 批量发送)    │    │
│  └──────────────────────────────────────────────────┘    │
│  ┌──────────────────────────────────────────────────┐    │
│  │ BrowserWindow → webContents                      │    │
│  │  ┌────────────────────────────────────────────┐  │    │
│  │  │ 业务页面（同源页面 ✅ / 第三方页面 ✅）      │  │    │
│  │  │ 如：腾讯人脸识别、内部系统、任意 URL        │  │    │
│  │  └────────────────────────────────────────────┘  │    │
│  └──────────────────────────────────────────────────┘    │
└──────────────────────────────────────────────────────────┘
```

**为什么能控制第三方页面？** Electron 的 `webContents.debugger` API 直接对接 Chromium CDP，在浏览器引擎层操作，无视 CSP 和同源策略。CDP `Input.dispatchMouseEvent` 模拟的是真实硬件事件，不会被页面的安全策略拦截。

## 功能清单

| 能力 | 说明 | 第三方页面兼容 |
|---|---|---|
| 实时截图 | `capturePage()` + 自适应 JPEG 画质/帧率 | ✅ |
| 网络抓包 | CDP `Network.enable` 请求/响应配对 | ✅ |
| 控制台日志 | CDP `Runtime.consoleAPICalled` | ✅ |
| JS 错误追踪 | CDP `Runtime.exceptionThrown` + 堆栈 | ✅ |
| 远程点击 | CDP `Input.dispatchMouseEvent` | ✅ 绕过 CSP |
| 远程输入 | CDP `Input.insertText` (批量，含逐字符 fallback) | ✅ 绕过 CSP |
| JS 执行 | CDP `Runtime.evaluate` | ✅ |
| DOM 检查 | CDP `DOM.getDocument` 树形结构 + 节点详情 | ✅ |
| Cookie 管理 | `session.cookies` API 读/写/删 | ✅ |
| Storage 管理 | CDP `Runtime.evaluate` 操作 localStorage | ✅ |
| 页面导航 | `webContents.loadURL()` | ✅ |
| 隐私遮罩 | 截图区域模糊（CSS 选择器 / 坐标） | ✅ |
| 事件批量发送 | 网络/控制台事件 500ms 批量上报 | — |
| JWT 认证 | RBAC (admin/viewer) + 旧 token 兼容 | — |
| 审计日志 | 全部远程操作记录 | — |

## 快速开始

### 方式一：Docker 部署（推荐生产环境）

```bash
git clone https://github.com/ModeYapu/electron-agent.git
cd electron-agent
cp .env.example .env
# 编辑 .env：设置 JWT_SECRET、ADMIN_PASSWORD

docker-compose up -d
```

访问：
- Web 管理端 → `http://localhost:8080`
- API 网关 → `http://localhost:9300`
- 健康检查 → `http://localhost:9300/health`

### 方式二：本地开发

**前置要求**：Node.js 22+、Electron 开发环境

```bash
# 1. 克隆 + 安装依赖
git clone https://github.com/ModeYapu/electron-agent.git
cd electron-agent
npm install

# 2. 编译 shared 包（其他包依赖它）
cd packages/shared && npm run build && cd ../..

# 3. 终端 1：启动中继服务器
cd apps/relay-server && npm run dev

# 4. 终端 2：启动 Web 管理端
cd apps/web-console && npm run dev

# 5. 终端 3：启动 Electron 客户端
cd apps/electron-client && npm run dev
```

### 在你的 Electron 项目中集成 Agent

```bash
npm install @electron-agent/agent-core
```

```typescript
import { app, BrowserWindow } from 'electron';
import { ElectronAgent } from '@electron-agent/agent-core';

app.whenReady().then(() => {
  const win = new BrowserWindow({
    webPreferences: {
      nodeIntegration: false,   // 安全配置
      contextIsolation: true,
      sandbox: true,
    },
  });

  win.loadURL('https://cloud.tencent.com/faceid'); // 加载第三方页面

  // 启动 Agent，连接到中继服务器
  const agent = new ElectronAgent(win, {
    serverUrl: 'ws://your-server:9300/ws',
    agentToken: 'your-agent-token',
    deviceInfo: {
      name: '客户终端-001',
      appVersion: '1.0.0',
      tags: ['production', 'shanghai'],
    },
    captureQuality: 60,
  });

  agent.start();
});
```

然后在 Web 管理端就能看到这台设备，实时查看截图、网络请求，下发操作指令。

## 配置

### 环境变量（中继服务器）

| 变量 | 必填 | 默认值 | 说明 |
|---|---|---|---|
| `PORT` | 否 | `9300` | 服务监听端口 |
| `JWT_SECRET` | **生产必填** | dev fallback | JWT 签发密钥（生产不设则启动失败） |
| `ADMIN_USERNAME` | 否 | `admin` | 管理员用户名 |
| `ADMIN_PASSWORD` | 否 | `admin123` | 管理员密码 |
| `AGENT_TOKEN` | 否 | `dev-agent-token-123` | Agent 连接令牌 |
| `ADMIN_TOKEN` | 否 | `dev-admin-token-456` | 管理 API 令牌 |
| `NODE_ENV` | 否 | — | 设为 `production` 启用安全限制 |

### Agent 配置（Electron 端）

```typescript
new ElectronAgent(win, {
  serverUrl: 'ws://relay-server:9300/ws',
  agentToken: '***',
  deviceInfo: { name: '...', appVersion: '...' },
  captureQuality: 60,         // JPEG 画质 0-100
  reconnectInterval: 5000,    // 初始重连间隔
  heartbeatInterval: 30000,   // 心跳间隔
  // 重连指数退避（5s → 10s → 20s → 40s → 60s 上限）
});
```

## API 参考

### 认证

```bash
# 登录获取 JWT
curl -X POST http://localhost:9300/api/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"admin123"}'

# 响应：{ "token": "eyJ...", "role": "admin", "expiresIn": "24h" }
```

### HTTP API

所有 API 需要 `Authorization: Bearer <token>` 头。

| 接口 | 方法 | 说明 |
|---|---|---|
| `/health` | GET | 健康检查（无需认证） |
| `/api/login` | POST | 登录获取 JWT |
| `/api/devices` | GET | 所有设备列表 |
| `/api/network?deviceId=xxx` | GET | 网络请求历史（分页） |
| `/api/console?deviceId=xxx&level=error` | GET | 控制台日志（分页+过滤） |
| `/api/errors?deviceId=xxx` | GET | JS 错误历史（分页+时间过滤） |
| `/api/audit?deviceId=xxx&type=click` | GET | 审计日志（分页+过滤） |

### WebSocket 协议

**连接**（首条消息认证）：
```javascript
const ws = new WebSocket('ws://server:9300/ws?deviceId=device-001');
ws.onopen = () => {
  ws.send(JSON.stringify({ type: 'auth', token: 'your-token', deviceId: 'device-001' }));
};
```

**Web 管理端 → 服务器**（下行指令）：

| 消息类型 | 说明 |
|---|---|
| `cmd:click` | 在指定坐标点击 `{ x, y, button }` |
| `cmd:type` | 输入文本 `{ text }` |
| `cmd:key` | 按键 `{ keyCode, action }` |
| `cmd:scroll` | 滚动 `{ deltaX, deltaY }` |
| `cmd:navigate` | 页面导航 `{ url }` |
| `cmd:eval` | 执行 JS `{ code }` |
| `cmd:screenshot` | 单次截图 |
| `cmd:startCapture` | 开始截图流 `{ fps, quality }` |
| `cmd:stopCapture` | 停止截图流 |
| `cmd:getDOM` | 获取 DOM 树 |
| `cmd:getCookies` | 读取 Cookie |
| `cmd:setCookie` / `cmd:deleteCookie` | Cookie 写/删 |
| `cmd:getStorage` / `cmd:setStorage` / `cmd:clearStorage` | Storage 操作 |
| `cmd:subscribeNetwork` | 订阅/取消网络事件 `{ enable }` |
| `cmd:subscribeConsole` | 订阅/取消控制台事件 `{ enable }` |

**Agent → 服务器**（上行事件）：

| 消息类型 | 说明 |
|---|---|
| `agent:register` | 设备注册 |
| `agent:heartbeat` | 心跳 |
| `agent:pageChanged` | 页面 URL/标题变更 |
| `agent:screenshot` | 截图数据（base64 JPEG） |
| `agent:network` | 网络请求事件 |
| `agent:console` | 控制台日志 |
| `agent:error` | JS 错误 |
| `agent:result` | 指令执行结果 |

## 项目结构

```
electron-agent/
├── packages/
│   ├── shared/              # 共享类型 + 通信协议
│   └── agent-core/          # Agent 核心（可独立 npm 安装）
│       ├── cdp-bridge.ts    # CDP 桥接（attach + 事件转发）
│       ├── capture.ts       # 截图（自适应画质 + 遮罩）
│       ├── executor.ts      # 指令执行器
│       ├── reporter.ts      # 事件上报（批量发送）
│       └── connection.ts    # WebSocket 管理（指数退避）
├── apps/
│   ├── relay-server/        # 中继服务器（Express + ws）
│   ├── web-console/         # Web 管理端（Vue3 + Element Plus）
│   └── electron-client/     # Electron 示例客户端
├── docker-compose.yml
├── .env.example
└── scripts/dev.sh           # 一键启动开发环境
```

## 安全

- **Electron 安全配置**：`nodeIntegration:false` + `contextIsolation:true` + `sandbox:true`
- **JWT 认证**：生产环境必须设置 `JWT_SECRET`，否则启动失败
- **WebSocket 认证**：首条消息认证（不再在 URL 暴露 token）
- **RBAC**：admin（完整权限）vs viewer（只读）
- **速率限制**：登录 5 次/15 分钟，指令 10 次/秒
- **隐私遮罩**：截图区域模糊（CSS 选择器 / 固定坐标）

详细部署安全检查清单见 [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)。

## 许可证

MIT
