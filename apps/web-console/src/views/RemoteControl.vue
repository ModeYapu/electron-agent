<template>
  <div class="remote-control">
    <el-row :gutter="24">
      <el-col :span="16">
        <el-card>
          <template #header>
            <div class="card-header">
              <h2>远程控制</h2>
              <div class="controls">
                <el-button
                  @click="toggleStreaming"
                  :type="streaming ? 'danger' : 'success'"
                  size="small"
                >
                  {{ streaming ? '⏹ 停止直播' : '▶ 开始直播' }}
                </el-button>
                <el-button @click="refreshScreenshot" type="primary" size="small">
                  刷新截图
                </el-button>
                <el-button @click="openDOMInspector" type="default" size="small">
                  DOM 检查器
                </el-button>
              </div>
            </div>
          </template>

          <div class="control-panel">
            <div class="screenshot-area" v-if="device">
                <img
                  v-if="screenshot"
                  :src="'data:image/jpeg;base64,' + screenshot"
                  alt="Screenshot"
                  class="screenshot-image"
                  @click="handleImageClick"
                  @wheel.prevent="handleScroll"
                />
              <el-empty v-else description="无截图数据 — 点击「刷新截图」或「开始直播」" />
            </div>

            <div class="action-bar">
              <!-- Select picker overlay -->
              <div v-if="showSelectPicker" class="select-picker-overlay">
                <div class="select-picker-card">
                  <div class="select-picker-header">
                    <span>🔽 选择下拉选项</span>
                    <el-button @click="showSelectPicker = false" size="small" circle>✕</el-button>
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
                  <div class="select-picker-footer">
                    <el-button @click="showSelectPicker = false" size="small">取消</el-button>
                    <el-button @click="applySelectValue" type="primary" size="small">确认选择</el-button>
                  </div>
                </div>
              </div>

              <el-tabs v-model="activeTab" type="border-card" size="small">
                <!-- Tab 1: Quick actions -->
                <el-tab-pane label="快捷操作" name="actions">
                  <el-form :model="controlForm" label-width="80px" size="small">
                    <el-form-item label="URL 导航">
                      <el-input v-model="controlForm.url" placeholder="输入 URL" @keyup.enter="navigate">
                        <template #append>
                          <el-button @click="navigate" type="primary">跳转</el-button>
                        </template>
                      </el-input>
                    </el-form-item>
                    <el-form-item label="JS 执行">
                      <el-input v-model="controlForm.code" type="textarea" :rows="3" placeholder="JavaScript code" />
                      <el-button @click="evalCode" type="primary" style="margin-top: 8px">执行</el-button>
                    </el-form-item>
                    <el-form-item label="文本输入">
                      <el-input v-model="controlForm.text" placeholder="输入要发送的文本" @keyup.enter="typeText">
                        <template #append>
                          <el-button @click="typeText" type="primary">发送</el-button>
                        </template>
                      </el-input>
                    </el-form-item>
                  </el-form>
                </el-tab-pane>

                <!-- Tab 2: Form filling -->
                <el-tab-pane label="表单填写" name="form">
                  <div class="form-fill-panel">
                    <div class="form-toolbar">
                      <el-button @click="scanFields" type="primary" size="small" :loading="scanning">
                        扫描表单字段
                      </el-button>
                      <el-button @click="fillAllFields" type="success" size="small" :disabled="fieldList.length === 0">
                        一键填表
                      </el-button>
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
                    <el-empty v-else description="点击「扫描表单字段」获取表单结构" :image-size="60" />
                  </div>
                </el-tab-pane>
              </el-tabs>
            </div>
          </div>
        </el-card>
      </el-col>

      <el-col :span="8">
        <el-card>
          <template #header>
            <h2>执行日志</h2>
          </template>
          <div class="log-panel">
            <div class="log-entry" v-for="(log, index) in logs" :key="index">
              <el-tag :type="log.success ? 'success' : 'danger'" size="small">
                {{ log.success ? '成功' : '失败' }}
              </el-tag>
              <span class="log-message">{{ log.message }}</span>
              <span class="log-time">{{ new Date(log.timestamp).toLocaleTimeString() }}</span>
            </div>
            <el-empty v-if="logs.length === 0" description="暂无日志" />
          </div>
        </el-card>
      </el-col>
    </el-row>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useWebSocketStore } from '@/stores/websocket';
import { ElMessage } from 'element-plus';
import { Check } from '@element-plus/icons-vue';

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
});

