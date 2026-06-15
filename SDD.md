# Electron Agent - 远程监控与操作平台 SDD

> 对 Electron 应用内嵌 Web 页面（含第三方页面）进行远程监控与操作的平台。

## 1. 产品定位

- **客户端**：Electron 桌面应用，内嵌 Agent 模块，加载业务页面（含第三方页面如腾讯人脸识别）
- **管理端**：Web 浏览器，实时查看客户端页面状态、截图、网络请求，下发操作指令
- **服务端**：Node.js 中继服务器，设备管理 + 指令转发 + 认证

## 2. 核心能力

### 2.1 监控（只读）

| 能力 | 实现方式 | 优先级 |
|---|---|---|
| 实时截图 | `webContents.capturePage()` 定时上报 | P0 |
| 页面 URL/标题 | `webContents.getURL()` / `getTitle()` 事件监听 | P0 |
| 网络请求监控 | CDP `Network.enable` 抓取请求/响应 | P0 |
| 控制台日志 | CDP `Runtime.consoleAPICalled` | P0 |
| JS 错误 | CDP `Runtime.exceptionThrown` | P0 |
| 页面导航事件 | `did-navigate` / `did-finish-load` | P0 |
| DOM 快照 | CDP `DOM.getDocument` 按需获取 | P1 |
| 性能指标 | CDP `Performance.getMetrics` | P1 |

### 2.2 操作（远程控制）

| 能力 | 实现方式 | 优先级 |
|---|---|---|
| 模拟点击 | CDP `Input.dispatchMouseEvent` | P0 |
| 模拟键盘输入 | CDP `Input.dispatchKeyEvent` | P0 |
| 页面导航 | `webContents.loadURL()` | P0 |
| 执行 JS | CDP `Runtime.evaluate` | P0 |
| 模拟滚动 | CDP `Input.dispatchMouseEvent` (wheel) | P1 |
| 文件上传 | CDP `DOM.setFileInputFiles` | P1 |
| Cookie 操作 | `session.cookies` API | P1 |

### 2.3 设备管理

| 能力 | 描述 | 优先级 |
|---|---|---|
| 设备注册 | Agent 启动时注册到中继服务器 | P0 |
| 在线状态 | 心跳保活，离线检测 | P0 |
| 设备列表 | 管理端展示所有在线/离线设备 | P0 |
| 多设备操作 | 同时管理多台设备 | P0 |
| 设备分组 | 按业务分组管理 | P1 |

## 3. 技术架构

```
┌─────────────────────────────────────────────────────────────┐
│                    Web 管理端 (浏览器)                       │
│                                                             │
│  Vue3 + Vite + Element Plus                                │
│                                                             │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐  │
│  │ 设备列表  │  │ 实时监控  │  │ 网络面板  │  │ 控制台   │  │
│  │ DeviceList│  │ LiveView │  │ Network  │  │ Console  │  │
│  │          │  │ (截图流)  │  │ (请求列表)│  │ (日志)   │  │
│  └──────────┘  └──────────┘  └──────────┘  └──────────┘  │
│  ┌──────────┐  ┌──────────┐                              │
│  │ 远程操作  │  │ 审计日志  │                              │
│  │ RemoteOp │  │ AuditLog │                              │
│  └──────────┘  └──────────┘                              │
└───────────────────────┬─────────────────────────────────────┘
                        │ WebSocket (JSON-RPC)
                        │
┌───────────────────────┴─────────────────────────────────────┐
│                 中继服务器 (Node.js)                         │
│                                                             │
│  ┌─────────────┐  ┌──────────────┐  ┌─────────────┐       │
│  │ 设备注册中心  │  │ 指令转发路由  │  │ 认证中间件   │       │
│  │ Registry    │  │ CommandBus   │  │ Auth        │       │
│  └─────────────┘  └──────────────┘  └─────────────┘       │
│  ┌─────────────┐  ┌──────────────┐  ┌─────────────┐       │
│  │ 审计日志存储  │  │ 截图缓存      │  │ 事件广播    │       │
│  │ AuditStore  │  │ Screenshot   │  │ Broadcast   │       │
│  └─────────────┘  └──────────────┘  └─────────────┘       │
└───────────────────────┬─────────────────────────────────────┘
                        │ WebSocket
                        │
┌───────────────────────┴─────────────────────────────────────┐
│                Electron 客户端 (Agent)                      │
│                                                             │
│  ┌────────────────────────────────────────────────────┐    │
│  │  Agent 核心 (主进程模块)                             │    │
│  │                                                    │    │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────┐        │    │
│  │  │ 连接管理  │  │ 指令执行  │  │ 状态上报  │        │    │
│  │  │ ConnMgr  │  │ Executor │  │ Reporter │        │    │
│  │  └──────────┘  └──────────┘  └──────────┘        │    │
│  │  ┌──────────┐  ┌──────────┐                       │    │
│  │  │ CDP 桥接  │  │ 截图服务  │                      │    │
│  │  │ CDPBridge│  │ Capture  │                       │    │
│  │  └──────────┘  └──────────┘                       │    │
│  └────────────────────────────────────────────────────┘    │
│                                                             │
│  ┌────────────────────────────────────────────────────┐    │
│  │  BrowserWindow → webContents                       │    │
│  │  ┌──────────────────────────────────────────────┐  │    │
│  │  │     业务 Web 页面 (含第三方页面)              │  │    │
│  │  │     如：腾讯人脸识别、内部业务系统            │  │    │
│  │  └──────────────────────────────────────────────┘  │    │
│  └────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────┘
```

