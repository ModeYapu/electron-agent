<template>
  <div class="live-monitor">
    <el-row :gutter="24">
      <el-col :span="16">
        <el-card>
          <template #header>
            <div class="card-header">
              <h2>实时监控</h2>
              <div class="controls">
                <el-button @click="startCapture" type="primary" size="small" :disabled="isCapturing">开始截图</el-button>
                <el-button @click="stopCapture" type="danger" size="small" :disabled="!isCapturing">停止截图</el-button>
              </div>
            </div>
          </template>

          <el-tabs v-model="activeTab" class="monitor-tabs">
            <el-tab-pane label="实时截图" name="screenshot">
              <div class="screenshot-container" v-if="device">
                <ScreenshotClicker
                  v-if="screenshot"
                  :screenshot-data="'data:image/jpeg;base64,' + screenshot"
                  :device-id="device.info.deviceId"
                  :action-mode="clickMode"
                  @click="handleScreenshotClick"
                  @contextMenu="handleScreenshotContextMenu"
                />
                <el-empty v-else description="无截图数据 — 请点击「开始截图」" />
              </div>
              <!-- 点击模式切换 -->
              <div class="click-mode-bar" v-if="screenshot">
                <el-radio-group v-model="clickMode" size="small">
                  <el-radio-button value="click">🖱 点击</el-radio-button>
                  <el-radio-button value="type">⌨ 输入文字</el-radio-button>
                  <el-radio-button value="select">📋 选择下拉</el-radio-button>
                </el-radio-group>
                <span class="mode-hint">{{ modeHint }}</span>
              </div>
            </el-tab-pane>

            <el-tab-pane label="表单操控" name="form">
              <div class="form-control-panel">
                <div class="form-toolbar">
                  <el-button @click="scanFields" type="primary" size="small" :loading="scanning">
                    🔍 扫描表单字段
                  </el-button>
                  <el-button @click="fillAllFields" type="success" size="small" :disabled="formFields.length === 0">
                    ✅ 批量填写
                  </el-button>
                  <el-button @click="clearFormValues" size="small" :disabled="formFields.length === 0">
                    🗑 清空值
                  </el-button>
                </div>

                <el-empty v-if="formFields.length === 0 && !scanning" description="点击「扫描表单字段」获取页面表单" />

                <div v-if="formFields.length > 0" class="form-fields-list">
                  <div v-for="(field, idx) in formFields" :key="idx" class="form-field-item">
                    <div class="field-header">
                      <el-tag :type="fieldTypeTag(field.type)" size="small" effect="plain">
                        {{ field.type }}
                      </el-tag>
                      <span class="field-name">{{ field.name || field.id }}</span>
                      <span v-if="field.required" class="field-required">*必填</span>
                      <span class="field-current" v-if="field.value">当前: {{ field.value }}</span>
                    </div>
                    <div class="field-input-row">
                      <!-- text/password/email/tel/date/textarea -->
                      <template v-if="isTextLike(field.type)">
                        <el-input v-model="fieldValues[field.name || field.id]" :placeholder="field.placeholder || '输入值'" size="small" @keyup.enter="fillSingleField(field)" />
                        <el-button @click="fillSingleField(field)" type="primary" size="small" :icon="'Check'" circle />
                      </template>
                      <!-- select / dropdown -->
                      <template v-else-if="field.type === 'select-one'">
                        <el-select v-model="fieldValues[field.name || field.id]" placeholder="选择..." size="small" @change="(val: string) => fillSingleField(field)" clearable>
                          <el-option v-for="opt in (field.options || [])" :key="opt" :label="opt" :value="opt" />
                        </el-select>
                      </template>
                      <!-- radio -->
                      <template v-else-if="field.type === 'radio'">
                        <el-radio-group v-model="fieldValues[field.name || field.id]" size="small" @change="(val: string) => fillSingleField(field)">
                          <el-radio v-for="opt in (field.options || [])" :key="opt" :value="opt">{{ opt }}</el-radio>
                        </el-radio-group>
                      </template>
                      <!-- checkbox -->
                      <template v-else-if="field.type === 'checkbox'">
                        <el-checkbox v-model="fieldValues[field.name || field.id]" size="small" @change="() => fillSingleField(field)" />
                      </template>
                      <!-- unknown -->
                      <template v-else>
                        <el-input v-model="fieldValues[field.name || field.id]" placeholder="输入值" size="small" />
                        <el-button @click="fillSingleField(field)" type="primary" size="small" circle />
                      </template>
                    </div>
                  </div>
                </div>
              </div>
            </el-tab-pane>

            <el-tab-pane label="导航历史" name="navigation">
              <NavigationTimeline :events="navigationHistory" @navigate="handleNavigateEvent" />
            </el-tab-pane>
          </el-tabs>
        </el-card>
      </el-col>

      <el-col :span="8">
        <el-card>
          <template #header><h2>设备信息</h2></template>
          <div v-if="device" class="device-info">
            <el-descriptions :column="1" border>
              <el-descriptions-item label="设备名称">{{ device.info.name }}</el-descriptions-item>
              <el-descriptions-item label="设备 ID">{{ device.info.deviceId }}</el-descriptions-item>
              <el-descriptions-item label="操作系统">{{ device.info.os }}</el-descriptions-item>
              <el-descriptions-item label="Electron 版本">{{ device.info.version }}</el-descriptions-item>
              <el-descriptions-item label="应用版本">{{ device.info.appVersion }}</el-descriptions-item>
              <el-descriptions-item label="当前 URL">{{ device.currentPage?.url || 'N/A' }}</el-descriptions-item>
              <el-descriptions-item label="页面标题">{{ device.currentPage?.title || 'N/A' }}</el-descriptions-item>
            </el-descriptions>
          </div>
        </el-card>
      </el-col>
    </el-row>

    <!-- 输入对话框 -->
    <el-dialog v-model="inputDialog.visible" title="输入文字" width="400px" @closed="inputDialog.callback = null">
      <el-input v-model="inputDialog.text" placeholder="请输入要填入的文字" @keyup.enter="confirmInputDialog" />
      <template #footer>
        <el-button @click="inputDialog.visible = false">取消</el-button>
        <el-button type="primary" @click="confirmInputDialog">确定</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, reactive } from 'vue';
