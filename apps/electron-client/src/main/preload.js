/**
 * preload.js - 安全的渲染进程桥接
 * 通过 contextBridge 暴露受限的 API 给渲染进程
 */

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAgent', {
  // 获取设备信息
  getDeviceInfo: () => ipcRenderer.invoke('agent:getDeviceInfo'),
  // 获取当前 URL
  getCurrentURL: () => ipcRenderer.invoke('agent:getCurrentURL'),
  // 监听 Agent 状态变化
  onStatusChange: (callback) => {
    const handler = (_event, status) => callback(status);
    ipcRenderer.on('agent:status', handler);
    return () => ipcRenderer.removeListener('agent:status', handler);
  },

  // ===== 配置管理 =====
  // 读取配置
  getConfig: () => ipcRenderer.invoke('agent:getConfig'),
  // 保存配置（部分更新）
  saveConfig: (cfg) => ipcRenderer.invoke('agent:saveConfig', cfg),
  // 用新配置重连
  reconnect: () => ipcRenderer.invoke('agent:reconnect'),
  // 监听配置更新
  onConfigUpdated: (callback) => {
    const handler = (_event, cfg) => callback(cfg);
    ipcRenderer.on('agent:configUpdated', handler);
    return () => ipcRenderer.removeListener('agent:configUpdated', handler);
  },

  // 监听命令日志
  onCommandLog: (callback) => {
    const handler = (_event, log) => callback(log);
    ipcRenderer.on('agent:commandLog', handler);
    return () => ipcRenderer.removeListener('agent:commandLog', handler);
  },
});
