<template>
  <div class="live-monitor">
    <el-row :gutter="24">
      <el-col :span="16">
        <el-card>
          <template #header>
            <div class="card-header">
              <h2>实时监控</h2>
              <div class="controls">
                <el-button
                  @click="startCapture"
                  type="primary"
                  size="small"
                  :disabled="isCapturing"
                >
                  开始截图
                </el-button>
                <el-button
                  @click="stopCapture"
                  type="danger"
                  size="small"
                  :disabled="!isCapturing"
                >
                  停止截图
                </el-button>
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
                  @click="handleScreenshotClick"
                  @contextMenu="handleScreenshotContextMenu"
                />
                <el-empty v-else description="无截图数据" />
              </div>
            </el-tab-pane>
            <el-tab-pane label="导航历史" name="navigation">
              <NavigationTimeline
                :events="navigationHistory"
                @navigate="handleNavigateEvent"
              />
            </el-tab-pane>
          </el-tabs>
        </el-card>
      </el-col>

      <el-col :span="8">
        <el-card>
          <template #header>
            <h2>设备信息</h2>
          </template>

          <div v-if="device" class="device-info">
            <el-descriptions :column="1" border>
              <el-descriptions-item label="设备名称">
                {{ device.info.name }}
              </el-descriptions-item>
              <el-descriptions-item label="设备 ID">
                {{ device.info.deviceId }}
              </el-descriptions-item>
              <el-descriptions-item label="操作系统">
                {{ device.info.os }}
              </el-descriptions-item>
              <el-descriptions-item label="Electron 版本">
                {{ device.info.version }}
              </el-descriptions-item>
              <el-descriptions-item label="应用版本">
                {{ device.info.appVersion }}
              </el-descriptions-item>
              <el-descriptions-item label="当前 URL">
                {{ device.currentPage?.url || 'N/A' }}
              </el-descriptions-item>
              <el-descriptions-item label="页面标题">
                {{ device.currentPage?.title || 'N/A' }}
              </el-descriptions-item>
            </el-descriptions>
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
import NavigationTimeline from '@/components/NavigationTimeline.vue';
import ScreenshotClicker from '@/components/ScreenshotClicker.vue';
import { ElMessage } from 'element-plus';

const route = useRoute();
const router = useRouter();
const wsStore = useWebSocketStore();

const device = computed(() => wsStore.currentDevice);
const screenshot = computed(() => wsStore.currentScreenshot);
const isCapturing = ref(false);
const activeTab = ref('screenshot');
const navigationHistory = ref<Array<{ url: string; title: string; timestamp: number; loadTime?: number }>>([]);

onMounted(() => {
  const deviceId = route.params.deviceId as string;
  if (deviceId) {
    const targetDevice = wsStore.devices.find(d => d.info.deviceId === deviceId);
    if (targetDevice) {
      wsStore.selectDevice(targetDevice);
    }
  }
});

onUnmounted(() => {
  stopCapture();
});

const startCapture = async () => {
  if (!device.value) return;

  try {
    await wsStore.send({
      type: 'cmd:startCapture',
      requestId: generateRequestId(),
      fps: 1,
      quality: 60,
    });
    isCapturing.value = true;
    ElMessage.success('开始截图成功');
  } catch (error) {
    console.error('Failed to start capture:', error);
    ElMessage.error(`开始截图失败: ${error}`);
  }
};

const stopCapture = async () => {
  if (!device.value) return;

  try {
    await wsStore.send({
      type: 'cmd:stopCapture',
      requestId: generateRequestId(),
    });
    isCapturing.value = false;
    ElMessage.success('停止截图成功');
  } catch (error) {
    console.error('Failed to stop capture:', error);
    ElMessage.error(`停止截图失败: ${error}`);
  }
};

let requestIdCounter = 0;
const generateRequestId = () => {
  return `req_${Date.now()}_${requestIdCounter++}`;
};

const handleNavigateEvent = async (event: any) => {
  if (!device.value) return;

  try {
    await wsStore.send({
      type: 'cmd:navigate',
      requestId: generateRequestId(),
      url: event.url,
    });
    ElMessage.success(`导航到 ${event.url}`);
  } catch (error) {
    console.error('Failed to navigate:', error);
    ElMessage.error(`导航失败: ${error}`);
  }
};

const handleScreenshotClick = async (data: { x: number; y: number; button: 'left' | 'right' }) => {
  if (!device.value) return;

  try {
    await wsStore.send({
      type: 'cmd:click',
      requestId: generateRequestId(),
      x: data.x,
      y: data.y,
      button: data.button,
    });
  } catch (error) {
    console.error('Failed to click:', error);
    ElMessage.error(`点击失败: ${error}`);
  }
};

const handleScreenshotContextMenu = async (data: { x: number; y: number }) => {
  if (!device.value) return;

  try {
    await wsStore.send({
      type: 'cmd:click',
      requestId: generateRequestId(),
      x: data.x,
      y: data.y,
      button: 'right',
    });
  } catch (error) {
    console.error('Failed to context menu click:', error);
    ElMessage.error(`右键点击失败: ${error}`);
  }
};
</script>

<style scoped>
.live-monitor {
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

.screenshot-container {
  min-height: 400px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #000;
  border-radius: 4px;
  overflow: hidden;
}

.screenshot-image {
  max-width: 100%;
  max-height: 600px;
  object-fit: contain;
}

.device-info {
  font-size: 14px;
}
</style>