import { useRoute } from 'vue-router';
import { useWebSocketStore } from '@/stores/websocket';
import NavigationTimeline from '@/components/NavigationTimeline.vue';
import ScreenshotClicker from '@/components/ScreenshotClicker.vue';
import { ElMessage } from 'element-plus';

const route = useRoute();
const wsStore = useWebSocketStore();

const device = computed(() => wsStore.currentDevice);
const screenshot = computed(() => wsStore.currentScreenshot);
const isCapturing = ref(false);
const activeTab = ref('screenshot');

// Click mode
const clickMode = ref<'click' | 'type' | 'select'>('click');
const modeHint = computed(() => {
  switch (clickMode.value) {
    case 'click': return '点击截图位置 → 远程鼠标单击';
    case 'type': return '点击输入框 → 弹出输入对话框 → 自动填入文字';
    case 'select': return '点击下拉框位置 → 打开下拉 → 需要手动选值';
  }
});

// Form fields
interface FormField {
  name: string;
  id: string;
  type: string;
  value: string;
  placeholder: string;
  required: boolean;
  options?: string[];
}
const formFields = ref<FormField[]>([]);
const fieldValues = reactive<Record<string, any>>({});
const scanning = ref(false);

// Input dialog
const inputDialog = reactive({
  visible: false,
  text: '',
  targetX: 0,
  targetY: 0,
  callback: null as (() => void) | null,
});

const navigationHistory = ref<Array<{ url: string; title: string; timestamp: number; loadTime?: number }>>([]);

