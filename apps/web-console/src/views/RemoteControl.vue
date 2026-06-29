<template>
  <div ref="workspaceRef" class="remote-control">
    <el-card class="remote-shell" shadow="never">
      <template #header>
        <div class="card-header">
          <div class="title-block">
            <h2>远程控制</h2>
            <span class="title-hint">浏览远程画面优先，表单和操作在附近浮层里完成</span>
          </div>
          <div class="controls">
            <el-button
              @click="toggleStreaming"
              :type="streaming ? 'danger' : 'success'"
              size="small"
            >
              {{ streaming ? '⏹ 停止直播' : '▶ 开始直播' }}
            </el-button>
            <el-button v-if="streaming" @click="endRemoteControl" type="danger" size="small" plain>退出远程操作</el-button>
            <el-button @click="refreshScreenshot" type="primary" size="small">刷新截图</el-button>
            <el-button @click="utilityDrawerVisible = true" size="small">操作面板</el-button>
            <el-button @click="logDrawerVisible = true" size="small">日志</el-button>
            <el-button @click="openDOMInspector" size="small">DOM 检查器</el-button>
            <el-button @click="toggleFullscreen" size="small">{{ isFullscreen ? '退出全屏' : '全屏浏览' }}</el-button>
          </div>
        </div>
      </template>

      <div
        v-if="device"
        ref="remoteViewportRef"
        class="screenshot-area"
        :class="{ 'keyboard-active': remoteKeyboardActive, fullscreen: isFullscreen }"
        tabindex="0"
        @pointerdown="activateRemoteKeyboard"
        @click="focusRemoteViewport"
        @focus="remoteKeyboardActive = true"
        @blur="remoteKeyboardActive = false"
        @keydown="handleRemoteKeydown"
        @mousemove="handleMouseMove"
        @mouseleave="handleMouseLeave"
      >
        <img
          v-if="screenshot"
          ref="screenshotImageRef"
          :src="'data:image/jpeg;base64,' + screenshot"
          alt="Screenshot"
          class="screenshot-image"
          @click="handleImageClick"
          @wheel.prevent="handleScroll"
        />
        <el-empty v-else description="无截图数据 — 点击「刷新截图」或「开始直播」" />

        <div class="viewport-hint">
          点击输入框会在附近弹出填写卡片，点击下拉会在附近弹出选项卡片
        </div>

        <div
          v-if="inputBubble.visible"
          class="interaction-bubble input-bubble"
          :style="bubbleStyle(inputBubble.x, inputBubble.y)"
          @click.stop
        >
          <div class="bubble-header">
            <span>⌨ {{ inputBubble.label || '输入字段' }}</span>
            <el-button link size="small" @click="closeInputBubble">收起</el-button>
          </div>
          <el-input
            v-model="inputBubble.text"
            size="small"
            placeholder="直接输入要填入的值"
            @focus="onInputBubbleFocus"
            @keyup.enter="submitInputBubble"
          />
          <div class="bubble-actions">
            <el-button size="small" @click="closeInputBubble">取消</el-button>
            <el-button type="primary" size="small" @click="submitInputBubble">填写</el-button>
          </div>
        </div>

        <div
          v-if="showSelectPicker"
          class="interaction-bubble select-bubble"
          :style="bubbleStyle(selectBubbleX, selectBubbleY)"
          @click.stop
        >
          <div class="bubble-header">
            <span>🔽 {{ selectBubbleLabel || '选择下拉选项' }}</span>
            <el-button link size="small" @click="showSelectPicker = false">收起</el-button>
          </div>
          <div class="select-picker-body">
            <el-radio-group v-model="selectedValue" class="select-radio-group">
              <el-radio
                v-for="opt in selectOptions"
                :key="opt.value"
                :value="opt.value"
                class="select-radio-item"
              >{{ opt.text }} ({{ opt.value }})</el-radio>
            </el-radio-group>
          </div>
          <div class="bubble-actions">
            <el-button @click="showSelectPicker = false" size="small">取消</el-button>
            <el-button @click="applySelectValue" type="primary" size="small">确认选择</el-button>
          </div>
        </div>
      </div>
    </el-card>

    <el-drawer v-model="utilityDrawerVisible" title="操作面板" size="420px">
      <el-tabs v-model="activeTab" stretch>
        <el-tab-pane label="快捷操作" name="actions">
          <el-form :model="controlForm" label-width="72px" size="small">
            <el-form-item label="URL">
              <el-input v-model="controlForm.url" placeholder="输入 URL" @keyup.enter="navigate">
                <template #append>
                  <el-button @click="navigate" type="primary">跳转</el-button>
                </template>
              </el-input>
            </el-form-item>
            <el-form-item label="JS">
              <el-input v-model="controlForm.code" type="textarea" :rows="4" placeholder="JavaScript code" />
              <el-button @click="evalCode" type="primary" style="margin-top: 8px">执行</el-button>
            </el-form-item>
            <el-form-item label="文本">
              <el-input v-model="controlForm.text" placeholder="发送到当前焦点" @keyup.enter="typeText">
                <template #append>
                  <el-button @click="typeText" type="primary">发送</el-button>
                </template>
              </el-input>
            </el-form-item>
          </el-form>
        </el-tab-pane>

        <el-tab-pane label="表单字段" name="form">
          <div class="form-fill-panel">
            <div class="form-toolbar">
              <el-button @click="scanFields" type="primary" size="small" :loading="scanning">扫描字段</el-button>
              <el-button @click="fillAllFields" type="success" size="small" :disabled="fieldList.length === 0">一键填表</el-button>
              <el-button @click="clearFieldValues" size="small">清空</el-button>
            </div>

            <div class="field-list" v-if="fieldList.length > 0">
              <div class="field-item" v-for="field in fieldList" :key="field.id || field.name">
                <label>
                  <span class="field-name">{{ field.name || field.id }}</span>
                  <span class="field-type">{{ field.type }}</span>
                  <span class="field-placeholder" v-if="field.placeholder">{{ field.placeholder }}</span>
                </label>
                <div class="field-input-row">
                  <el-input
                    v-model="fieldValues[field.name || field.id]"
                    size="small"
                    :placeholder="field.placeholder || '输入值'"
                    v-if="field.type !== 'select-one' && field.type !== 'radio' && field.type !== 'checkbox'"
                  />
                  <el-select
                    v-model="fieldValues[field.name || field.id]"
                    size="small"
                    v-else-if="field.type === 'select-one'"
                    placeholder="选择"
                  >
                    <el-option label="(不修改)" value="" />
                  </el-select>
                  <el-switch
                    v-model="fieldValues[field.name || field.id]"
                    v-else-if="field.type === 'checkbox'"
                    size="small"
                  />
                  <el-input
                    v-model="fieldValues[field.name || field.id]"
                    size="small"
                    placeholder="输入值"
                    v-else
                  />
                  <el-button
                    @click="fillSingleField(field)"
                    size="small"
                    type="primary"
                    circle
                    :icon="Check"
                    style="margin-left: 6px"
                  />
                </div>
              </div>
            </div>
            <el-empty v-else description="点击「扫描字段」获取表单结构" :image-size="60" />
          </div>
        </el-tab-pane>
      </el-tabs>
    </el-drawer>

    <el-drawer v-model="logDrawerVisible" title="执行日志" size="360px">
      <div class="log-panel">
        <div class="log-entry" v-for="(log, index) in wsStore.commandLogs" :key="index">
          <el-tag :type="log.success ? 'success' : 'danger'" size="small">
            {{ log.success ? '成功' : '失败' }}
          </el-tag>
          <span class="log-message">{{ log.message }}</span>
          <span class="log-time">{{ new Date(log.timestamp).toLocaleTimeString() }}</span>
        </div>
        <el-empty v-if="wsStore.commandLogs.length === 0" description="暂无日志" />
      </div>
    </el-drawer>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, nextTick, reactive } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useWebSocketStore } from '@/stores/websocket';