## 4. 通信协议

### 4.1 Agent → Server（上行）

```typescript
// 设备注册
{ type: "agent:register", deviceId: "xxx", info: DeviceInfo }

// 心跳
{ type: "agent:heartbeat", deviceId: "xxx", timestamp: number }

// 截图上报
{ type: "agent:screenshot", deviceId: "xxx", data: "base64...", width: number, height: number }

// 页面状态变更
{ type: "agent:pageChanged", deviceId: "xxx", url: string, title: string }

// 网络事件
{ type: "agent:network", deviceId: "xxx", request: NetworkRequest }

// 控制台日志
{ type: "agent:console", deviceId: "xxx", level: string, message: string }

// JS 错误
{ type: "agent:error", deviceId: "xxx", message: string, stack: string }

// 指令响应
{ type: "agent:result", requestId: string, success: boolean, data: any }
```

### 4.2 Server → Agent（下行）

```typescript
// 开始截图流
{ type: "cmd:startCapture", fps: number, quality: number }

// 停止截图流
{ type: "cmd:stopCapture" }

// 单次截图
{ type: "cmd:screenshot", quality: number }

// 模拟点击
{ type: "cmd:click", x: number, y: number, button: "left"|"right" }

// 键盘输入
{ type: "cmd:type", text: string }

// 按键
{ type: "cmd:key", keyCode: number, action: "down"|"up" }

// 页面导航
{ type: "cmd:navigate", url: string }

// 执行 JS
{ type: "cmd:eval", code: string }

// 滚动
{ type: "cmd:scroll", deltaX: number, deltaY: number }

// 获取 DOM
{ type: "cmd:getDOM", selector?: string }

// 获取页面信息
{ type: "cmd:getInfo" }

// 订阅/取消订阅网络事件
{ type: "cmd:subscribeNetwork", enable: boolean }

// 订阅/取消订阅控制台
{ type: "cmd:subscribeConsole", enable: boolean }
```

### 4.3 Server → Web（广播）

```typescript
// 设备列表更新
{ type: "server:devices", devices: Device[] }

// 设备状态更新
{ type: "server:deviceUpdate", deviceId: string, status: DeviceStatus }

// 实时截图推送
{ type: "server:screenshot", deviceId: string, data: "base64..." }

// 网络请求推送
{ type: "server:network", deviceId: string, request: NetworkRequest }

// 控制台推送
{ type: "server:console", deviceId: string, log: ConsoleLog }

// 审计日志
{ type: "server:audit", event: AuditEvent }
```

## 5. 数据模型

```typescript
interface DeviceInfo {
  deviceId: string;
  name: string;
  os: string;          // win32/darwin/linux
  version: string;     // Electron version
  appVersion: string;  // 业务应用版本
  ip: string;
  tags?: string[];
}

interface Device {
  info: DeviceInfo;
  status: "online" | "offline";
  lastSeen: number;
  currentPage?: { url: string; title: string };
}

interface NetworkRequest {
  method: string;
  url: string;
  status: number;
  mimeType: string;
  requestHeaders?: Record<string, string>;
  responseHeaders?: Record<string, string>;
  requestBody?: string;
  responseBody?: string;  // 仅小响应
  timing: number;         // ms
  timestamp: number;
}

interface ConsoleLog {
  level: "log" | "warn" | "error" | "info" | "debug";
  args: string[];
  timestamp: number;
}

interface AuditEvent {
  type: "connect" | "disconnect" | "screenshot" | "click" | "type" | "navigate" | "eval";
  deviceId: string;
  operatorId: string;
  timestamp: number;
  detail: string;
}
```

## 6. 项目结构

