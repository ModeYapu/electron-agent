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
});
