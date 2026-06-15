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
              />
              <el-empty v-else description="无截图数据 — 点击「刷新截图」或「开始直播」" />
            </div>

            <div class="action-bar">
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
const handleImageClick = (event: MouseEvent) => {
  const target = event.target as HTMLImageElement;
  const rect = target.getBoundingClientRect();
  const x = event.clientX - rect.left;
  const y = event.clientY - rect.top;
  clickAt(x, y);
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
    await wsStore.send({ type: 'cmd:type', requestId: generateRequestId(), text: controlForm.value.text });
    addLog(true, `输入文本: ${controlForm.value.text}`);
    controlForm.value.text = '';
  } catch (err) { addLog(false, `输入失败: ${err}`); }
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
.action-bar { padding-top: 16px; border-top: 1px solid #e0e0e0; }

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
