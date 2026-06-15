/**
 * @electron-agent/shared
 * 共享类型和协议定义
 */

// ========== 导出类型 ==========
export type {
  DeviceInfo,
  Device,
  PageState,
  NetworkRequest,
  ConsoleLog,
  JSError,
  ScreenshotData,
  MaskConfig,
  AuditEvent,
  CommandResult,
  DOMNode,
  PerformanceMetrics,
  Cookie,
  CookieParam,
  StorageEntry,
} from './types';

// ========== 导出协议 ==========
export type {
  AgentRegisterMessage,
  AgentHeartbeatMessage,
  AgentScreenshotMessage,
  AgentPageChangedMessage,
  AgentNetworkBatchMessage,
  AgentConsoleBatchMessage,
  AgentErrorMessage,
  AgentResultMessage,
  AgentDOMMessage,
  AgentCookiesMessage,
  AgentStorageMessage,
  AgentUpstreamMessage,
  ServerStartCaptureMessage,
  ServerStopCaptureMessage,
  ServerScreenshotMessage,
  ServerClickMessage,
  ServerTypeMessage,
  ServerKeyMessage,
  ServerNavigateMessage,
  ServerEvalMessage,
  ServerScrollMessage,
  ServerGetDOMMessage,
  ServerGetInfoMessage,
  ServerSubscribeNetworkMessage,
  ServerSubscribeConsoleMessage,
  ServerGetCookiesMessage,
  ServerSetCookieMessage,
  ServerDeleteCookieMessage,
  ServerGetStorageMessage,
  ServerSetStorageMessage,
  ServerClearStorageMessage,
  ServerDownstreamMessage,
  ServerDevicesMessage,
  ServerDeviceUpdateMessage,
  ServerScreenshotBroadcast,
  ServerErrorBroadcast,
  ServerAuditBroadcast,
  ServerBroadcastMessage,
  WebSocketMessage,
} from './protocol';

export { isAgentUpstreamMessage, isServerDownstreamMessage, isServerBroadcastMessage } from './protocol';
