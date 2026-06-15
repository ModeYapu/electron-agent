/**
 * @electron-agent/electron-client
 * Electron 客户端示例应用
 */

import { app, BrowserWindow } from 'electron';
import { ElectronAgent } from '@electron-agent/agent-core';
import path from 'path';

let mainWindow: BrowserWindow | null = null;
let agent: ElectronAgent | null = null;

function createWindow() {
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

  // 加载应用页面（这里先加载一个本地页面）
  mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));

  // 或者加载远程 URL（用于演示第三方页面监控）
  // mainWindow.loadURL('https://example.com');

  // 打开开发者工具（调试用）
  // mainWindow.webContents.openDevTools();

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  return mainWindow;
}

function initAgent() {
  if (!mainWindow) return;

  // P2 CONFIG CLEANUP: read AGENT_TOKEN from the environment — no hardcoded
  // credential. The relay generates an ephemeral dev token (logged at startup)
  // when AGENT_TOKEN is unset; set AGENT_TOKEN in .env to match it.
  const agentToken = process.env.AGENT_TOKEN;
  if (!agentToken) {
    console.warn('⚠️  AGENT_TOKEN is not set — the agent cannot authenticate to the relay. Set AGENT_TOKEN in your environment.');
  }

  const serverUrl = process.env.AGENT_SERVER_URL || 'ws://localhost:9300/ws';

  agent = new ElectronAgent(mainWindow, {
    serverUrl,
    agentToken: agentToken || '',
    deviceInfo: {
      name: 'Demo Electron Client',
      appVersion: '0.1.0',
      tags: ['demo', 'test'],
    },
    reconnectInterval: 5000,
    heartbeatInterval: 30000,
    captureQuality: 60,
  });

  agent.start().catch((err: Error) => {
    console.error('Failed to start agent:', err);
  });
}

app.on('ready', () => {
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