let requestIdCounter = 0;
const generateRequestId = () => `req_${Date.now()}_${requestIdCounter++}`;

onMounted(() => {
  const deviceId = route.params.deviceId as string;
  if (deviceId) {
    const targetDevice = wsStore.devices.find(d => d.info.deviceId === deviceId);
    if (targetDevice) wsStore.selectDevice(targetDevice);
  }
});

onUnmounted(() => { stopCapture(); });

const startCapture = async () => {
  if (!device.value) return;
  try {
    await wsStore.send({ type: 'cmd:startCapture', requestId: generateRequestId(), fps: 1, quality: 60 });
    isCapturing.value = true;
    ElMessage.success('开始截图成功');
  } catch (error) {
    ElMessage.error(`开始截图失败: ${error}`);
  }
};

const stopCapture = async () => {
  if (!device.value) return;
  try {
    await wsStore.send({ type: 'cmd:stopCapture', requestId: generateRequestId() });
    isCapturing.value = false;
    ElMessage.success('停止截图成功');
  } catch (error) {
    ElMessage.error(`停止截图失败: ${error}`);
  }
};

const handleNavigateEvent = async (event: any) => {
  if (!device.value) return;
  try {
    await wsStore.send({ type: 'cmd:navigate', requestId: generateRequestId(), url: event.url });
    ElMessage.success(`导航到 ${event.url}`);
  } catch (error) {
    ElMessage.error(`导航失败: ${error}`);
  }
};

const handleScreenshotClick = async (data: { x: number; y: number; button: 'left' | 'right' }) => {
  if (!device.value) return;

  if (clickMode.value === 'type' && data.button === 'left') {
    // Type mode: click to focus, then show input dialog
    try {
      await wsStore.send({ type: 'cmd:click', requestId: generateRequestId(), x: data.x, y: data.y, button: 'left' });
      await new Promise(r => setTimeout(r, 300));
      inputDialog.targetX = data.x;
      inputDialog.targetY = data.y;
      inputDialog.text = '';
      inputDialog.visible = true;
      inputDialog.callback = async () => {
        if (!device.value) return;
        try {
          await wsStore.send({ type: 'cmd:type', requestId: generateRequestId(), text: inputDialog.text });
          ElMessage.success('已输入');
        } catch (error) {
          ElMessage.error(`输入失败: ${error}`);
        }
      };
    } catch (error) {
      ElMessage.error(`点击失败: ${error}`);
    }
    return;
  }

  if (clickMode.value === 'select' && data.button === 'left') {
    // Select mode: click to open dropdown
    try {
      await wsStore.send({ type: 'cmd:click', requestId: generateRequestId(), x: data.x, y: data.y, button: 'left' });
      ElMessage.info('已点击下拉框，请在截图中选择选项（切回点击模式后点击选项）');
    } catch (error) {
      ElMessage.error(`点击失败: ${error}`);
    }
    return;
  }

  // Default: plain click
  try {
    await wsStore.send({ type: 'cmd:click', requestId: generateRequestId(), x: data.x, y: data.y, button: data.button });
  } catch (error) {
    ElMessage.error(`点击失败: ${error}`);
  }
};

const confirmInputDialog = () => {
  inputDialog.visible = false;
  if (inputDialog.callback) inputDialog.callback();
};

const handleScreenshotContextMenu = async (data: { x: number; y: number }) => {
  if (!device.value) return;
  try {
    await wsStore.send({ type: 'cmd:click', requestId: generateRequestId(), x: data.x, y: data.y, button: 'right' });
  } catch (error) {
    console.error('Failed to context menu click:', error);
  }
};

// ===== 表单操控 =====
const fieldTypeTag = (type: string) => {
  const map: Record<string, string> = {
    'text': '', 'password': 'warning', 'email': '', 'tel': '', 'date': '', 'number': '',
    'textarea': 'info', 'select-one': 'success', 'radio': '', 'checkbox': '',
  };
  return map[type] || '';
};