onUnmounted(() => {
  if (streamInterval) stopStreaming();
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

  // Request continuous capture at 2 FPS
  wsStore.send({
    type: 'cmd:startCapture',
    requestId: generateRequestId(),
    fps: 2,
    quality: 50,
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

// ===== Screenshot =====
const handleImageClick = async (event: MouseEvent) => {
  const target = event.target as HTMLImageElement;
  const rect = target.getBoundingClientRect();
  const vpW = wsStore.viewportWidth || target.naturalWidth;
  const vpH = wsStore.viewportHeight || target.naturalHeight;
  if (!vpW || !vpH) return;
  const scaleX = vpW / rect.width;
  const scaleY = vpH / rect.height;
  const x = Math.round((event.clientX - rect.left) * scaleX);
  const y = Math.round((event.clientY - rect.top) * scaleY);

  // Click first, then detect what was clicked
  await clickAt(x, y);

  // Detect element type at clicked position
  await detectAndHandleElement(x, y);
};

const handleScroll = (event: WheelEvent) => {
  if (!device.value) return;
  const deltaY = event.deltaY;
  const deltaX = event.deltaX;
  wsStore.send({
    type: 'cmd:scroll',
    requestId: generateRequestId(),
    deltaX: Math.round(deltaX),
    deltaY: Math.round(deltaY),
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

// Detect element type at coordinates and handle specially for selects
const selectOptions = ref<Array<{text: string; value: string; selected: boolean}>>([]);
const selectedValue = ref('');
const showSelectPicker = ref(false);
const selectTargetX = ref(0);
const selectTargetY = ref(0);
const selectTargetSelector = ref(''); // CSS selector for precise re-targeting

// Last click position for typeText to re-find the input
let lastClickX = 0;
let lastClickY = 0;

const detectAndHandleElement = async (x: number, y: number) => {
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
      const info = result.data as any;
      if (info.tag === 'SELECT' && info.options?.length > 0) {
        selectOptions.value = info.options;
        selectedValue.value = info.options.find((o: any) => o.selected)?.value || '';
        selectTargetX.value = x;
        selectTargetY.value = y;
        // Build a durable selector from the element's name or id
        selectTargetSelector.value = info.name
          ? `[name="${info.name}"]`
          : info.id
            ? `#${info.id}`
            : `select:nth-of-type(${info.index || 1})`;
        showSelectPicker.value = true;
        addLog(true, `检测到下拉框: ${info.name || info.id || info.tag} (${info.options.length} 个选项)`);
      } else if (info.tag === 'INPUT' || info.tag === 'TEXTAREA') {
        addLog(true, `已聚焦: ${info.tag} ${info.name || info.id || ''}`);
      }
    }
  } catch (err: any) {
    // Silent — detection is best-effort
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
    const safeText = JSON.stringify(controlForm.value.text);
    const result = await wsStore.send({
      type: 'cmd:eval',
      requestId: generateRequestId(),
      code: `(() => {
        const el = document.elementFromPoint(${lastClickX}, ${lastClickY})
          || document.activeElement;
        if (!el) return JSON.stringify({ok:false, why:'no element found'});
        const t = el.tagName;
        if (t !== 'INPUT' && t !== 'TEXTAREA' && t !== 'SELECT')
          return JSON.stringify({ok:false, why:'not input', tag:t});
        // Straightforward direct set
        el.value = ${safeText};
        el.dispatchEvent(new Event('input', {bubbles:true}));
        el.dispatchEvent(new Event('change', {bubbles:true}));
        el.focus();
        return JSON.stringify({ok:true, tag:t, val:el.value});
      })()`,
    });
    const info = typeof result.data === 'string' ? JSON.parse(result.data) : result.data;
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
.remote-control { max-width: 1600px; margin: 0 auto; }
.card-header { display: flex; justify-content: space-between; align-items: center; }
.card-header h2 { margin: 0; font-size: 18px; font-weight: 600; }
.controls { display: flex; gap: 8px; }
.control-panel { display: flex; flex-direction: column; gap: 16px; }
.screenshot-area {
  min-height: 400px; display: flex; align-items: center; justify-content: center;
  background: #000; border-radius: 4px; overflow: hidden; cursor: crosshair;
}
.screenshot-image { max-width: 100%; max-height: 500px; object-fit: contain; }
.action-bar { padding-top: 16px; border-top: 1px solid #e0e0e0; position: relative; }

/* Select picker */
.select-picker-overlay {
  position: absolute; top: 0; left: 0; right: 0; z-index: 100;
  background: rgba(255,255,255,0.95); border-radius: 8px; padding: 16px;
  box-shadow: 0 4px 20px rgba(0,0,0,0.15);
}
.select-picker-card { display: flex; flex-direction: column; gap: 12px; }
.select-picker-header { display: flex; justify-content: space-between; align-items: center; font-weight: 600; }
.select-picker-body { max-height: 200px; overflow-y: auto; }
.select-radio-group { display: flex; flex-direction: column; gap: 6px; width: 100%; }
.select-radio-item { 
  padding: 6px 10px; border-radius: 4px; margin: 0 !important;
  border: 1px solid #eee; width: 100%;
}
.select-radio-item:hover { background: #f0f7ff; }
.select-picker-footer { display: flex; justify-content: flex-end; gap: 8px; }

/* Form fill panel */
.form-fill-panel { display: flex; flex-direction: column; gap: 12px; }
.form-toolbar { display: flex; gap: 8px; }
.field-list { max-height: 300px; overflow-y: auto; display: flex; flex-direction: column; gap: 8px; }
.field-item {
  padding: 8px 12px; background: #fafafa; border-radius: 6px;
  border: 1px solid #f0f0f0;
}
.field-item label { display: flex; align-items: center; gap: 8px; margin-bottom: 4px; }
.field-name { font-weight: 500; font-size: 13px; color: #333; }
.field-type {
  font-size: 11px; color: #999; background: #f0f0f0; padding: 1px 6px;
  border-radius: 3px; font-family: monospace;
}
.field-placeholder { font-size: 11px; color: #bbb; }
.field-input-row { display: flex; align-items: center; }

/* Logs */
.log-panel { max-height: 400px; overflow-y: auto; display: flex; flex-direction: column; gap: 8px; }
.log-entry {
  display: flex; align-items: center; gap: 8px; font-size: 12px;
  padding: 8px; background: #f5f5f5; border-radius: 4px;
}
.log-message { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.log-time { color: #999; font-size: 11px; white-space: nowrap; }
</style>
