/**
 * @electron-agent/relay-server
 * 中继服务器 - 设备注册、指令转发、广播
 */

import 'dotenv/config';
import http from 'http';
import crypto from 'crypto';
import express from 'express';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import { WebSocketServer, WebSocket } from 'ws';
import { isAgentUpstreamMessage, isServerDownstreamMessage, type ServerBroadcastMessage, type AgentUpstreamMessage, type Device, type ConsoleLog } from '@electron-agent/shared';
import { DeviceRegistry } from './device-registry';
import { AuthService } from './auth';
import { CommandBus } from './command-bus';
import { AuditStore } from './audit-store';
import { NetworkStore } from './network-store';
import { ConsoleStore } from './console-store';
import { ErrorStore } from './error-store';
import { RecordingManager } from './recording-manager';
import path from 'path';

// ========== 配置 ==========
const PORT = process.env.PORT || 9300;

/**
 * P2 CONFIG CLEANUP: No hardcoded credentials anywhere.
 * - Production: the env var is REQUIRED; missing → fatal exit.
 * - Development: if unset, generate an ephemeral per-startup secret (never a
 *   published constant) and log it so dev still works.
 */
function resolveSecret(name: string): string {
  const value = process.env[name];
  if (value) return value;

  if (process.env.NODE_ENV === 'production') {
    console.error(`FATAL: ${name} environment variable is required in production.`);
    process.exit(1);
  }

  const generated = crypto.randomBytes(8).toString('hex');  // 16 chars
  console.warn(`⚠️  [DEV] ${name} not set — generated ephemeral credential:\n      ${generated}\n     Set ${name} in your environment (.env) for stable credentials.`);
  return generated;
}

const AGENT_TOKEN = resolveSecret('AGENT_TOKEN');
const ADMIN_TOKEN = resolveSecret('ADMIN_TOKEN');
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'admin';
const ADMIN_PASSWORD = resolveSecret('ADMIN_PASSWORD');

// ========== 初始化服务 ==========
const app = express();
const server = http.createServer(app);

const deviceRegistry = new DeviceRegistry();
const authService = new AuthService({
  agentTokens: new Set([AGENT_TOKEN]),
  adminTokens: new Set([ADMIN_TOKEN]),
});
const commandBus = new CommandBus();
const auditStore = new AuditStore();
const networkStore = new NetworkStore();
const consoleStore = new ConsoleStore();
const errorStore = new ErrorStore();
const recordingManager = new RecordingManager(
  path.join(__dirname, '..', 'recordings')
);

// ========== 时钟偏移跟踪 ==========
// 为每个 agent 记录其时钟与 relay 的偏移量 (agentTime - relayTime)
const clockOffsets: Map<string, number> = new Map();

// ========== P1 DEVICE STATE SYNC ==========
// Registry is event-driven: broadcast device changes to every web client so a
// console that connected before an agent came online sees it appear on its own.
// Structural changes (register/unregister/online/offline/stale) → full list.
// Page changes → granular server:deviceUpdate.
deviceRegistry.on('devicesUpdated', () => {
  commandBus.broadcastToWeb({
    type: 'server:devices',
    devices: deviceRegistry.getAllDevices(),
  } as ServerBroadcastMessage);
});

deviceRegistry.on('deviceUpdated', (device: Device) => {
  commandBus.broadcastToWeb({
    type: 'server:deviceUpdate',
    deviceId: device.info.deviceId,
    status: device.status,
    lastSeen: device.lastSeen,
    currentPage: device.currentPage,
  } as ServerBroadcastMessage);
});

// ========== Express 中间件 ==========
app.use(cors());
app.use(express.json());

// Rate limiting for commands
const commandRateLimiter = rateLimit({
  windowMs: 1000, // 1 second
  max: 10, // 10 requests per second
  message: { error: 'Too many requests, please try again later' },
  standardHeaders: true,
  legacyHeaders: false,
});

// Rate limiting for login endpoint
const loginRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // 5 login attempts per 15 minutes
  message: { error: 'Too many login attempts, please try again later' },
  standardHeaders: true,
  legacyHeaders: false,
});

// ========== HTTP 路由 ==========
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: Date.now() });
});

// Login endpoint
app.post('/api/login', loginRateLimiter, (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password are required' });
  }

  // Validate credentials
  if (username === ADMIN_USERNAME && password === ADMIN_PASSWORD) {
    const token = authService.generateAdminToken(username, 'admin');
    return res.json({
      token,
      role: 'admin',
      expiresIn: '24h'
    });
  }

  return res.status(401).json({ error: 'Invalid credentials' });
});

app.get('/api/devices', (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token || !authService.verifyWebRequest(token)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  res.json({ devices: deviceRegistry.getAllDevices() });
});

