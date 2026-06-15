<template>
  <div class="remote-control">
    <el-row :gutter="24">
      <el-col :span="16">
        <el-card>
          <template #header>
            <div class="card-header">
              <h2>远程控制</h2>
              <div class="controls">
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
              <el-empty v-else description="无截图数据" />
            </div>

            <div class="action-bar">
              <el-form :model="controlForm" label-width="80px" size="small">
                <el-form-item label="URL 导航">
                  <el-input
                    v-model="controlForm.url"
                    placeholder="输入 URL"
                    @keyup.enter="navigate"
                  >
                    <template #append>
                      <el-button @click="navigate" type="primary">跳转</el-button>
                    </template>
                  </el-input>
                </el-form-item>

                <el-form-item label="JS 执行">
                  <el-input
                    v-model="controlForm.code"
                    type="textarea"
                    :rows="3"
                    placeholder="输入 JavaScript 代码"
                  />
                  <el-button @click="evalCode" type="primary" style="margin-top: 8px">
                    执行
                  </el-button>
                </el-form-item>

                <el-form-item label="文本输入">
                  <el-input
                    v-model="controlForm.text"
                    placeholder="输入要发送的文本"
                    @keyup.enter="typeText"
                  >
                    <template #append>
                      <el-button @click="typeText" type="primary">发送</el-button>
                    </template>
                  </el-input>
                </el-form-item>
              </el-form>
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
import { ref, computed, onMounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useWebSocketStore } from '@/stores/websocket';
import { ElMessage } from 'element-plus';

const route = useRoute();
const router = useRouter();
const wsStore = useWebSocketStore();

const device = computed(() => wsStore.currentDevice);
const screenshot = computed(() => wsStore.currentScreenshot);

const controlForm = ref({
  url: '',
  code: '',
  text: '',
});

const logs = ref<Array<{ success: boolean; message: string; timestamp: number }>>([]);

onMounted(() => {
  const deviceId = route.params.deviceId as string;
  if (deviceId) {
    const targetDevice = wsStore.devices.find(d => d.info.deviceId === deviceId);
    if (targetDevice) {
      wsStore.selectDevice(targetDevice);
    }
  }
});

const handleImageClick = (event: MouseEvent) => {
  const target = event.target as HTMLImageElement;
  const rect = target.getBoundingClientRect();
  const x = event.clientX - rect.left;
  const y = event.clientY - rect.top;

  clickAt(x, y);
};

const clickAt = async (x: number, y: number) => {
  if (!device.value) return;

  try {
    await wsStore.send({
      type: 'cmd:click',
      requestId: generateRequestId(),
      x: Math.round(x),
      y: Math.round(y),
      button: 'left',
    });
    addLog(true, `点击坐标: (${Math.round(x)}, ${Math.round(y)})`);
  } catch (error) {
    addLog(false, `点击失败: ${error}`);
    ElMessage.error(`点击失败: ${error}`);
  }
};

const navigate = async () => {
  if (!device.value || !controlForm.value.url) return;

  try {
    await wsStore.send({
      type: 'cmd:navigate',
      requestId: generateRequestId(),
      url: controlForm.value.url,
    });
    addLog(true, `导航到: ${controlForm.value.url}`);
    controlForm.value.url = '';
    ElMessage.success('导航成功');
  } catch (error) {
    addLog(false, `导航失败: ${error}`);
    ElMessage.error(`导航失败: ${error}`);
  }
};

const evalCode = async () => {
  if (!device.value || !controlForm.value.code) return;

  try {
    await wsStore.send({
      type: 'cmd:eval',
      requestId: generateRequestId(),
      code: controlForm.value.code,
    });
    addLog(true, `执行 JS: ${controlForm.value.code.substring(0, 50)}...`);
    controlForm.value.code = '';
    ElMessage.success('JS 执行成功');
  } catch (error) {
    addLog(false, `JS 执行失败: ${error}`);
    ElMessage.error(`JS 执行失败: ${error}`);
  }
};

const typeText = async () => {
  if (!device.value || !controlForm.value.text) return;

  try {
    await wsStore.send({
      type: 'cmd:type',
      requestId: generateRequestId(),
      text: controlForm.value.text,
    });
    addLog(true, `输入文本: ${controlForm.value.text}`);
    controlForm.value.text = '';
    ElMessage.success('文本输入成功');
  } catch (error) {
    addLog(false, `文本输入失败: ${error}`);
    ElMessage.error(`文本输入失败: ${error}`);
  }
};

const refreshScreenshot = async () => {
  if (!device.value) return;

  try {
    await wsStore.send({
      type: 'cmd:screenshot',
      requestId: generateRequestId(),
      quality: 60,
    });
    ElMessage.success('刷新截图成功');
  } catch (error) {
    addLog(false, `刷新截图失败: ${error}`);
    ElMessage.error(`刷新截图失败: ${error}`);
  }
};

const openDOMInspector = () => {
  if (device.value) {
    router.push(`/dom/${device.value.info.deviceId}`);
  }
};

const addLog = (success: boolean, message: string) => {
  logs.value.unshift({
    success,
    message,
    timestamp: Date.now(),
  });

  if (logs.value.length > 50) {
    logs.value = logs.value.slice(0, 50);
  }
};

let requestIdCounter = 0;
const generateRequestId = () => {
  return `req_${Date.now()}_${requestIdCounter++}`;
};
</script>

<style scoped>
.remote-control {
  max-width: 1600px;
  margin: 0 auto;
}

.card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.card-header h2 {
  margin: 0;
  font-size: 18px;
  font-weight: 600;
}

.controls {
  display: flex;
  gap: 8px;
}

.control-panel {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.screenshot-area {
  min-height: 400px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #000;
  border-radius: 4px;
  overflow: hidden;
  cursor: crosshair;
}

.screenshot-image {
  max-width: 100%;
  max-height: 500px;
  object-fit: contain;
}

.action-bar {
  padding-top: 16px;
  border-top: 1px solid #e0e0e0;
}

.log-panel {
  max-height: 400px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.log-entry {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  padding: 8px;
  background: #f5f5f5;
  border-radius: 4px;
}

.log-message {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.log-time {
  color: #999;
  font-size: 11px;
}
</style>