import { ElMessage } from 'element-plus';
import { Check } from '@element-plus/icons-vue';
import { mapKeyboardEventToRemoteAction, type RemoteKeyboardAction } from '@/utils/remoteKeyboard';

const route = useRoute();
const router = useRouter();
const wsStore = useWebSocketStore();

const device = computed(() => wsStore.currentDevice);
const screenshot = computed(() => wsStore.currentScreenshot);

const activeTab = ref('actions');
const streaming = ref(false);
let streamInterval: ReturnType<typeof setInterval> | null = null;

const controlForm = ref({ url: '', code: '', text: '' });
const logs = ref<Array<{ success: boolean; message: string; timestamp: number }>>([]);
const workspaceRef = ref<HTMLElement | null>(null);
const remoteViewportRef = ref<HTMLElement | null>(null);
const screenshotImageRef = ref<HTMLImageElement | null>(null);
const remoteKeyboardActive = ref(false);
const utilityDrawerVisible = ref(false);
const logDrawerVisible = ref(false);
const isFullscreen = ref(false);
let remoteKeyQueue: Promise<void> = Promise.resolve();
let pendingScreenshotRefresh: ReturnType<typeof setTimeout> | null = null;

const inputBubble = reactive({
  visible: false,
  text: '',
  x: 24,
  y: 24,
  label: '',
});

