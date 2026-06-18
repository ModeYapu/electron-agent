/**
 * 通信协议消息定义
 * Agent ↔ Relay Server ↔ Web Console
 */

import type { DeviceInfo, ScreenshotData, PageState, NetworkRequest, ConsoleLog, JSError, CommandResult, DOMNode, Cookie, StorageEntry } from './types';

// ========== Agent → Server（上行）==========

export interface AgentRegisterMessage {
  type: 'agent:register';
  deviceId: string;
  info: DeviceInfo;
}

export interface AgentHeartbeatMessage {
  type: 'agent:heartbeat';
  deviceId: string;
  timestamp: number;
}

export interface AgentScreenshotMessage {
  type: 'agent:screenshot';
  deviceId: string;
  data: ScreenshotData;
}

export interface AgentPageChangedMessage {
  type: 'agent:pageChanged';
  deviceId: string;
  state: PageState;
}

// Unified BATCH model: agent always sends batches for high-frequency streams.
// One message type per stream, one array field — no single/batch dual path.
export interface AgentNetworkBatchMessage {
  type: 'agent:networkBatch';
  deviceId: string;
  batch: NetworkRequest[];
}

export interface AgentConsoleBatchMessage {
  type: 'agent:consoleBatch';
  deviceId: string;
  batch: ConsoleLog[];
}

export interface AgentErrorMessage {
  type: 'agent:error';
  deviceId: string;
  error: JSError;
}

export interface AgentResultMessage {
  type: 'agent:result';
  deviceId: string;
  requestId: string;
  result: CommandResult;
}

export interface AgentDOMMessage {
  type: 'agent:dom';
  deviceId: string;
  requestId: string;
  dom: DOMNode;
}

export interface AgentCookiesMessage {
  type: 'agent:cookies';
  deviceId: string;
  requestId?: string;
  cookies: Cookie[];
}

export interface AgentStorageMessage {
  type: 'agent:storage';
  deviceId: string;
  requestId?: string;
  storage: StorageEntry[];
}

export type AgentUpstreamMessage =
  | AgentRegisterMessage
  | AgentHeartbeatMessage
  | AgentScreenshotMessage
  | AgentPageChangedMessage
  | AgentNetworkBatchMessage
  | AgentConsoleBatchMessage
  | AgentErrorMessage
  | AgentResultMessage
  | AgentDOMMessage
  | AgentCookiesMessage
  | AgentStorageMessage;

// ========== Server → Agent（下行）==========

export interface ServerStartCaptureMessage {
  type: 'cmd:startCapture';
  deviceId: string;
  requestId: string;
  fps: number;
  quality: number;
  /** If true, server will save frames and compile a video on stop */
  record?: boolean;
}

export interface ServerStopCaptureMessage {
  type: 'cmd:stopCapture';
  deviceId: string;
  requestId: string;
}

export interface ServerScreenshotMessage {
  type: 'cmd:screenshot';
  deviceId: string;
  requestId: string;
  quality: number;
}

export interface ServerClickMessage {
  type: 'cmd:click';
  deviceId: string;
  requestId: string;
  x: number;
  y: number;
  button: 'left' | 'right' | 'middle';
}

export interface ServerTypeMessage {
  type: 'cmd:type';
  deviceId: string;
  requestId: string;
  text: string;
}

export interface ServerKeyMessage {
  type: 'cmd:key';
  deviceId: string;
  requestId: string;
  keyCode: number;
  action: 'down' | 'up' | 'press';
}

export interface ServerNavigateMessage {
  type: 'cmd:navigate';
  deviceId: string;
  requestId: string;
  url: string;
}

export interface ServerEvalMessage {
  type: 'cmd:eval';
  deviceId: string;
  requestId: string;
  code: string;
}

export interface ServerScrollMessage {
  type: 'cmd:scroll';
  deviceId: string;
  requestId: string;
  deltaX: number;
  deltaY: number;
  /** Cursor position in viewport coords — used to find the scrollable element under the cursor */
  x?: number;
  y?: number;
}

export interface ServerGetDOMMessage {
  type: 'cmd:getDOM';
  deviceId: string;
  requestId: string;
  selector?: string;
}

export interface ServerGetInfoMessage {
  type: 'cmd:getInfo';
  deviceId: string;
  requestId: string;
}

export interface ServerSubscribeNetworkMessage {
  type: 'cmd:subscribeNetwork';
  deviceId: string;
  requestId: string;
  enable: boolean;
}

export interface ServerSubscribeConsoleMessage {
  type: 'cmd:subscribeConsole';
  deviceId: string;
  requestId: string;
  enable: boolean;
}

export interface ServerGetCookiesMessage {
  type: 'cmd:getCookies';
  deviceId: string;
  requestId: string;
}

export interface ServerSetCookieMessage {
  type: 'cmd:setCookie';
  deviceId: string;
  requestId: string;
  cookie: import('./types').CookieParam;
}

export interface ServerDeleteCookieMessage {
  type: 'cmd:deleteCookie';
  deviceId: string;
  requestId: string;
  name: string;
}

export interface ServerGetStorageMessage {
  type: 'cmd:getStorage';
  deviceId: string;
  requestId: string;
  storageType: 'localStorage' | 'sessionStorage';
}

export interface ServerSetStorageMessage {
  type: 'cmd:setStorage';
  deviceId: string;
  requestId: string;
  key: string;
  value: string;
  storageType: 'localStorage' | 'sessionStorage';
}

export interface ServerClearStorageMessage {
  type: 'cmd:clearStorage';
  deviceId: string;
  requestId: string;
  storageType: 'localStorage' | 'sessionStorage';
}

