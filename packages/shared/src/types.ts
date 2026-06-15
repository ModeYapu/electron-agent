/**
 * 共享类型定义 - Electron Agent 远程监控与操作平台
 */

// ========== 设备信息 ==========

export interface DeviceInfo {
  deviceId: string;
  name: string;
  os: 'win32' | 'darwin' | 'linux';
  version: string; // Electron version
  appVersion: string; // 业务应用版本
  ip: string;
  tags?: string[];
}

export interface Device {
  info: DeviceInfo;
  status: 'online' | 'offline';
  lastSeen: number;
  currentPage?: PageState;
}

export interface PageState {
  url: string;
  title: string;
}

// ========== 网络请求 ==========

export interface NetworkRequest {
  method: string;
  url: string;
  status: number;
  mimeType: string;
  requestHeaders?: Record<string, string>;
  responseHeaders?: Record<string, string>;
  requestBody?: string;
  responseBody?: string; // 仅小响应
  timing: number; // ms
  timestamp: number;
}

// ========== 控制台日志 ==========

export interface ConsoleLog {
  level: 'log' | 'warn' | 'error' | 'info' | 'debug';
  args: string[];
  timestamp: number;
}

// ========== JS 错误 ==========

export interface JSError {
  message: string;
  stack: string;
  timestamp: number;
}

// ========== 截图 ==========

export interface ScreenshotData {
  data: string; // base64 JPEG
  width: number;
  height: number;
  quality: number; // 0-100
  timestamp: number;
}

export interface MaskConfig {
  enabled: boolean;
  cssSelectors?: string[]; // CSS selectors to mask (e.g., ['.password-field', '.sensitive-info'])
  fixedRegions?: Array<{ // Fixed coordinate regions to mask
    x: number;
    y: number;
    width: number;
    height: number;
  }>;
  blurRadius?: number; // Blur radius in pixels (default: 10)
}

// ========== 审计事件 ==========

export interface AuditEvent {
  type: 'connect' | 'disconnect' | 'screenshot' | 'click' | 'type' | 'navigate' | 'eval';
  deviceId: string;
  operatorId: string;
  timestamp: number;
  detail: string;
}

// ========== 指令结果 ==========

export interface CommandResult {
  success: boolean;
  data?: any;
  error?: string;
}

// ========== DOM 快照 ==========

export interface DOMNode {
  nodeId: number;
  nodeType: number;
  nodeName: string;
  localName?: string;
  nodeValue?: string;
  attributes?: Record<string, string>;
  children?: DOMNode[];
}

// ========== 性能指标 ==========

export interface PerformanceMetrics {
  timestamp: number;
  metrics: Array<{
    name: string;
    value: number;
  }>;
}

// ========== Cookie 管理 ==========

export interface Cookie {
  name: string;
  value: string;
  domain?: string;
  path?: string;
  expires?: number; // Unix timestamp
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: 'Strict' | 'Lax' | 'None';
}

export interface CookieParam {
  name: string;
  value: string;
  domain?: string;
  path?: string;
  expires?: number; // Unix timestamp
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: 'Strict' | 'Lax' | 'None';
}

// ========== Storage 管理 ==========

export interface StorageEntry {
  key: string;
  value: string;
  storageType: 'localStorage' | 'sessionStorage';
}