// Form filling state
const fieldList = ref<any[]>([]);
const fieldValues = ref<Record<string, any>>({});
const scanning = ref(false);

onMounted(() => {
  const deviceId = route.params.deviceId as string;
  if (deviceId) {
    const targetDevice = wsStore.devices.find(d => d.info.deviceId === deviceId);
    if (targetDevice) wsStore.selectDevice(targetDevice);
  }

  window.addEventListener('keydown', handleWindowKeydown, true);
  document.addEventListener('fullscreenchange', syncFullscreenState);
});

onUnmounted(() => {
  if (streamInterval) stopStreaming();
  if (pendingScreenshotRefresh) clearTimeout(pendingScreenshotRefresh);
  window.removeEventListener('keydown', handleWindowKeydown, true);
  document.removeEventListener('fullscreenchange', syncFullscreenState);
});

// ===== Streaming =====
const toggleStreaming = () => {
  if (streaming.value) {
    stopStreaming();
  } else {
    startStreaming();
  }
};

const startStreaming = () => {
  if (!device.value) return;
  streaming.value = true;
  addLog(true, '开始实时截图直播 (2 FPS)');

  // Request continuous capture at 2 FPS, with server-side recording
  wsStore.send({
    type: 'cmd:startCapture',
    requestId: generateRequestId(),
    fps: 2,
    quality: 50,
    record: true,   // Enable server-side ffmpeg recording
  }).catch(err => addLog(false, `Start capture failed: ${err}`));

  // Also poll screenshots every 500ms as backup
  streamInterval = setInterval(() => {
    wsStore.send({
      type: 'cmd:screenshot',
      requestId: generateRequestId(),
      quality: 40,
    }).catch(() => {});
  }, 500);

  ElMessage.success('直播已开始');
};

const stopStreaming = () => {
  streaming.value = false;
  if (streamInterval) { clearInterval(streamInterval); streamInterval = null; }

  wsStore.send({
    type: 'cmd:stopCapture',
    requestId: generateRequestId(),
  }).catch(() => {});

  addLog(true, '停止实时截图直播');
  ElMessage.info('直播已停止');
};

const endRemoteControl = () => {
  streaming.value = false;
  if (streamInterval) { clearInterval(streamInterval); streamInterval = null; }

  wsStore.send({
    type: 'cmd:endRemoteControl',
    requestId: generateRequestId(),
  }).catch(() => {});

  addLog(true, '已退出远程操作');
  ElMessage.success('远程操作已结束');
};

// ===== Screenshot =====
const handleImageClick = async (event: MouseEvent) => {
  focusRemoteViewport();
  const target = event.target as HTMLImageElement;
  const rect = target.getBoundingClientRect();
  const localX = event.clientX - rect.left;
  const localY = event.clientY - rect.top;
  const vpW = wsStore.viewportWidth || target.naturalWidth;
  const vpH = wsStore.viewportHeight || target.naturalHeight;
  if (!vpW || !vpH) return;
  const scaleX = vpW / rect.width;
  const scaleY = vpH / rect.height;
  const x = Math.round(localX * scaleX);
  const y = Math.round(localY * scaleY);

  // inspectElementAt 走 cmd:eval 不经过坐标缩放，需用原始页面坐标
  const origW = wsStore.originalWidth || vpW;
  const origH = wsStore.originalHeight || vpH;
  const info = await inspectElementAt(
    Math.round(x * origW / vpW),
    Math.round(y * origH / vpH)
  );
  
  // 在 client 端显示光标
  wsStore.send({
    type: 'cmd:showCursor',
    requestId: generateRequestId(),
    x, y,
  }).catch(() => {});
  
  if (info?.tag === 'SELECT' && info.options?.length > 0) {
    openSelectPicker(info, x, y, localX, localY);
    return;
  }

  // Click first, then detect what was clicked
  await clickAt(x, y);
  scheduleScreenshotRefresh();

  if (info) {
    await handleInspectedElement(info, x, y, localX, localY);
    return;
  }

  await detectAndHandleElement(x, y, localX, localY);
};

