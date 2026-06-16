/**
 * @electron-agent/electron-client
 * Electron 客户端示例应用
 */

import { app, BrowserWindow, ipcMain } from 'electron';
import { ElectronAgent } from '@electron-agent/agent-core';
import path from 'path';
import fs from 'fs';

let mainWindow: BrowserWindow | null = null;
let agent: ElectronAgent | null = null;

// ========== 权限确认 ==========
const pendingPermissionRequests = new Map<string, {
  resolve: (allowed: boolean) => void;
  timeout: NodeJS.Timeout;
}>();

// ========== 配置持久化 ==========
interface AgentConfig {
  serverUrl: string;
  agentToken: string;
  h5Url: string;
}

const DEFAULT_CONFIG: AgentConfig = {
  serverUrl: 'ws://localhost:9300/ws',
  agentToken: '',
  h5Url: '',
};

let configPath = '';

function loadConfig(): AgentConfig {
  // 1. 内置默认值（dist/config.json，构建时写入）
  let builtinConfig: Partial<AgentConfig> = {};
  try {
    const builtinPath = path.join(__dirname, '..', 'config.json');
    if (fs.existsSync(builtinPath)) {
      builtinConfig = JSON.parse(fs.readFileSync(builtinPath, 'utf-8'));
    }
  } catch { /* 文件损坏则忽略 */ }

  // 2. 用户配置（%APPDATA%/.../config.json，通过设置面板保存）
  let userConfig: Partial<AgentConfig> = {};
  try {
    if (fs.existsSync(configPath)) {
      userConfig = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    }
  } catch { /* 文件损坏则忽略 */ }

  // 2. 环境变量（优先于文件）
  const envConfig: Partial<AgentConfig> = {};
  if (process.env.AGENT_SERVER_URL) envConfig.serverUrl = process.env.AGENT_SERVER_URL;
  if (process.env.AGENT_TOKEN)       envConfig.agentToken = process.env.AGENT_TOKEN;
  if (process.env.H5_URL)            envConfig.h5Url = process.env.H5_URL;

  // 4. 合并优先级：env > 用户设置 > 内置默认 > 硬编码兜底
  return {
    serverUrl:  envConfig.serverUrl  ?? userConfig.serverUrl  ?? builtinConfig.serverUrl  ?? DEFAULT_CONFIG.serverUrl,
    agentToken: envConfig.agentToken ?? userConfig.agentToken ?? builtinConfig.agentToken ?? DEFAULT_CONFIG.agentToken,
    h5Url:      envConfig.h5Url      ?? userConfig.h5Url      ?? builtinConfig.h5Url      ?? DEFAULT_CONFIG.h5Url,
  };
}

function saveConfigFile(cfg: AgentConfig): void {
  try {
    const dir = path.dirname(configPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(configPath, JSON.stringify(cfg, null, 2), 'utf-8');
  } catch (e) {
    console.error('Failed to save config:', e);
  }
}

// ========== IPC 处理器 ==========
function setupIPC() {
  ipcMain.handle('agent:getConfig', () => loadConfig());

  ipcMain.handle('agent:saveConfig', (_event, cfg: Partial<AgentConfig>) => {
    const current = loadConfig();
    const merged = { ...current, ...cfg };
    saveConfigFile(merged);

    // 通知渲染进程
    if (mainWindow) {
      mainWindow.webContents.send('agent:configUpdated', merged);
    }
    return { ok: true, config: merged };
  });

  ipcMain.handle('agent:reconnect', async () => {
    if (agent) agent.stop();
    // 短暂等待后重新初始化
    await new Promise(r => setTimeout(r, 500));
    if (mainWindow) initAgent();
    return { ok: true };
  });

  ipcMain.handle('agent:getDeviceInfo', () => {
    if (!agent) return null;
    return {
      deviceId: agent.getDeviceId(),
      info: agent.getDeviceInfo(),
    };
  });

  ipcMain.handle('agent:getCurrentURL', () => {
    return mainWindow?.webContents.getURL() ?? '';
  });

  // 权限确认响应（从 preload 发回）
  ipcMain.on('agent:permissionResponse', (_event, { requestId, allowed }: { requestId: string; allowed: boolean }) => {
    const pending = pendingPermissionRequests.get(requestId);
    if (pending) {
      clearTimeout(pending.timeout);
      pendingPermissionRequests.delete(requestId);
      pending.resolve(allowed);
    }
  });
}

// ========== 窗口 ==========
function createWindow() {
  const cfg = loadConfig();

  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: true,
      sandbox: true,
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  // 加载页面：配置 > 环境变量 > 本地
  const h5Url = cfg.h5Url;
  if (h5Url) {
    console.log(`🌐 Loading remote H5: ${h5Url}`);
    mainWindow.loadURL(h5Url);
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
  }

  // 打开开发者工具（调试用）
  // mainWindow.webContents.openDevTools();

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  return mainWindow;
}

// ========== Agent ==========
function initAgent() {
  if (!mainWindow) return;

  const cfg = loadConfig();

  if (!cfg.agentToken) {
    console.warn('⚠️  AGENT_TOKEN is not set — the agent cannot authenticate to the relay.');
    if (mainWindow) {
      mainWindow.webContents.send('agent:status', {
        connected: false,
        error: '未配置 Agent Token，请在设置中填写',
      });
    }
    return;
  }

  agent = new ElectronAgent(mainWindow, {
    serverUrl: cfg.serverUrl,
    agentToken: cfg.agentToken,
    deviceInfo: {
      name: 'Demo Electron Client',
      appVersion: '0.1.0',
      tags: ['demo', 'test'],
    },
    reconnectInterval: 5000,
    heartbeatInterval: 30000,
    captureQuality: 60,
    onCommandLog: (log) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('agent:commandLog', log);
      }
    },
    onPermissionRequired: (cmd) => {
      return new Promise((resolve) => {
        const requestId = cmd.requestId || `perm_${Date.now()}`;
        // 10s timeout
        const timeout = setTimeout(() => {
          pendingPermissionRequests.delete(requestId);
          resolve(false);
        }, 10000);
        pendingPermissionRequests.set(requestId, { resolve, timeout });
        // 发送权限请求到 preload → 页面注入弹窗
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('agent:permissionRequest', {
            requestId,
            cmdType: cmd.type,
            cmdDetail: cmd.detail,
          });
        } else {
          clearTimeout(timeout);
          pendingPermissionRequests.delete(requestId);
          resolve(false);
        }
      });
    },
  });

  agent.start().catch((err: Error) => {
    console.error('Failed to start agent:', err);
  });
}

// ========== 生命周期 ==========
app.on('ready', () => {
  configPath = path.join(app.getPath('userData'), 'config.json');
  setupIPC();
  createWindow();
  initAgent();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
    initAgent();
  }
});

app.on('before-quit', () => {
  if (agent) {
    agent.stop();
  }
});