export interface ServerFillFormMessage {
  type: 'cmd:fillForm';
  deviceId: string;
  requestId: string;
  fields: Record<string, string | boolean | number>;
}

export interface ServerGetFieldsMessage {
  type: 'cmd:getFields';
  deviceId: string;
  requestId: string;
}

export interface ServerShowCursorMessage {
  type: 'cmd:showCursor';
  deviceId: string;
  requestId: string;
  /** Viewport x coordinate, or -1 to hide */
  x: number;
  /** Viewport y coordinate, or -1 to hide */
  y: number;
}

export type ServerDownstreamMessage =
  | ServerStartCaptureMessage
  | ServerStopCaptureMessage
  | ServerScreenshotMessage
  | ServerClickMessage
  | ServerTypeMessage
  | ServerKeyMessage
  | ServerNavigateMessage
  | ServerEvalMessage
  | ServerScrollMessage
  | ServerGetDOMMessage
  | ServerGetInfoMessage
  | ServerSubscribeNetworkMessage
  | ServerSubscribeConsoleMessage
  | ServerGetCookiesMessage
  | ServerSetCookieMessage
  | ServerDeleteCookieMessage
  | ServerGetStorageMessage
  | ServerSetStorageMessage
  | ServerClearStorageMessage
  | ServerFillFormMessage
  | ServerGetFieldsMessage
  | ServerShowCursorMessage;

// ========== Server → Web（广播）==========

export interface ServerDevicesMessage {
  type: 'server:devices';
  devices: Array<{
    info: DeviceInfo;
    status: 'online' | 'offline';
    lastSeen: number;
    currentPage?: PageState;
  }>;
}

export interface ServerDeviceUpdateMessage {
  type: 'server:deviceUpdate';
  deviceId: string;
  status: 'online' | 'offline';
  lastSeen: number;
  currentPage?: PageState;
}

export interface ServerScreenshotBroadcast {
  type: 'server:screenshot';
  deviceId: string;
  data: ScreenshotData;
}

/** Sent when recording starts on the relay server */
export interface ServerRecordingStarted {
  type: 'server:recordingStarted';
  deviceId: string;
  sessionId: string;
}

/** Sent when recording is compiled and ready for download */
export interface ServerRecordingComplete {
  type: 'server:recordingComplete';
  deviceId: string;
  sessionId: string;
  /** URL path to download the mp4, e.g. /api/recordings/<sessionId>/video.mp4 */
  videoUrl: string;
  durationMs: number;
  frameCount: number;
}

export interface ServerErrorBroadcast {
  type: 'server:error';
  deviceId: string;
  error: JSError;
}

export interface ServerAuditBroadcast {
  type: 'server:audit';
  event: {
    type: 'connect' | 'disconnect' | 'screenshot' | 'click' | 'type' | 'navigate' | 'eval';
    deviceId: string;
    operatorId: string;
    timestamp: number;
    detail: string;
  };
}

export interface ServerCommandError {
  type: 'server:commandError';
  deviceId: string;
  requestId: string;
  error: string;
}

export interface ServerCookiesBroadcast {
  type: 'server:cookies';
  deviceId: string;
  cookies: Cookie[];
}

export interface ServerStorageBroadcast {
  type: 'server:storage';
  deviceId: string;
  storage: StorageEntry[];
}

export interface ServerNetworkBatchBroadcast {
  type: 'server:networkBatch';
  deviceId: string;
  batch: NetworkRequest[];
}

export interface ServerConsoleBatchBroadcast {
  type: 'server:consoleBatch';
  deviceId: string;
  batch: ConsoleLog[];
}

export interface ServerResultBroadcast {
  type: 'server:result';
  deviceId: string;
  requestId: string;
  result: CommandResult;
}

export interface ServerDOMBroadcast {
  type: 'server:dom';
  deviceId: string;
  requestId: string;
  dom: DOMNode;
}

export type ServerBroadcastMessage =
  | ServerDevicesMessage
  | ServerDeviceUpdateMessage
  | ServerScreenshotBroadcast
  | ServerRecordingStarted
  | ServerRecordingComplete
  | ServerErrorBroadcast
  | ServerAuditBroadcast
  | ServerCommandError
  | ServerCookiesBroadcast
  | ServerStorageBroadcast
  | ServerNetworkBatchBroadcast
  | ServerConsoleBatchBroadcast
  | ServerDOMBroadcast
  | ServerResultBroadcast;

// ========== Web → Server（控制指令）==========

// 复用 ServerDownstreamMessage，因为 Web 端发送的指令会被转发给 Agent

// ========== 联合类型 ==========

export type WebSocketMessage = AgentUpstreamMessage | ServerDownstreamMessage | ServerBroadcastMessage;

// ========== 消息验证工具 ==========

export function isAgentUpstreamMessage(msg: unknown): msg is AgentUpstreamMessage {
  return (
    msg !== null &&
    typeof msg === 'object' &&
    'type' in msg &&
    typeof msg.type === 'string' &&
    msg.type.startsWith('agent:')
  );
}

export function isServerDownstreamMessage(msg: unknown): msg is ServerDownstreamMessage {
  return (
    msg !== null &&
    typeof msg === 'object' &&
    'type' in msg &&
    typeof msg.type === 'string' &&
    msg.type.startsWith('cmd:')
  );
}

export function isServerBroadcastMessage(msg: unknown): msg is ServerBroadcastMessage {
  return (
    msg !== null &&
    typeof msg === 'object' &&
    'type' in msg &&
    typeof msg.type === 'string' &&
    msg.type.startsWith('server:')
  );
}