const focusRemoteViewport = () => {
  nextTick(() => remoteViewportRef.value?.focus());
};

const activateRemoteKeyboard = () => {
  remoteKeyboardActive.value = true;
  focusRemoteViewport();
};

const syncFullscreenState = () => {
  isFullscreen.value = document.fullscreenElement === workspaceRef.value;
};

const toggleFullscreen = async () => {
  if (!workspaceRef.value) return;
  try {
    if (document.fullscreenElement === workspaceRef.value) {
      await document.exitFullscreen();
    } else {
      await workspaceRef.value.requestFullscreen();
    }
    syncFullscreenState();
  } catch (err) {
    addLog(false, `全屏切换失败: ${err}`);
  }
};

const queueRemoteKeyAction = (action: RemoteKeyboardAction) => {
  if (!device.value) return;

  remoteKeyQueue = remoteKeyQueue
    .catch(() => {})
    .then(async () => {
      if (action.kind === 'type') {
        addLog(true, `键盘转发: ${JSON.stringify(action.text)}`);
        await wsStore.send({
          type: 'cmd:type',
          requestId: generateRequestId(),
          text: action.text,
        });
        return;
      }

      addLog(true, `键盘转发: keyCode=${action.keyCode}`);
      await wsStore.send({
        type: 'cmd:key',
        requestId: generateRequestId(),
        keyCode: action.keyCode,
        action: action.action,
      });
    })
    .catch((err) => {
      addLog(false, `键盘输入失败: ${err}`);
    })
    .finally(() => {
      scheduleScreenshotRefresh();
    });
};

const handleRemoteKeydown = (event: KeyboardEvent) => {
  if (!remoteKeyboardActive.value) return;
  const action = mapKeyboardEventToRemoteAction(event);
  if (!action) return;

  event.preventDefault();
  event.stopPropagation();
  queueRemoteKeyAction(action);
};

const handleWindowKeydown = (event: KeyboardEvent) => {
  if (!remoteKeyboardActive.value) return;

  const target = event.target as HTMLElement | null;
  if (target && target.closest('.el-drawer, .interaction-bubble, input, textarea, .el-input, .el-textarea')) return;

  handleRemoteKeydown(event);
};

const handleScroll = (event: WheelEvent) => {
  if (!device.value) return;
  const deltaY = event.deltaY;
  const deltaX = event.deltaX;

  // Compute viewport coordinates for smart internal scroll
  const target = event.target as HTMLImageElement;
  const rect = target.getBoundingClientRect();
  const localX = event.clientX - rect.left;
  const localY = event.clientY - rect.top;
  const vpW = wsStore.viewportWidth || target.naturalWidth;
  const vpH = wsStore.viewportHeight || target.naturalHeight;
  const x = vpW ? Math.round(localX * (vpW / rect.width)) : undefined;
  const y = vpH ? Math.round(localY * (vpH / rect.height)) : undefined;

  wsStore.send({
    type: 'cmd:scroll',
    requestId: generateRequestId(),
    deltaX: Math.round(deltaX),
    deltaY: Math.round(deltaY),
    x,
    y,
  }).then(() => {
    scrollLogPending.value = `△${Math.round(deltaX)},${Math.round(deltaY)}`;
    flushScrollLog();
  }).catch(err => addLog(false, `Scroll failed: ${err}`));
};

// Throttled scroll logging (max 1 log per 500ms)
const scrollLogPending = ref('');
let scrollLogTimer: ReturnType<typeof setTimeout> | null = null;
const flushScrollLog = () => {
  if (scrollLogTimer) return;
  scrollLogTimer = setTimeout(() => {
    if (scrollLogPending.value) {
      addLog(true, `滚动: ${scrollLogPending.value}`);
      scrollLogPending.value = '';
    }
    scrollLogTimer = null;
  }, 500);
};

// ---- Remote cursor mirroring ----
let cursorThrottleTimer: ReturnType<typeof setTimeout> | null = null;
let lastCursorX = 0;
let lastCursorY = 0;