app.get('/api/audit', (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token || !authService.verifyAdminToken(token)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const deviceId = req.query.deviceId as string | undefined;
  const type = req.query.type as string | undefined;
  const from = req.query.from ? parseInt(req.query.from as string) : undefined;
  const to = req.query.to ? parseInt(req.query.to as string) : undefined;
  const limit = req.query.limit ? parseInt(req.query.limit as string) : 50;
  const offset = req.query.offset ? parseInt(req.query.offset as string) : 0;

  let events = deviceId ? auditStore.getDeviceEvents(deviceId) : auditStore.getEvents();

  if (type) {
    events = events.filter(e => e.type === type);
  }

  if (from) {
    events = events.filter(e => e.timestamp >= from);
  }

  if (to) {
    events = events.filter(e => e.timestamp <= to);
  }

  const sliced = events.slice(offset, offset + limit);
  res.json({ events: sliced, total: events.length });
});

app.get('/api/network', (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token || !authService.verifyWebRequest(token)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const deviceId = req.query.deviceId as string;
  if (!deviceId) {
    return res.status(400).json({ error: 'deviceId is required' });
  }

  const status = req.query.status as string | undefined;
  const method = req.query.method as string | undefined;
  const limit = req.query.limit ? parseInt(req.query.limit as string) : 50;
  const offset = req.query.offset ? parseInt(req.query.offset as string) : 0;

  const requests = networkStore.getFilteredRequests(deviceId, { status, method, limit, offset });
  const allRequests = networkStore.getFilteredRequests(deviceId);

  res.json({ requests, total: allRequests.length });
});

app.get('/api/console', (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token || !authService.verifyWebRequest(token)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const deviceId = req.query.deviceId as string;
  if (!deviceId) {
    return res.status(400).json({ error: 'deviceId is required' });
  }

  const level = req.query.level as ConsoleLog['level'] | undefined;
  const limit = req.query.limit ? parseInt(req.query.limit as string) : 50;
  const offset = req.query.offset ? parseInt(req.query.offset as string) : 0;

  const logs = consoleStore.getFilteredLogs(deviceId, { level, limit, offset });
  const allLogs = consoleStore.getFilteredLogs(deviceId);

  res.json({ logs, total: allLogs.length });
});

app.get('/api/errors', (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token || !authService.verifyWebRequest(token)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const deviceId = req.query.deviceId as string;
  if (!deviceId) {
    return res.status(400).json({ error: 'deviceId is required' });
  }

  const from = req.query.from ? parseInt(req.query.from as string) : undefined;
  const to = req.query.to ? parseInt(req.query.to as string) : undefined;
  const limit = req.query.limit ? parseInt(req.query.limit as string) : 50;
  const offset = req.query.offset ? parseInt(req.query.offset as string) : 0;

  const errors = errorStore.getFilteredErrors(deviceId, { from, to, limit, offset });
  const allErrors = errorStore.getFilteredErrors(deviceId, { from, to });

  res.json({ errors, total: allErrors.length });
});

// ========== Recording Endpoints ==========

/** List completed recordings */
app.get('/api/recordings', (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token || !authService.verifyWebRequest(token)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  const list = recordingManager.listCompleted();
  res.json({ recordings: list.map(r => ({
    sessionId: r.sessionId,
    deviceId: r.deviceId,
    videoUrl: r.videoUrl,
    durationMs: r.durationMs,
    frameCount: r.frameCount,
    fileSizeBytes: r.fileSizeBytes,
  }))});
});

/** Serve recording video file */
app.get('/api/recordings/:sessionId/video.mp4', (req, res) => {
  const result = recordingManager.getResult(req.params.sessionId);
  if (!result) {
    return res.status(404).json({ error: 'Recording not found' });
  }
  res.sendFile(result.videoPath);
});

// ========== WebSocket 服务器 ==========
const wss = new WebSocketServer({ server, path: '/ws' });

