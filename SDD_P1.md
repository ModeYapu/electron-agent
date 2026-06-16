# P1 - 完整监控增强

> 基于 P0 核心通道，增加完整的监控面板（网络、控制台、错误追踪、DOM 检查器）和审计日志页面

## P1 目标

实现完整的监控能力，让操作者能：
1. 查看详细的网络请求/响应（含头信息、体大小、耗时）
2. 实时查看控制台日志（可按级别过滤）
3. 监控 JS 错误和异常堆栈
4. 检查页面 DOM 结构（树形视图，可折叠）
5. 追踪页面导航事件
6. 查看完整的审计日志

## P1 新增功能

### 1. 网络请求监控面板

**UI 位置**：`web-console/src/views/NetworkMonitor.vue`

**功能**：
- 表格展示所有网络请求（可分页，每页 50 条）
- 列：请求方法、URL、状态码、MIME 类型、耗时、时间戳
- 点击行展开详情：
  - Request Headers
  - Response Headers
  - Request Body（如果有，仅小响应）
  - Response Body（如果有，仅小响应）
  - Timeline（DNS/TCP/TTFB/Download breakdown）
- 过滤器：
  - 状态码筛选（2xx/3xx/4xx/5xx）
  - 方法筛选（GET/POST/PUT/DELETE）
  - 搜索 URL
- 统计：总请求数、平均耗时、失败率

**协议扩展**（复用 P0）：
```typescript
// Agent 已上报：agent:network
// 需要存储更多细节（已在 CDP 桥接实现）

interface NetworkRequestDetail extends NetworkRequest {
  id: string;                    // 唯一 ID
  initiator?: string;            // 发起者（script/XHR/fetch/navigation）
  resourceType?: string;         // resource type
  fromCache?: boolean;           // 是否缓存
  timing?: {
    dns: number;
    tcp: number;
    ttfb: number;
    download: number;
  };
  requestBody?: {
    size: number;
    preview?: string;           // 前 1KB
  };
  responseBody?: {
    size: number;
    preview?: string;           // 前 1KB
  };
}
```

### 2. 控制台日志面板

**UI 位置**：`web-console/src/views/ConsoleMonitor.vue`

**功能**：
- 实时流式展示控制台日志（最新在上方，保留 500 条）
- 不同级别颜色：log(灰)/info(蓝)/warn(黄)/error(红)/debug(绿)
- 可点击行复制 JSON 或对象展开查看
- 过滤器：按级别筛选（可多选）
- 搜索框：搜索日志内容
- 清空按钮
- 自动滚动到最新

**协议扩展**（复用 P0）：
```typescript
// Agent 已上报：agent:console
// 已有 level、args、timestamp

interface ConsoleLogDetail extends ConsoleLog {
  id: string;                    // 唯一 ID
  source?: "console" | "network"; // 来源
  timestamp: number;
}
```

### 3. JS 错误监控

**UI 位置**：`web-console/src/views/ErrorMonitor.vue`

**功能**：
- 表格展示所有 JS 错误
- 列：错误信息、URL、行号、时间戳
- 点击行展开堆栈追踪
- 错误统计：按错误类型分组（TypeError/ReferenceError/NetworkError 等）
- 导出错误日志为 JSON

**协议扩展**（复用 P0）：
```typescript
// Agent 已上报：agent:error
// 已有 message、stack、timestamp

interface JSErrorDetail extends JSError {
  id: string;                    // 唯一 ID
  url?: string;                  // 发生错误的 URL
  line?: number;                 // 行号
  col?: number;                  // 列号
  errorType?: string;            // 错误类型
}
```

### 4. DOM 检查器

**UI 位置**：`web-console/src/views/DOMInspector.vue`

**功能**：
- 树形视图展示 DOM 结构
- 每个节点显示：标签名 + ID/Class（如果有）
- 点击节点显示详细信息：
  - 标签名
  - ID / Class / 属性
  - 文本内容（如果有）
  - 计算样式（仅基础属性如 color/font-size）
  - 盒模型（width/height/padding/margin）
- 折叠/展开子节点
- 搜索节点（按 tag/class/id）
- 定位节点（在截图中高亮，与 LiveMonitor 联动）

**协议新增**：
```typescript
// Server → Agent
{ type: "cmd:getDOM", requestId: string }

// Agent → Server
{ type: "agent:dom", requestId: string, dom: DOMNode }

interface DOMNode {
  tag: string;
  id?: string;
  classes?: string[];
  attributes?: Record<string, string>;
  text?: string;
  children?: DOMNode[];
  computedStyle?: Record<string, string>;
  boxModel?: {
    width: number;
    height: number;
    padding: [number, number, number, number];
    margin: [number, number, number, number];
  };
}
```

### 5. 页面导航事件追踪

**UI 位置**：集成在 `LiveMonitor.vue` 中新增 "Navigation History" Tab

**功能**：
- 时间线展示页面导航历史
- 每条记录：URL、标题、时间戳、加载耗时
- 点击时间线跳转到对应页面（虚拟，仅记录）

**协议扩展**（复用 P0）：
```typescript
// Agent 已上报：agent:pageChanged
// 需要记录历史（在 relay-server 或前端存储）

interface NavigationEvent {
  url: string;
  title: string;
  timestamp: number;
  loadTime?: number;           // 加载耗时
}
```

### 6. 审计日志页面

**UI 位置**：`web-console/src/views/AuditLog.vue`