const handleMouseMove = (event: MouseEvent) => {
  if (!device.value) return;
  const img = screenshotImageRef.value;
  if (!img) return;
  const rect = img.getBoundingClientRect();
  const localX = event.clientX - rect.left;
  const localY = event.clientY - rect.top;
  const vpW = wsStore.viewportWidth || img.naturalWidth;
  const vpH = wsStore.viewportHeight || img.naturalHeight;
  if (!vpW || !vpH) return;
  const x = Math.round(localX * (vpW / rect.width));
  const y = Math.round(localY * (vpH / rect.height));
  // Dedup — only send if position actually changed
  if (x === lastCursorX && y === lastCursorY) return;
  lastCursorX = x;
  lastCursorY = y;
  // Throttle: at most one send per 200ms
  if (cursorThrottleTimer) return;
  cursorThrottleTimer = setTimeout(() => { cursorThrottleTimer = null; }, 200);
  wsStore.send({
    type: 'cmd:showCursor',
    requestId: generateRequestId(),
    x,
    y,
  }).catch(() => {});
};

const handleMouseLeave = () => {
  lastCursorX = -1;
  lastCursorY = -1;
  cursorThrottleTimer = null;
  wsStore.send({
    type: 'cmd:showCursor',
    requestId: generateRequestId(),
    x: -1,
    y: -1,
  }).catch(() => {});
};

const scheduleScreenshotRefresh = () => {
  if (streaming.value) return;
  if (pendingScreenshotRefresh) clearTimeout(pendingScreenshotRefresh);
  pendingScreenshotRefresh = setTimeout(() => {
    pendingScreenshotRefresh = null;
    refreshScreenshot().catch(() => {});
  }, 180);
};

// Detect element type at coordinates and handle specially for selects
const selectOptions = ref<Array<{text: string; value: string; selected: boolean}>>([]);
const selectedValue = ref('');
const showSelectPicker = ref(false);
const selectBubbleX = ref(24);
const selectBubbleY = ref(24);
const selectBubbleLabel = ref('');
const selectTargetX = ref(0);
const selectTargetY = ref(0);
const selectTargetSelector = ref(''); // CSS selector for precise re-targeting

// Last click position for typeText to re-find the input
let lastClickX = 0;
let lastClickY = 0;

const inspectElementAt = async (x: number, y: number) => {
  if (!device.value) return;
  lastClickX = x;
  lastClickY = y;
  try {
    const result = await wsStore.send({
      type: 'cmd:eval',
      requestId: generateRequestId(),
      code: `(() => {
        const el = document.elementFromPoint(${x}, ${y});
        if (!el) return { tag: '' };
        const tag = el.tagName;
        const idx = el.name || el.id ? (() => {
          const sel = el.name ? '[name="' + el.name + '"]' : '#' + el.id;
          const all = document.querySelectorAll(sel);
          for (let i = 0; i < all.length; i++) if (all[i] === el) return i + 1;
          return 1;
        })() : 1;
        const result = {
          tag,
          type: el.getAttribute('type') || '',
          name: el.name || '',
          id: el.id || '',
          value: el.value || '',
          index: idx,
        };
        if (tag === 'SELECT') {
          result.options = Array.from(el.options).map(o => ({text: o.text, value: o.value, selected: o.selected}));
        }
        try { el.focus(); } catch(e) {}
        return result;
      })()`,
    });
    if (result.success && result.data) {
      return result.data as any;
    }
  } catch (err: any) {
    // Silent — detection is best-effort
  }
  return null;
};

const bubbleStyle = (x: number, y: number) => ({
  left: `${x}px`,
  top: `${y}px`,
});

const positionBubble = (localX: number, localY: number) => {
  const width = remoteViewportRef.value?.clientWidth ?? 0;
  const height = remoteViewportRef.value?.clientHeight ?? 0;
  const bubbleWidth = 320;
  const bubbleHeight = 220;
  return {
    x: Math.max(16, Math.min(localX + 18, Math.max(16, width - bubbleWidth - 16))),
    y: Math.max(16, Math.min(localY + 18, Math.max(16, height - bubbleHeight - 16))),
  };
};

const closeInputBubble = () => {
  inputBubble.visible = false;
  inputBubble.text = '';
  inputBubble.label = '';
};

const onInputBubbleFocus = () => {
  if (!device.value) return;
  // 鼠标焦点在输入弹窗时，client展示光标+文字
  wsStore.send({
    type: 'cmd:showCursor',
    requestId: generateRequestId(),
    x: lastClickX,
    y: lastClickY,
    showText: true,
  }).catch(() => {});
};

const openInputBubble = (info: any, localX: number, localY: number) => {
  const pos = positionBubble(localX, localY);
  inputBubble.x = pos.x;
  inputBubble.y = pos.y;
  inputBubble.label = info.name || info.id || info.tag || '输入字段';
  inputBubble.text = info.value || '';
  inputBubble.visible = true;
  showSelectPicker.value = false;
};