wss.on('connection', (ws: WebSocket, req) => {
  console.log('[DEBUG] wss.on(connection) fired, url:', req.url);
  const url = req.url || '';
  const urlObj = new URL(url, `http://${req.headers.host}`);
  const deviceId = urlObj.searchParams.get('deviceId');
  const tokenFromUrl = urlObj.searchParams.get('token');

  // Support both URL token (legacy) and first-message auth
  if (tokenFromUrl) {
    // Legacy: token in URL
    const agentConn = authService.verifyAgentConnection(tokenFromUrl, deviceId || '');
    if (agentConn) {
      handleAgentConnection(ws, agentConn.deviceId);
    } else {
      const webRole = authService.verifyWebConnection(tokenFromUrl);
      if (webRole) {
        handleWebConnection(ws, webRole);
      } else {
        ws.close(1008, 'Invalid token');
      }
    }
  } else {
    // New: wait for first message with auth
    const authTimeout = setTimeout(() => {
      ws.close(1008, 'Authentication timeout');
    }, 10000);

    ws.once('message', (data: Buffer) => {
      clearTimeout(authTimeout);
      const raw = data.toString();
      console.log('[AUTH-DEBUG] received first message:', raw.substring(0, 120));
      try {
        const msg = JSON.parse(data.toString());
        if (msg.type !== 'auth' || !msg.token) {
          ws.close(1008, 'Invalid authentication message');
          return;
        }
        // P0 SECURITY: Use split methods
        const agentConn = authService.verifyAgentConnection(msg.token, msg.deviceId || '');
        if (agentConn) {
          handleAgentConnection(ws, agentConn.deviceId);
        } else {
          const webRole = authService.verifyWebConnection(msg.token);
          if (webRole) {
            handleWebConnection(ws, webRole);
          } else {
            ws.close(1008, 'Invalid token');
          }
        }
      } catch {
        ws.close(1008, 'Invalid authentication message');
      }
    });
  }

  ws.on('error', (err) => {
    console.error('WebSocket error:', err);
  });
});

function handleAgentConnection(ws: WebSocket, deviceId: string): void {
  console.log(`[Agent] Connected: ${deviceId}`);

  // 注册到 CommandBus
  commandBus.registerAgent(deviceId, ws);

  // 监听 Agent 消息
  ws.on('message', (data: Buffer) => {
    try {
      const message = JSON.parse(data.toString());

      if (!isAgentUpstreamMessage(message)) {
        console.warn('Invalid agent message:', message);
        return;
      }

      handleAgentMessage(message, ws);
    } catch (err) {
      console.error('Failed to parse agent message:', err);
    }
  });

  ws.on('close', () => {
    console.log(`[Agent] Disconnected: ${deviceId}`);
    deviceRegistry.unregister(deviceId);
  });
}

function handleWebConnection(ws: WebSocket, role: 'admin' | 'viewer'): void {
  console.log(`[Web] Client connected (role: ${role})`);

  commandBus.registerWeb(ws, role);

  // 发送当前设备列表
  const devices = deviceRegistry.getAllDevices();
  console.log(`[Web] Sending server:devices — ${devices.length} device(s)`);
  const payload = JSON.stringify({
    type: 'server:devices',
    devices,
  } as ServerBroadcastMessage);
  console.log(`[Web] Payload size: ${payload.length} bytes, readyState: ${ws.readyState}`);
  ws.send(payload, (err) => {
    if (err) console.error(`[Web] ws.send error:`, err);
    else console.log(`[Web] server:devices sent OK`);
  });

  ws.on('message', (data: Buffer) => {
    try {
      const message = JSON.parse(data.toString());

      if (!isServerDownstreamMessage(message)) {
        console.warn('Invalid web command:', message);
        return;
      }

      // P0 SECURITY: Command authorization check
      if (!authService.authorizeCommand(role, message.type)) {
        console.warn(`[SECURITY] Viewer attempted unauthorized command: ${message.type}`);
        ws.send(JSON.stringify({
          type: 'server:commandError',
          deviceId: message.deviceId,
          requestId: message.requestId,
          error: 'Authorization denied: viewer cannot execute this command',
        }));
        return;
      }

      // --- Recording intercept ---
      const deviceId = message.deviceId || '';
      if (message.type === 'cmd:startCapture' && (message as any).record) {
        const session = recordingManager.startSession(deviceId);
        commandBus.broadcastToWeb({
          type: 'server:recordingStarted',
          deviceId,
          sessionId: session.sessionId,
        } as ServerBroadcastMessage);
      }

      // Forward to the corresponding Agent
      const success = commandBus.forwardToAgent(deviceId, message, ws);

      if (message.type === 'cmd:stopCapture') {
        recordingManager.stopSession(deviceId).then(result => {
          if (result) {
            commandBus.broadcastToWeb({
              type: 'server:recordingComplete',
              deviceId,
              sessionId: result.sessionId,
              videoUrl: result.videoUrl,
              durationMs: result.durationMs,
              frameCount: result.frameCount,
            } as ServerBroadcastMessage);
          }
        }).catch(err => console.error('[Recording] stopSession error:', err));
      }

      if (!success) {
        console.warn(`Agent not connected: ${message.deviceId}`);
        // P0 COMMAND RECEIPT: Send immediate error if agent not connected
        if (message.requestId) {
          ws.send(JSON.stringify({
            type: 'server:commandError',
            deviceId: message.deviceId,
            requestId: message.requestId,
            error: 'Device not connected',
          } as ServerBroadcastMessage));
        }
      }
    } catch (err) {
      console.error('Failed to parse web message:', err);
    }
  });
}

