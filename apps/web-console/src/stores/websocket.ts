import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import type {
  ServerBroadcastMessage,
  ServerDownstreamMessage,
  Device,
  Cookie,
  CookieParam,
  StorageEntry,
  CommandResult,
  DOMNode,
} from '@electron-agent/shared';

// P0 COMMAND RECEIPT: Pending request tracking
interface PendingRequest {
  resolve: (result: CommandResult) => void;
  reject: (error: string) => void;
  timestamp: number;
}

// A downstream command as a view is allowed to build it: every required field
// EXCEPT deviceId (the store injects the selected device) and requestId
// (the store generates one if omitted). This keeps call sites terse and typed.
type SendableCommand = {
  [K in ServerDownstreamMessage['type']]: Omit<Extract<ServerDownstreamMessage, { type: K }>, 'deviceId' | 'requestId'> & { requestId?: string };
}[ServerDownstreamMessage['type']];

// Declare build-time injected globals from vite.config.ts define
declare const __API_URL__: string;
declare const __WS_URL__: string;

const JWT_STORAGE_KEY = 'ea_jwt';

// WebSocket endpoint. Env var > same-origin > localhost fallback.
const WS_BASE = __WS_URL__ ||
  `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}/ws` ||
  'ws://localhost:9300/ws';

// API base for fetch() calls. Env var > same-origin > localhost fallback.
const API_BASE = __API_URL__ || window.location.origin || 'http://localhost:9300';

// Export for use in other views
export function getApiBase(): string { return API_BASE; }

// Exported so any view making a raw HTTP /api call reads the same JWT.
export function getStoredJwt(): string | null {
  return localStorage.getItem(JWT_STORAGE_KEY);
}