const openSelectPicker = (info: any, x: number, y: number, localX: number, localY: number) => {
  selectOptions.value = info.options;
  selectedValue.value = info.options.find((o: any) => o.selected)?.value || '';
  selectTargetX.value = x;
  selectTargetY.value = y;
  const pos = positionBubble(localX, localY);
  selectBubbleX.value = pos.x;
  selectBubbleY.value = pos.y;
  selectBubbleLabel.value = info.name || info.id || '下拉字段';
  selectTargetSelector.value = info.name
    ? `[name="${info.name}"]`
    : info.id
      ? `#${info.id}`
      : `select:nth-of-type(${info.index || 1})`;
  showSelectPicker.value = true;
  closeInputBubble();
  addLog(true, `检测到下拉框: ${info.name || info.id || info.tag} (${info.options.length} 个选项)`);
};

const handleInspectedElement = async (info: any, x: number, y: number, localX: number, localY: number) => {
  if (info.tag === 'SELECT' && info.options?.length > 0) {
    openSelectPicker(info, x, y, localX, localY);
  } else if (info.tag === 'INPUT' || info.tag === 'TEXTAREA') {
    openInputBubble(info, localX, localY);
    addLog(true, `已聚焦: ${info.tag} ${info.name || info.id || ''}`);
  } else {
    closeInputBubble();
    showSelectPicker.value = false;
  }
};

const detectAndHandleElement = async (x: number, y: number, localX: number, localY: number) => {
  const origW = wsStore.originalWidth || wsStore.viewportWidth || 1920;
  const origH = wsStore.originalHeight || wsStore.viewportHeight || 1080;
  const vpW = wsStore.viewportWidth || origW;
  const vpH = wsStore.viewportHeight || origH;
  const info = await inspectElementAt(
    Math.round(x * origW / vpW),
    Math.round(y * origH / vpH)
  );
  if (info) {
    await handleInspectedElement(info, x, y, localX, localY);
  }
};

const applySelectValue = async () => {
  if (!device.value || !selectedValue.value) return;
  try {
    const safeVal = JSON.stringify(selectedValue.value);
    const selector = selectTargetSelector.value || 'select';
    const result = await wsStore.send({
      type: 'cmd:eval',
      requestId: generateRequestId(),
      code: `(() => {
        const el = document.querySelector('${selector}');
        if (!el || el.tagName !== 'SELECT')
          return JSON.stringify({ok:false, why:'not found', sel:'${selector}'});
        el.value = ${safeVal};
        el.dispatchEvent(new Event('change', {bubbles:true}));
        el.dispatchEvent(new Event('input', {bubbles:true}));
        return JSON.stringify({ok:true, tag:'SELECT', val:el.value, sel:'${selector}'});
      })()`,
    });
    const info = typeof result.data === 'string' ? JSON.parse(result.data) : result.data;
    addLog(true, `下拉 ${selector}: ${selectedValue.value} → ${info?.ok ? '✓' : '✗ '+info?.why}`);
    showSelectPicker.value = false;
    if (info?.ok) setTimeout(() => refreshScreenshot(), 600);
  } catch (err: any) {
    addLog(false, `下拉失败: ${err.message || err}`);
  }
};

const applyTextToFocusedElement = async (text: string) => {
  if (!device.value || !text) return;
  const result = await wsStore.send({
    type: 'cmd:type',
    requestId: generateRequestId(),
    text,
  });
  return result.data;
};

const submitInputBubble = async () => {
  if (!inputBubble.text) {
    ElMessage.warning('请先输入内容');
    return;
  }

  try {
    // 显示光标+客服正在协助
    wsStore.send({
      type: 'cmd:showCursor',
      requestId: generateRequestId(),
      x: lastClickX,
      y: lastClickY,
    }).catch(() => {});

    const info = await applyTextToFocusedElement(inputBubble.text);
    addLog(true, `附近填写: "${inputBubble.text}" → ${info?.tag || '?'} ${info?.ok ? '✓' : '✗ ' + info?.why}`);
    if (info?.ok) {
      closeInputBubble();
      setTimeout(() => refreshScreenshot(), 600);
    }
  } catch (err: any) {
    addLog(false, `附近填写失败: ${err.message || err}`);
  }
};

const refreshScreenshot = async () => {
  if (!device.value) return;
  try {
    await wsStore.send({ type: 'cmd:screenshot', requestId: generateRequestId(), quality: 60 });
    addLog(true, '截图已刷新');
  } catch (err) { addLog(false, `刷新截图失败: ${err}`); }
};