function handleAgentMessage(message: AgentUpstreamMessage, ws: WebSocket): void {
  const { deviceId } = message;
  console.log(`[Agent-MSG] ${deviceId?.slice(0,8)}... type=${message.type}`);

  switch (message.type) {
    case 'agent:register':
      // 计算时钟偏移 (agentTime - relayTime)，正值表示 agent 时钟更快
      const agentTime = (message as any).agentTime;
      if (agentTime) {
        const offset = agentTime - Date.now();
        clockOffsets.set(deviceId, offset);
        console.log(`[TIME-SYNC] ${deviceId?.slice(0,8)} offset=${offset}ms`);
      }
      deviceRegistry.register(message.info);
      auditStore.log({
        type: 'connect',
        deviceId: message.deviceId,
        operatorId: 'system',
        timestamp: Date.now(),
        detail: `Agent registered: ${message.info.name}`,
      });
      break;

    case 'agent:heartbeat':
      deviceRegistry.updateHeartbeat(deviceId);
      break;

    case 'agent:pageChanged':
      deviceRegistry.updatePageState(deviceId, message.state);
      break;

    case 'agent:screenshot':
      // Save frame if recording for this device
      if (message.data?.data) {
        recordingManager.saveFrame(message.deviceId, message.data.data);
      }
      // 注入 relay 接收时间戳 + 时钟偏移信息
      const relayMs = Date.now();
      const tsData: any = { ...(message.data || {}), relayMs };
      if (clockOffsets.has(deviceId)) {
        tsData.clockOffset = clockOffsets.get(deviceId);
      }
      // Re-wrap agent:* as server:* before broadcasting
      commandBus.broadcastToWeb({
        type: 'server:screenshot',
        deviceId: message.deviceId,
        data: tsData,
      } as ServerBroadcastMessage);
      break;

    case 'agent:networkBatch': {
      // Unified BATCH model: persist every request, then broadcast one batch.
      const batch = message.batch ?? [];
      for (const req of batch) {
        networkStore.addRequest(deviceId, req);
      }
      if (batch.length > 0) {
        commandBus.broadcastToWeb({
          type: 'server:networkBatch',
          deviceId: message.deviceId,
          batch,
        } as ServerBroadcastMessage);
      }
      break;
    }

    case 'agent:consoleBatch': {
      const batch = message.batch ?? [];
      for (const log of batch) {
        consoleStore.addLog(deviceId, log);
      }
      if (batch.length > 0) {
        commandBus.broadcastToWeb({
          type: 'server:consoleBatch',
          deviceId: message.deviceId,
          batch,
        } as ServerBroadcastMessage);
      }
      break;
    }

    case 'agent:error':
      errorStore.addError(deviceId, message.error);
      // P0 PROTOCOL: Re-wrap as server:error
      commandBus.broadcastToWeb({
        type: 'server:error',
        deviceId: message.deviceId,
        error: message.error,
      } as ServerBroadcastMessage);
      break;

    case 'agent:result':
      // P0 COMMAND RECEIPT: Resolve the pending request — ONLY send to requester, not broadcast
      commandBus.resolveRequest(deviceId, message.requestId, message.result);
      break;

    case 'agent:dom':
      // Resolve ONLY to the requesting web client — DOM data is sensitive
      commandBus.resolveRequest(deviceId, message.requestId, { success: true, data: message.dom });
      break;

    case 'agent:cookies':
      // Resolve ONLY to the requesting web client — cookies are sensitive
      commandBus.resolveRequest(deviceId, message.requestId || '', { success: true, data: message.cookies });
      break;

    case 'agent:storage':
      // Resolve ONLY to the requesting web client — storage data is sensitive
      commandBus.resolveRequest(deviceId, message.requestId || '', { success: true, data: message.storage });
      break;
  }
}

// ========== 定时清理 ==========
setInterval(() => {
  deviceRegistry.cleanupStaleDevices(2 * 60 * 1000); // 2 分钟
}, 30 * 1000); // 每 30 秒检查一次

// ========== 启动服务器 ==========
server.listen(PORT, () => {
  console.log(`🚀 Relay Server listening on port ${PORT}`);
  console.log(`📡 WebSocket endpoint: ws://localhost:${PORT}/ws`);
  if (process.env.NODE_ENV === 'production') {
    console.log('🔑 AGENT_TOKEN / ADMIN_TOKEN / ADMIN_PASSWORD: loaded from environment');
  } else {
    // Dev: surface the ephemeral credentials above so the agent client can match.
    console.log('🔑 Credentials logged above (dev mode). Use /api/login for the web console.');
  }
});

// ========== 优雅关闭 ==========
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully...');
  wss.close();
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.log('SIGINT received, shutting down gracefully...');
  wss.close();
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});