function generateRequestId(): string {
  return `req_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

export const useWebSocketStore = defineStore('websocket', () => {
  const ws = ref<WebSocket | null>(null);
  const connected = ref(false);
  const jwt = ref<string | null>(getStoredJwt());
  const role = ref<'admin' | 'viewer' | null>(null);
  const authError = ref<string | null>(null);

  const devices = ref<Device[]>([]);
  const currentDevice = ref<Device | null>(null);
  const currentScreenshot = ref<string | null>(null);
  const viewportWidth = ref(0);
  const viewportHeight = ref(0);
  const networkLogs = ref<Array<{ deviceId: string; request: any; timestamp: number }>>([]);
  const consoleLogs = ref<Array<{ deviceId: string; log: any; timestamp: number }>>([]);
  const errorLogs = ref<Array<{ deviceId: string; error: any; timestamp: number }>>([]);
  const cookies = ref<Cookie[]>([]);
  const storage = ref<StorageEntry[]>([]);
  const domSnapshot = ref<DOMNode | null>(null);

  // P0 COMMAND RECEIPT: Track pending requests
  const pendingRequests = ref<Map<string, PendingRequest>>(new Map());
  const commandLogs = ref<Array<{ success: boolean; message: string; timestamp: number }>>([]);

  // ========== Auth ==========

  // P2 CONFIG CLEANUP: real login flow. POST /api/login → JWT, persisted in
  // localStorage; the WebSocket is then opened with that JWT (no hardcoded token).
  const login = async (username: string, password: string): Promise<boolean> => {
    authError.value = null;
    try {
      const res = await fetch(`${API_BASE}/api/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: 'Login failed' }));
        authError.value = body.error || 'Invalid credentials';
        return false;
      }

      const data = await res.json();
      jwt.value = data.token;
      role.value = data.role || 'admin';
      localStorage.setItem(JWT_STORAGE_KEY, data.token);

      connect();
      return true;
    } catch (err) {
      authError.value = err instanceof Error ? err.message : 'Network error';
      return false;
    }
  };

  const logout = () => {
    jwt.value = null;
    role.value = null;
    localStorage.removeItem(JWT_STORAGE_KEY);
    disconnect();
  };

  const isAuthenticated = computed(() => jwt.value !== null);

  // ========== Connection ==========

  const connect = () => {
    const token = jwt.value || getStoredJwt();
    if (!token) {
      // No credentials yet — the Login view is responsible for obtaining them.
      return;
    }
    if (ws.value && (ws.value.readyState === WebSocket.OPEN || ws.value.readyState === WebSocket.CONNECTING)) {
      return;
    }

    const wsUrl = `${WS_BASE}?token=${encodeURIComponent(token)}`;
    ws.value = new WebSocket(wsUrl);

    ws.value.onopen = () => {
      connected.value = true;
      console.log('WebSocket connected');
    };

    ws.value.onclose = () => {
      connected.value = false;
      console.log('WebSocket disconnected');
      // P0 COMMAND RECEIPT: Reject all pending requests on disconnect
      for (const [requestId, pending] of pendingRequests.value) {
        pending.reject('WebSocket disconnected');
        addCommandLog(false, `Command ${requestId} failed: WebSocket disconnected`);
      }
      pendingRequests.value.clear();
    };

    ws.value.onerror = (err) => {
      console.error('WebSocket error:', err);
    };

    ws.value.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data) as ServerBroadcastMessage;
        handleMessage(message);
      } catch (err) {
        console.error('Failed to parse WebSocket message:', err);
      }
    };
  };

  const disconnect = () => {
    if (ws.value) {
      ws.value.close();
      ws.value = null;
    }
    connected.value = false;
  };

  // ========== Commands ==========

  // P0 COMMAND RECEIPT: Send command and return promise resolved by server:result
  const send = (message: SendableCommand): Promise<CommandResult> => {
    return new Promise((resolve, reject) => {
      if (!ws.value || !connected.value) {
        reject('WebSocket not connected');
        addCommandLog(false, 'Command failed: WebSocket not connected');
        return;
      }

      if (!currentDevice.value) {
        reject('No device selected');
        addCommandLog(false, 'Command failed: No device selected');
        return;
      }

      const requestId = message.requestId ?? generateRequestId();
      // Inject the selected device + a requestId to complete the message.
      const messageWithDevice = {
        ...message,
        requestId,
        deviceId: currentDevice.value.info.deviceId,
      } as ServerDownstreamMessage;

      // Register pending request so server:result / server:commandError can resolve it.
      pendingRequests.value.set(requestId, {
        resolve,
        reject,
        timestamp: Date.now(),
      });

      // 10s client-side timeout (server also times out at 10s).
      setTimeout(() => {
        if (pendingRequests.value.has(requestId)) {
          pendingRequests.value.delete(requestId);
          reject('Command timeout (10s)');
          addCommandLog(false, `Command ${requestId} failed: Timeout (10s)`);
        }
      }, 10000);

      try {
        ws.value.send(JSON.stringify(messageWithDevice));
      } catch (err) {
        if (pendingRequests.value.has(requestId)) {
          pendingRequests.value.delete(requestId);
        }
        reject('Failed to send command');
        addCommandLog(false, 'Command failed: Failed to send command');
      }
    });
  };

  // P1 DOM/COOKIE/STORAGE full chain — typed helpers that flow through send()
  // → relay → agent executor → server:result, returning the payload directly.
  const getDOM = async (): Promise<DOMNode | null> => {
    const result = await send({ type: 'cmd:getDOM', requestId: generateRequestId() });
    if (result.success && result.data) {
      domSnapshot.value = result.data as DOMNode;
      return result.data as DOMNode;
    }
    throw new Error(result.error || 'Failed to get DOM');
  };

  const getCookies = async (): Promise<Cookie[]> => {
    const result = await send({ type: 'cmd:getCookies', requestId: generateRequestId() });
    if (result.success) {
      cookies.value = (result.data as Cookie[]) || [];
      return cookies.value;
    }
    throw new Error(result.error || 'Failed to get cookies');
  };

  const setCookie = async (cookie: CookieParam): Promise<void> => {
    const result = await send({ type: 'cmd:setCookie', requestId: generateRequestId(), cookie });
    if (!result.success) throw new Error(result.error || 'Failed to set cookie');
    // Refresh the list so the new cookie is reflected.
    await getCookies().catch(() => {});
  };

  const deleteCookie = async (name: string): Promise<void> => {
    const result = await send({ type: 'cmd:deleteCookie', requestId: generateRequestId(), name });
    if (!result.success) throw new Error(result.error || 'Failed to delete cookie');
    await getCookies().catch(() => {});
  };

  const getStorage = async (storageType: 'localStorage' | 'sessionStorage'): Promise<StorageEntry[]> => {
    const result = await send({ type: 'cmd:getStorage', requestId: generateRequestId(), storageType });
    if (result.success) {
      storage.value = (result.data as StorageEntry[]) || [];
      return storage.value;
    }
    throw new Error(result.error || 'Failed to get storage');
  };

  const setStorage = async (key: string, value: string, storageType: 'localStorage' | 'sessionStorage'): Promise<void> => {
    const result = await send({ type: 'cmd:setStorage', requestId: generateRequestId(), key, value, storageType });
    if (!result.success) throw new Error(result.error || 'Failed to set storage');
    await getStorage(storageType).catch(() => {});
  };

  const clearStorage = async (storageType: 'localStorage' | 'sessionStorage'): Promise<void> => {
    const result = await send({ type: 'cmd:clearStorage', requestId: generateRequestId(), storageType });
    if (!result.success) throw new Error(result.error || 'Failed to clear storage');
    await getStorage(storageType).catch(() => {});
  };

  const subscribeNetwork = async (enable: boolean): Promise<void> => {
    await send({ type: 'cmd:subscribeNetwork', requestId: generateRequestId(), enable });
  };

  const subscribeConsole = async (enable: boolean): Promise<void> => {
    await send({ type: 'cmd:subscribeConsole', requestId: generateRequestId(), enable });
  };

  const fillForm = async (fields: Record<string, string | boolean | number>): Promise<any> => {
    const result = await send({ type: 'cmd:fillForm', requestId: generateRequestId(), fields });
    if (result.success) {
      addCommandLog(true, `Batch filled ${Object.keys(fields).length} fields`);
      return result.data;
    }
    addCommandLog(false, `FillForm failed: ${result.error}`);
    throw new Error(result.error || 'Failed to fill form');
  };

  const getFields = async (): Promise<any[]> => {
    const result = await send({ type: 'cmd:getFields', requestId: generateRequestId() });
    if (result.success) {
      // Refresh screenshot after scanning to show updated page
      send({ type: 'cmd:screenshot', requestId: generateRequestId(), quality: 40 }).catch(() => {});
      return (result.data as any[]) || [];
    }
    throw new Error(result.error || 'Failed to get fields');
  };

  // ========== Inbound message handling ==========

  const handleMessage = (message: ServerBroadcastMessage) => {
    switch (message.type) {
      case 'server:devices':
        devices.value = message.devices;
        // Keep currentDevice reference fresh after a full-list refresh.
        if (currentDevice.value) {
          const fresh = devices.value.find(d => d.info.deviceId === currentDevice.value!.info.deviceId);
          if (fresh) currentDevice.value = fresh;
        }
        break;

      case 'server:deviceUpdate': {
        const idx = devices.value.findIndex(d => d.info.deviceId === message.deviceId);
        if (idx !== -1) {
          const updated: Device = {
            ...devices.value[idx],
            status: message.status,
            lastSeen: message.lastSeen,
            currentPage: message.currentPage,
          };
          // Replace array entry reactively.
          devices.value = [
            ...devices.value.slice(0, idx),
            updated,
            ...devices.value.slice(idx + 1),
          ];
          if (currentDevice.value?.info.deviceId === message.deviceId) {
            currentDevice.value = updated;
          }
        }
        // If the device isn't known yet, the full server:devices list
        // (broadcast on register/online) will add it shortly.
        break;
      }

      case 'server:screenshot':
        if (currentDevice.value?.info.deviceId === message.deviceId) {
          currentScreenshot.value = message.data.data;
          viewportWidth.value = message.data.width || 0;
          viewportHeight.value = message.data.height || 0;
        }
        break;

      case 'server:networkBatch': {
        const ts = Date.now();
        const additions = message.batch.map(req => ({ deviceId: message.deviceId, request: req, timestamp: ts }));
        // Cap live buffer to avoid unbounded growth.
        networkLogs.value = [...networkLogs.value, ...additions].slice(-2000);
        break;
      }

      case 'server:consoleBatch': {
        const ts = Date.now();
        const additions = message.batch.map(log => ({ deviceId: message.deviceId, log, timestamp: ts }));
        consoleLogs.value = [...consoleLogs.value, ...additions].slice(-2000);
        break;
      }

      case 'server:error':
        errorLogs.value = [
          ...errorLogs.value,
          { deviceId: message.deviceId, error: message.error, timestamp: Date.now() },
        ].slice(-1000);
        break;

      case 'server:cookies':
        if (currentDevice.value?.info.deviceId === message.deviceId) {
          cookies.value = message.cookies;
        }
        break;

      case 'server:storage':
        if (currentDevice.value?.info.deviceId === message.deviceId) {
          storage.value = message.storage;
        }
        break;

      case 'server:dom':
        // DOM typically arrives via the server:result receipt (handled below),
        // but honor a direct broadcast too if one is sent.
        domSnapshot.value = message.dom;
        break;

      case 'server:result': {
        const pendingResult = pendingRequests.value.get(message.requestId);
        if (pendingResult) {
          pendingRequests.value.delete(message.requestId);
          pendingResult.resolve(message.result);
          addCommandLog(message.result.success, `Command ${message.requestId}: ${message.result.success ? 'Success' : 'Failed'}`);
        }
        break;
      }

      case 'server:commandError': {
        const pendingError = pendingRequests.value.get(message.requestId);
        if (pendingError) {
          pendingRequests.value.delete(message.requestId);
          pendingError.reject(message.error);
          addCommandLog(false, `Command ${message.requestId} failed: ${message.error}`);
        }
        break;
      }

      case 'server:audit':
        console.log(`[AUDIT] ${message.event.type} on ${message.event.deviceId}: ${message.event.detail}`);
        break;
    }
  };

  const addCommandLog = (success: boolean, message: string) => {
    commandLogs.value.unshift({ success, message, timestamp: Date.now() });
    if (commandLogs.value.length > 50) {
      commandLogs.value = commandLogs.value.slice(0, 50);
    }
  };

  const selectDevice = (device: Device) => {
    currentDevice.value = device;
    currentScreenshot.value = null;
    viewportWidth.value = 0;
    viewportHeight.value = 0;
    networkLogs.value = [];
    consoleLogs.value = [];
    errorLogs.value = [];
    cookies.value = [];
    storage.value = [];
    domSnapshot.value = null;
  };

  const clearLogs = () => {
    networkLogs.value = [];
    consoleLogs.value = [];
    errorLogs.value = [];
  };

  const networkLogsFor = (deviceId: string) => networkLogs.value.filter(l => l.deviceId === deviceId);
  const consoleLogsFor = (deviceId: string) => consoleLogs.value.filter(l => l.deviceId === deviceId);
  const errorLogsFor = (deviceId: string) => errorLogs.value.filter(l => l.deviceId === deviceId);

  return {
    // auth
    jwt,
    role,
    authError,
    isAuthenticated,
    login,
    logout,
    // connection
    ws,
    connected,
    connect,
    disconnect,
    send,
    // data
    devices,
    currentDevice,
    currentScreenshot,
    viewportWidth,
    viewportHeight,
    networkLogs,
    consoleLogs,
    errorLogs,
    cookies,
    storage,
    domSnapshot,
    commandLogs,
    // device-scoped selectors
    networkLogsFor,
    consoleLogsFor,
    errorLogsFor,
    // typed command helpers
    getDOM,
    getCookies,
    setCookie,
    deleteCookie,
    getStorage,
    setStorage,
    clearStorage,
    subscribeNetwork,
    subscribeConsole,
    fillForm,
    getFields,
    // misc
    selectDevice,
    clearLogs,
  };
});