// ===== Actions =====
const clickAt = async (x: number, y: number) => {
  if (!device.value) return;
  try {
    await wsStore.send({ type: 'cmd:click', requestId: generateRequestId(), x: Math.round(x), y: Math.round(y), button: 'left' });
    addLog(true, `点击: (${Math.round(x)}, ${Math.round(y)})`);
  } catch (err) { addLog(false, `点击失败: ${err}`); }
};

const navigate = async () => {
  if (!device.value || !controlForm.value.url) return;
  try {
    await wsStore.send({ type: 'cmd:navigate', requestId: generateRequestId(), url: controlForm.value.url });
    addLog(true, `导航: ${controlForm.value.url}`);
    controlForm.value.url = '';
    ElMessage.success('导航成功');
  } catch (err) { addLog(false, `导航失败: ${err}`); }
};

const evalCode = async () => {
  if (!device.value || !controlForm.value.code) return;
  try {
    await wsStore.send({ type: 'cmd:eval', requestId: generateRequestId(), code: controlForm.value.code });
    addLog(true, `执行 JS: ${controlForm.value.code.substring(0, 50)}`);
    controlForm.value.code = '';
  } catch (err) { addLog(false, `JS 执行失败: ${err}`); }
};

const typeText = async () => {
  if (!device.value || !controlForm.value.text) return;
  try {
    // 显示光标+客服正在协助
    wsStore.send({
      type: 'cmd:showCursor',
      requestId: generateRequestId(),
      x: lastClickX,
      y: lastClickY,
    }).catch(() => {});

    const info = await applyTextToFocusedElement(controlForm.value.text);
    addLog(true, `输入: "${controlForm.value.text}" → ${info?.tag || '?'} ${info?.ok ? '✓' : '✗ '+info?.why}`);
    controlForm.value.text = '';
    if (info?.ok) setTimeout(() => refreshScreenshot(), 600);
  } catch (err: any) { addLog(false, `输入失败: ${err.message || err}`); }
};

// ===== Form filling =====
const scanFields = async () => {
  if (!device.value) return;
  scanning.value = true;
  try {
    const fields = await wsStore.getFields();
    fieldList.value = fields;
    fieldValues.value = {};
    for (const f of fields) {
      const key = f.name || f.id;
      fieldValues.value[key] = f.type === 'checkbox' ? false : f.value || '';
    }
    addLog(true, `扫描到 ${fields.length} 个表单字段`);
    ElMessage.success(`发现 ${fields.length} 个字段`);
  } catch (err: any) {
    addLog(false, `扫描失败: ${err.message}`);
    ElMessage.error(`扫描失败: ${err.message}`);
  } finally {
    scanning.value = false;
  }
};

const fillAllFields = async () => {
  if (!device.value || fieldList.value.length === 0) return;
  try {
    const fields: Record<string, any> = {};
    for (const f of fieldList.value) {
      const key = f.name || f.id;
      const val = fieldValues.value[key];
      if (val !== '' && val !== undefined && val !== null) {
        fields[key] = val;
      }
    }
    const result = await wsStore.fillForm(fields);
    addLog(true, `批量填表: ${Object.keys(fields).length} 个字段`);
    ElMessage.success(`已填写 ${Object.keys(fields).length} 个字段`);
    // Refresh screenshot
    setTimeout(() => refreshScreenshot(), 500);
  } catch (err: any) {
    addLog(false, `填表失败: ${err.message}`);
    ElMessage.error(`填表失败: ${err.message}`);
  }
};

const fillSingleField = async (field: any) => {
  if (!device.value) return;
  const key = field.name || field.id;
  const val = fieldValues.value[key];
  if (val === '' || val === undefined) {
    ElMessage.warning('请先输入值');
    return;
  }
  try {
    await wsStore.fillForm({ [key]: val });
    addLog(true, `填写字段: ${key} = ${val}`);
    ElMessage.success(`已填写: ${key}`);
    setTimeout(() => refreshScreenshot(), 500);
  } catch (err: any) {
    addLog(false, `填写失败: ${err.message}`);
  }
};

const clearFieldValues = () => {
  fieldValues.value = {};
  for (const f of fieldList.value) {
    fieldValues.value[f.name || f.id] = f.type === 'checkbox' ? false : '';
  }
};

const openDOMInspector = () => {
  if (device.value) router.push(`/dom/${device.value.info.deviceId}`);
};