const isTextLike = (type: string) => {
  return ['text', 'password', 'email', 'tel', 'date', 'number', 'textarea', 'url', 'search'].includes(type);
};

const scanFields = async () => {
  if (!device.value) return;
  scanning.value = true;
  try {
    const fields = await wsStore.getFields();
    formFields.value = fields.map((f: any) => ({
      name: f.name,
      id: f.id,
      type: f.type,
      value: String(f.value ?? ''),
      placeholder: f.placeholder || '',
      required: f.required || false,
      options: f.options || [],
    }));
    // Initialize fieldValues
    formFields.value.forEach(f => {
      const key = f.name || f.id;
      if (!(key in fieldValues)) fieldValues[key] = '';
    });
    ElMessage.success(`扫描到 ${fields.length} 个表单字段`);
  } catch (error) {
    ElMessage.error(`扫描失败: ${error}`);
  } finally {
    scanning.value = false;
  }
};

const fillSingleField = async (field: FormField) => {
  if (!device.value) return;
  const key = field.name || field.id;
  const value = fieldValues[key];
  if (value === undefined || value === '') {
    ElMessage.warning(`请填写 ${field.name || field.id} 的值`);
    return;
  }
  try {
    // Use cmd:eval to call __agentSetField on the page
    const jsValue = typeof value === 'boolean' ? String(value) : JSON.stringify(String(value));
    await wsStore.send({
      type: 'cmd:eval',
      requestId: generateRequestId(),
      code: `window.__agentSetField && window.__agentSetField('${field.name || field.id}', ${jsValue})`,
    });
    ElMessage.success(`已填写 ${field.name || field.id}`);
  } catch (error) {
    ElMessage.error(`填写失败: ${error}`);
  }
};

const fillAllFields = async () => {
  if (!device.value || formFields.value.length === 0) return;
  const filled: Record<string, string | boolean | number> = {};
  formFields.value.forEach(f => {
    const key = f.name || f.id;
    if (fieldValues[key] !== undefined && fieldValues[key] !== '') {
      filled[key] = fieldValues[key];
    }
  });
  if (Object.keys(filled).length === 0) {
    ElMessage.warning('请至少填写一个字段');
    return;
  }
  try {
    await wsStore.fillForm(filled);
    ElMessage.success(`批量填写 ${Object.keys(filled).length} 个字段完成`);
  } catch (error) {
    ElMessage.error(`批量填写失败: ${error}`);
  }
};

const clearFormValues = () => {
  formFields.value.forEach(f => {
    const key = f.name || f.id;
    fieldValues[key] = '';
  });
  ElMessage.info('已清空所有值');
};
</script>

<style scoped>
.live-monitor { padding: 8px 0; }
.card-header { display: flex; justify-content: space-between; align-items: center; }
.card-header h2 { margin: 0; font-size: 18px; }
.screenshot-container { min-height: 300px; background: #1a1a2e; border-radius: 8px; overflow: hidden; }

.click-mode-bar {
  display: flex; align-items: center; gap: 12px;
  margin-top: 12px; padding: 8px 12px;
  background: #fafafa; border-radius: 6px;
}
.mode-hint { font-size: 12px; color: #999; }

.form-control-panel { min-height: 200px; }
.form-toolbar { display: flex; gap: 8px; margin-bottom: 16px; }

.form-fields-list { max-height: 600px; overflow-y: auto; }
.form-field-item {
  padding: 10px 12px; margin-bottom: 8px;
  background: #fafafa; border: 1px solid #eee; border-radius: 8px;
}
.field-header { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; }
.field-name { font-weight: 500; font-size: 13px; }
.field-required { color: #e74c3c; font-size: 11px; }
.field-current { color: #999; font-size: 12px; margin-left: auto; }
.field-input-row { display: flex; gap: 8px; align-items: center; }

.monitor-tabs { margin-top: -8px; }
.device-info { font-size: 13px; }
</style>
