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
  getConfig: () => ipcRenderer.invoke('agent:getConfig'),
  saveConfig: (cfg) => ipcRenderer.invoke('agent:saveConfig', cfg),
  reconnect: () => ipcRenderer.invoke('agent:reconnect'),
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

  // ===== 权限弹窗 =====
  // 主进程调用此方法响应权限请求
  respondPermission: (requestId, allowed) => {
    ipcRenderer.send('agent:permissionResponse', { requestId, allowed });
  },
});

// ===== 权限弹窗注入（不修改 H5 源码） =====
const PERMISSION_TIMEOUT = 10000; // 10秒后自动拒绝

function injectPermissionStyles() {
  if (document.getElementById('__ea_perm_styles')) return;
  const style = document.createElement('style');
  style.id = '__ea_perm_styles';
  style.textContent = `
    #__ea_perm_overlay {
      position: fixed; top: 0; left: 0; right: 0; bottom: 0;
      background: rgba(0,0,0,0.45); z-index: 2147483647;
      display: flex; align-items: center; justify-content: center;
      font-family: -apple-system, BlinkMacSystemFont, 'PingFang SC', sans-serif;
      animation: __ea_fadein 0.2s ease;
    }
    @keyframes __ea_fadein { from { opacity: 0; } to { opacity: 1; } }
    #__ea_perm_card {
      background: #fff; border-radius: 12px; padding: 28px 32px;
      max-width: 400px; width: 90%; box-shadow: 0 8px 32px rgba(0,0,0,0.25);
      text-align: center;
    }
    #__ea_perm_icon { font-size: 40px; margin-bottom: 12px; }
    #__ea_perm_title { font-size: 18px; font-weight: 600; color: #1a1a1a; margin-bottom: 6px; }
    #__ea_perm_body { font-size: 14px; color: #666; margin-bottom: 6px; }
    #__ea_perm_hint { font-size: 12px; color: #999; margin-bottom: 20px; }
    #__ea_perm_countdown { font-size: 12px; color: #bbb; margin-bottom: 16px; }
    #__ea_perm_btns { display: flex; gap: 12px; justify-content: center; }
    #__ea_perm_notice {
      position: fixed; right: 20px; bottom: 20px; z-index: 2147483647;
      background: rgba(0,0,0,0.78); color: #fff; border-radius: 8px;
      padding: 10px 14px; font-size: 13px; box-shadow: 0 6px 18px rgba(0,0,0,0.2);
      opacity: 0; transform: translateY(8px); transition: opacity 0.18s, transform 0.18s;
    }
    #__ea_perm_notice.__ea_show { opacity: 1; transform: translateY(0); }
    .__ea_btn {
      padding: 10px 28px; border-radius: 8px; font-size: 14px; font-weight: 500;
      border: none; cursor: pointer; transition: all 0.15s;
    }
    .__ea_btn_deny { background: #f5f5f5; color: #666; }
    .__ea_btn_deny:hover { background: #e8e8e8; }
    .__ea_btn_allow { background: #1890ff; color: #fff; }
    .__ea_btn_allow:hover { background: #40a9ff; }
  `;
  document.head.appendChild(style);
}

function operationName(cmdType) {
  const names = {
    'cmd:click': '点击页面',
    'cmd:type': '输入内容',
    'cmd:key': '键盘操作',
    'cmd:navigate': '页面跳转',
    'cmd:eval': '页面脚本操作',
    'cmd:scroll': '页面滚动',
    'cmd:setCookie': '修改 Cookie',
    'cmd:deleteCookie': '删除 Cookie',
    'cmd:setStorage': '修改本地存储',
    'cmd:clearStorage': '清空本地存储',
    'cmd:fillForm': '填写表单',
  };
  return names[cmdType] || '远程操作';
}

function showRemoteOperationNotice(cmdType) {
  injectPermissionStyles();
  const old = document.getElementById('__ea_perm_notice');
  if (old) old.remove();

  const notice = document.createElement('div');
  notice.id = '__ea_perm_notice';
  notice.textContent = '管理端正在执行远程操作：' + operationName(cmdType);
  document.body.appendChild(notice);

  requestAnimationFrame(() => notice.classList.add('__ea_show'));
  setTimeout(() => {
    notice.classList.remove('__ea_show');
    setTimeout(() => notice.remove(), 220);
  }, 1800);
}

function showPermissionPrompt(requestId, cmdType) {
  injectPermissionStyles();

  // Remove existing overlay if any
  const old = document.getElementById('__ea_perm_overlay');
  if (old) old.remove();

  const overlay = document.createElement('div');
  overlay.id = '__ea_perm_overlay';

  let countdown = Math.floor(PERMISSION_TIMEOUT / 1000);
  let timer;

  const updateCountdown = () => {
    const el = document.getElementById('__ea_perm_countdown');
    if (el) el.textContent = countdown + ' 秒后自动拒绝';
  };

  overlay.innerHTML = `
    <div id="__ea_perm_card">
      <div id="__ea_perm_icon">🔒</div>
      <div id="__ea_perm_title">远程操作请求</div>
      <div id="__ea_perm_body">管理端正在请求远程控制权限</div>
      <div id="__ea_perm_hint">本次同意后，当前客户端运行期间不再重复确认。</div>
      <div id="__ea_perm_countdown">${countdown} 秒后自动拒绝</div>
      <div id="__ea_perm_btns">
        <button class="__ea_btn __ea_btn_deny" id="__ea_perm_deny">拒绝</button>
        <button class="__ea_btn __ea_btn_allow" id="__ea_perm_allow">同意</button>
      </div>
    </div>
  `;

  const respond = (allowed) => {
    clearInterval(timer);
    overlay.remove();
    ipcRenderer.send('agent:permissionResponse', { requestId, allowed });
  };

  overlay.querySelector('#__ea_perm_allow').onclick = () => respond(true);
  overlay.querySelector('#__ea_perm_deny').onclick = () => respond(false);

  // Click outside card = ignore (doesn't close, user must choose)
  overlay.onclick = (e) => { if (e.target === overlay) e.stopPropagation(); };

  document.body.appendChild(overlay);

  // Countdown timer
  timer = setInterval(() => {
    countdown--;
    updateCountdown();
    if (countdown <= 0) respond(false);
  }, 1000);

  // Auto-deny after timeout
  setTimeout(() => {
    if (document.getElementById('__ea_perm_overlay')) respond(false);
  }, PERMISSION_TIMEOUT);
}

// Listen for permission requests from main process
ipcRenderer.on('agent:permissionRequest', (_event, { requestId, cmdType }) => {
  showPermissionPrompt(requestId, cmdType);
});

ipcRenderer.on('agent:remoteOperationNotice', (_event, { cmdType }) => {
  showRemoteOperationNotice(cmdType);
});