```
electron-agent/
├── packages/
│   ├── shared/                    # 共享类型和协议
│   │   ├── src/
│   │   │   ├── types.ts           # 所有 TypeScript 类型
│   │   │   ├── protocol.ts        # 通信协议消息定义
│   │   │   └── index.ts
│   │   └── package.json
│   │
│   └── agent-core/                # Electron Agent 核心模块
│       ├── src/
│       │   ├── index.ts           # 入口
│       │   ├── connection.ts      # 与中继服务器的 WebSocket 连接
│       │   ├── cdp-bridge.ts      # CDP 桥接（attach + 命令转发）
│       │   ├── executor.ts        # 指令执行器（click/type/eval/...）
│       │   ├── reporter.ts        # 状态上报器（截图/事件推送）
│       │   ├── capture.ts         # 截图服务
│       │   └── types.ts
│       └── package.json
│
├── apps/
│   ├── electron-client/           # Electron 客户端示例应用
│   │   ├── src/
│   │   │   ├── main/
│   │   │   │   ├── index.ts       # Electron 主进程入口
│   │   │   │   └── agent-setup.ts # Agent 初始化
│   │   │   └── renderer/
│   │   │       └── index.html     # 简单的窗口 UI
│   │   ├── electron-builder.yml
│   │   └── package.json
│   │
│   ├── relay-server/              # 中继服务器
│   │   ├── src/
│   │   │   ├── index.ts           # HTTP + WebSocket 启动
│   │   │   ├── device-registry.ts # 设备注册中心
│   │   │   ├── command-bus.ts     # 指令转发
│   │   │   ├── auth.ts            # 认证中间件
│   │   │   ├── audit-store.ts     # 审计日志
│   │   │   └── screenshot-cache.ts
│   │   └── package.json
│   │
│   └── web-console/               # Web 管理端
│       ├── src/
│       │   ├── App.vue
│       │   ├── main.ts
│       │   ├── views/
│       │   │   ├── DeviceList.vue     # 设备列表
│       │   │   ├── LiveMonitor.vue    # 实时监控（截图+网络+控制台）
│       │   │   ├── RemoteControl.vue  # 远程操作面板
│       │   │   └── AuditLog.vue       # 审计日志
│       │   ├── components/
│       │   │   ├── DeviceCard.vue
│       │   │   ├── ScreenshotView.vue  # 截图显示
│       │   │   ├── NetworkPanel.vue    # 网络面板
│       │   │   ├── ConsolePanel.vue    # 控制台
│       │   │   └── ControlBar.vue      # 操作工具栏
│       │   ├── composables/
│       │   │   ├── useWebSocket.ts     # WebSocket 管理
│       │   │   ├── useDevices.ts       # 设备列表
│       │   │   └── useDeviceControl.ts # 设备控制
│       │   └── router/index.ts
│       ├── vite.config.ts
│       └── package.json
│
├── docs/
│   ├── ARCHITECTURE.md
│   ├── DEPLOYMENT.md
│   └── API.md
├── scripts/
│   ├── dev.sh                     # 本地开发启动脚本
│   └── verify.sh                  # 验证脚本
├── package.json                   # monorepo root
├── tsconfig.base.json
└── README.md
```

## 7. 技术栈

| 层 | 技术 | 版本 |
|---|---|---|
| **共享类型** | TypeScript | 5.9+ |
| **Agent 核心** | Node.js (Electron 内置) | Electron 33+ |
| **CDP 桥接** | Electron `webContents.debugger` API | 内置 |
| **截图** | `webContents.capturePage()` | 内置 |
| **Electron 客户端** | Electron + electron-builder | 33+ |
| **中继服务器** | Node.js + ws + express | Node 22+ |
| **Web 管理端** | Vue3 + Vite + Element Plus | Vue 3.5+ |
| **状态管理** | Pinia | 3+ |
| **WebSocket 客户端** | 原生 WebSocket | - |

## 8. 安全设计

### 8.1 Agent 认证
- Agent 启动时携带预配置的 `AGENT_TOKEN` 连接中继服务器
- 中继服务器验证 token，拒绝非法连接
- 支持 token 轮换

### 8.2 管理端认证
- 管理端登录（用户名+密码 / OAuth）
- JWT token 认证
- 操作权限分级（只读 / 操作 / 管理）

### 8.3 传输安全
- 生产环境 WSS + TLS
- Agent 到服务器双向认证（可选 mTLS）
- 敏感字段不在截图中暴露（可选区域遮罩）

### 8.4 审计
- 所有远程操作记录审计日志
- 包含：操作者、目标设备、操作类型、时间、参数
- 日志不可篡改（追加写入）

## 9. 开发阶段规划

### P0：核心通道（1-2 周）

目标：**从 Web 管理端看到 Electron 客户端的实时画面，能执行基础操作**

- [ ] shared：类型定义 + 协议消息
- [ ] agent-core：WebSocket 连接 + CDP 桥接 + 截图 + 基础指令
- [ ] relay-server：设备注册 + WebSocket 转发 + 基础认证
- [ ] web-console：设备列表 + 实时截图 + 基础操作面板
- [ ] electron-client：示例应用（加载任意 URL）