// ===== Logging =====
const addLog = (success: boolean, message: string) => {
  logs.value.unshift({ success, message, timestamp: Date.now() });
  if (logs.value.length > 100) logs.value = logs.value.slice(0, 100);
};

let requestIdCounter = 0;
const generateRequestId = () => `req_${Date.now()}_${requestIdCounter++}`;
</script>

<style scoped>
.remote-control { max-width: 1800px; margin: 0 auto; padding: 8px 0; }
.remote-shell { border: none; }
.card-header { display: flex; justify-content: space-between; align-items: center; gap: 16px; }
.title-block { display: flex; flex-direction: column; gap: 4px; }
.card-header h2 { margin: 0; font-size: 20px; font-weight: 700; }
.title-hint { font-size: 12px; color: #7b8190; }
.controls { display: flex; gap: 8px; flex-wrap: wrap; justify-content: flex-end; }

.screenshot-area {
  position: relative;
  min-height: 78vh;
  display: flex;
  align-items: center;
  justify-content: center;
  background:
    radial-gradient(circle at top, rgba(67, 97, 238, 0.12), transparent 32%),
    linear-gradient(180deg, #0f172a 0%, #111827 100%);
  border-radius: 18px;
  overflow: hidden;
  cursor: crosshair;
  outline: none;
  transition: box-shadow 0.15s ease;
}
.screenshot-area.fullscreen { min-height: 100vh; border-radius: 0; }
.screenshot-area.keyboard-active { box-shadow: 0 0 0 2px #60a5fa inset; }
.screenshot-image { max-width: 100%; max-height: 78vh; object-fit: contain; }
.screenshot-area.fullscreen .screenshot-image { max-height: 100vh; }

.viewport-toolbar {
  position: absolute;
  top: 16px;
  left: 16px;
  z-index: 4;
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}
.viewport-hint {
  position: absolute;
  left: 16px;
  bottom: 16px;
  z-index: 3;
  padding: 10px 14px;
  color: #e5eefc;
  font-size: 12px;
  border-radius: 999px;
  background: rgba(15, 23, 42, 0.72);
  backdrop-filter: blur(10px);
}

.interaction-bubble {
  position: absolute;
  z-index: 6;
  width: min(320px, calc(100% - 32px));
  padding: 14px;
  border-radius: 14px;
  background: rgba(255, 255, 255, 0.97);
  box-shadow: 0 18px 50px rgba(15, 23, 42, 0.28);
  backdrop-filter: blur(16px);
}
.bubble-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  margin-bottom: 10px;
  font-size: 13px;
  font-weight: 600;
  color: #0f172a;
}
.bubble-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 10px;
}

.select-picker-body { max-height: 220px; overflow-y: auto; }
.select-radio-group { display: flex; flex-direction: column; gap: 6px; width: 100%; }
.select-radio-item {
  width: 100%;
  margin: 0 !important;
  padding: 8px 10px;
  border: 1px solid #e5e7eb;
  border-radius: 10px;
}
.select-radio-item:hover { background: #eff6ff; }

.form-fill-panel { display: flex; flex-direction: column; gap: 12px; }
.form-toolbar { display: flex; gap: 8px; flex-wrap: wrap; }
.field-list { max-height: calc(100vh - 220px); overflow-y: auto; display: flex; flex-direction: column; gap: 8px; }
.field-item {
  padding: 10px 12px;
  background: #fafafa;
  border-radius: 10px;
  border: 1px solid #f0f0f0;
}
.field-item label { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; flex-wrap: wrap; }
.field-name { font-weight: 500; font-size: 13px; color: #333; }
.field-type {
  font-size: 11px;
  color: #999;
  background: #f0f0f0;
  padding: 1px 6px;
  border-radius: 3px;
  font-family: monospace;
}
.field-placeholder { font-size: 11px; color: #bbb; }
.field-input-row { display: flex; align-items: center; }

.log-panel { display: flex; flex-direction: column; gap: 8px; }
.log-entry {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  padding: 10px;
  background: #f5f7fb;
  border-radius: 10px;
}
.log-message { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.log-time { color: #999; font-size: 11px; white-space: nowrap; }

@media (max-width: 900px) {
  .card-header { flex-direction: column; align-items: flex-start; }
  .controls { width: 100%; justify-content: flex-start; }
  .screenshot-area { min-height: 60vh; }
  .screenshot-image { max-height: 60vh; }
  .viewport-hint { right: 16px; border-radius: 14px; }
}
</style>