**功能**：
- 表格展示所有审计事件
- 列：事件类型、设备 ID、操作者 ID、时间戳、详情
- 过滤器：
  - 事件类型筛选（connect/disconnect/screenshot/click/type/navigate/eval）
  - 设备筛选
  - 时间范围筛选
- 导出审计日志为 JSON/CSV
- 分页（每页 50 条）

**协议扩展**（复用 P0）：
```typescript
// Server 已有审计日志存储（audit-store）
// 需要新增 HTTP API + Web 前端查询

// Server 新增 HTTP API
GET /api/audit?deviceId=xxx&type=xxx&from=xxx&to=xxx&limit=50&offset=0
```

## P1 项目结构变更

```
web-console/src/
├── views/
│   ├── NetworkMonitor.vue    # NEW 网络监控
│   ├── ConsoleMonitor.vue    # NEW 控制台
│   ├── ErrorMonitor.vue      # NEW 错误监控
│   ├── DOMInspector.vue      # NEW DOM 检查器
│   ├── AuditLog.vue          # NEW 审计日志
│   ├── DeviceList.vue        # UPDATE（新增跳转链接）
│   ├── LiveMonitor.vue       # UPDATE（新增导航历史 Tab）
│   └── RemoteControl.vue     # UPDATE（新增 DOM 检查器联动）
│
├── stores/
│   └── websocket.ts          # UPDATE（新增网络/控制台/错误/DOM 存储）
│
├── router/index.ts           # UPDATE（新增路由）
│
└── components/
    ├── NetworkPanel.vue      # NEW 网络面板组件
    ├── ConsolePanel.vue      # NEW 控制台面板组件
    ├── ErrorPanel.vue        # NEW 错误面板组件
    ├── DOMTree.vue           # NEW DOM 树组件
    ├── DOMNodeDetail.vue     # NEW DOM 节点详情
    └── NavigationTimeline.vue # NEW 导航时间线组件
```

## P1 Agent 端变更

### agent-core

**src/cdp-bridge.ts** - UPDATE：
- 增强网络事件捕获（添加 timing 详细信息）
- 增强错误事件捕获（添加 URL/行号/列号）

**src/index.ts** - UPDATE：
- 新增 `getDOM()` 方法（通过 CDP `DOM.getDocument`）

### relay-server

**src/index.ts** - UPDATE：
- 新增 HTTP API `GET /api/network`（查询网络请求历史）
- 新增 HTTP API `GET /api/console`（查询控制台日志）
- 新增 HTTP API `GET /api/errors`（查询错误历史）
- 新增 HTTP API `GET /api/audit`（查询审计日志，扩展现有接口）

**src/network-store.ts** - NEW：
- 存储网络请求历史（每个设备保留最近 500 条）
- 提供查询接口（按设备/时间/状态过滤）

**src/console-store.ts** - NEW：
- 存储控制台日志（每个设备保留最近 500 条）
- 提供查询接口（按设备/级别过滤）

**src/error-store.ts** - NEW：
- 存储 JS 错误（每个设备保留最近 200 条）
- 提供查询接口（按设备/时间过滤）

## P1 验收标准

1. 网络监控页面加载后能看到所有网络请求（表格 + 分页）
2. 点击网络请求行能看到请求/响应详情
3. 控制台页面实时显示日志，不同级别颜色不同
4. 错误监控页面能看到所有 JS 错误，点击展开堆栈
5. DOM 检查器页面能显示 DOM 树，点击节点显示详情
6. 审计日志页面能显示所有操作记录，可导出
7. LiveMonitor 新增导航历史 Tab，能看到页面跳转时间线
8. 所有过滤/搜索功能正常
9. 所有页面支持分页

## P1 开发顺序

1. **relay-server 后端扩展**（1-2 天）
   - 新增 3 个 Store（network/console/error）
   - 新增 4 个 HTTP API
   - 扩展现有 /api/audit 接口

2. **agent-core DOM 获取**（半天）
   - 实现 `getDOM()` 方法
   - 测试 DOM 树序列化

3. **web-console 组件开发**（2-3 天）
   - NetworkPanel 组件
   - ConsolePanel 组件
   - ErrorPanel 组件
   - DOMTree 组件
   - DOMNodeDetail 组件
   - NavigationTimeline 组件

4. **web-console 视图开发**（2-3 天）
   - NetworkMonitor 视图
   - ConsoleMonitor 视图
   - ErrorMonitor 视图
   - DOMInspector 视图
   - AuditLog 视图
   - LiveMonitor 扩展（导航历史 Tab）
   - DeviceList 扩展（新增跳转链接）

5. **集成测试**（1 天）
   - 端到端测试所有页面
   - 验证数据流完整性
   - 性能测试（大量日志下的表现）

## P1 预计时间

**5-7 天**

## P1 技术难点

1. **DOM 树序列化性能**
   - 大页面 DOM 树可能上万节点，需按需加载或截断
   - 解决方案：懒加载 + 虚拟滚动 + 默认只展开前 3 层

2. **网络/控制台日志存储**
   - 多设备、长时间运行会累积大量日志
   - 解决方案：限制每个设备保留数量 + 定期清理过期数据

3. **WebSocket 广播性能**
   - 所有网络/控制台事件广播到所有 Web 客户端
   - 解决方案：按订阅过滤，不订阅则不推送

## P1 技术栈

- **后端存储**：内存存储（P1，P2 考虑持久化到 SQLite）
- **前端表格**：Element Plus `el-table` + 虚拟滚动
- **前端树**：Element Plus `el-tree` + 懒加载
- **前端时间线**：Element Plus `el-timeline`