### P1：完整监控（1-2 周）

目标：**完整的监控能力，能调试第三方页面**

- [ ] 网络请求监控面板
- [ ] 控制台日志面板
- [ ] JS 错误监控
- [ ] DOM 检查器
- [ ] 页面导航事件追踪
- [ ] 审计日志页面

### P2：高级操作（1-2 周）

目标：**完整的远程操作能力**

- [ ] 远程点击/输入（通过截图坐标定位）
- [ ] JS 执行面板
- [ ] 页面导航控制
- [ ] Cookie/Storage 管理
- [ ] 多设备批量操作
- [ ] 操作录制与回放

### P3：生产加固（2-3 周）

目标：**可部署的生产系统**

- [ ] 用户认证体系（JWT + RBAC）
- [ ] HTTPS/WSS TLS 配置
- [ ] 设备分组管理
- [ ] 截图区域遮罩
- [ ] 性能优化（截图压缩、增量更新）
- [ ] 监控告警
- [ ] Docker 部署

## 10. 关键实现细节

### 10.1 CDP 桥接核心

```typescript
// packages/agent-core/src/cdp-bridge.ts
import { BrowserWindow } from 'electron';

export class CDPBridge {
  private attached = false;

  constructor(private win: BrowserWindow) {}

  async attach() {
    if (this.attached) return;
    this.win.webContents.debugger.attach('1.1');
    this.attached = true;
    
    // 监听 CDP 事件
    this.win.webContents.debugger.on('message', (event, method, params) => {
      this.handleCDPEvent(method, params);
    });
  }

  async sendCommand(method: string, params?: any): Promise<any> {
    return this.win.webContents.debugger.sendCommand(method, params);
  }

  private handleCDPEvent(method: string, params: any) {
    // 转发给 reporter 推送到中继服务器
  }
}
```

### 10.2 截图上报

```typescript
// 定时截图（低帧率，按需调整）
async function startCaptureLoop(win: BrowserWindow, fps: number = 1) {
  const interval = 1000 / fps;
  setInterval(async () => {
    const image = await win.webContents.capturePage();
    const jpeg = image.toJPEG(60);  // 60% quality
    const base64 = jpeg.toString('base64');
    // 推送到中继服务器
    connection.send({ type: 'agent:screenshot', data: base64, ... });
  }, interval);
}
```

### 10.3 指令执行

```typescript
async function executeCommand(cmd: Command): Promise<any> {
  switch (cmd.type) {
    case 'cmd:click':
      // CDP Input 事件 - 绕过 CSP
      await cdpBridge.sendCommand('Input.dispatchMouseEvent', {
        type: 'mousePressed', x: cmd.x, y: cmd.y, button: cmd.button, clickCount: 1
      });
      await cdpBridge.sendCommand('Input.dispatchMouseEvent', {
        type: 'mouseReleased', x: cmd.x, y: cmd.y, button: cmd.button, clickCount: 1
      });
      break;
    case 'cmd:eval':
      return await cdpBridge.sendCommand('Runtime.evaluate', {
        expression: cmd.code, returnByValue: true
      });
    case 'cmd:navigate':
      win.webContents.loadURL(cmd.url);
      break;
    // ...
  }
}
```

## 11. 部署架构

```
                    ┌─────────────────┐
                    │   Nginx (TLS)   │
                    │   sanfacheng.cyou│
                    └────────┬────────┘
                             │
              ┌──────────────┼──────────────┐
              │              │              │
     ┌────────┴───────┐ ┌────┴─────┐ ┌──────┴──────┐
     │ relay-server   │ │ web-console│ │  (静态文件)  │
     │ :9300          │ │ (静态)    │ │             │
     │ WebSocket + HTTP│ └──────────┘ └─────────────┘
     └────────────────┘
              │
              │ WebSocket (WSS via Nginx)
              │
     ┌────────┴───────┐
     │ Electron Agent │ × N 台设备
     │ (客户端)        │
     └────────────────┘
```

- **中继服务器**：`relay-server` 部署在 `:9300`
- **Nginx**：TLS 终止 + WebSocket 代理 + 静态文件
- **Web 管理端**：Nginx 直接 serve 静态文件
- **域名**：`agent.sanfacheng.cyou`（或复用现有域名加路径）

## 12. 验收标准

### P0 验收

1. Electron 客户端启动后自动连接中继服务器，设备列表中出现该设备
2. Web 管理端点击设备 → 看到实时截图（1 FPS）
3. Web 管理端发送点击指令 → Electron 客户端执行点击
4. Web 管理端发送 JS 执行指令 → 返回执行结果
5. Electron 客户端加载腾讯人脸识别页面 → 管理端能看到截图和网络请求
