<template>
  <div class="console-monitor">
    <el-card>
      <template #header>
        <div class="card-header">
          <h2>控制台日志监控</h2>
          <div class="device-selector">
            <el-select v-model="selectedDeviceId" placeholder="选择设备" size="small" @change="onDeviceChange">
              <el-option
                v-for="device in devices"
                :key="device.info.deviceId"
                :label="device.info.name"
                :value="device.info.deviceId"
              />
            </el-select>
          </div>
        </div>
      </template>

      <div v-if="selectedDeviceId" class="monitor-content">
        <ConsolePanel
          :device-id="selectedDeviceId"
          :logs="mergedLogs"
        />
      </div>

      <el-empty v-else description="请选择一个设备" />
    </el-card>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch } from 'vue';
import { useWebSocketStore, getStoredJwt, getApiBase } from '@/stores/websocket';
import ConsolePanel from '@/components/ConsolePanel.vue';
import type { ConsoleLog } from '@electron-agent/shared';

interface Props {
  deviceId?: string;
}
const props = defineProps<Props>();

const wsStore = useWebSocketStore();

const devices = computed(() => wsStore.devices);
const selectedDeviceId = ref('');

const historyLogs = ref<ConsoleLog[]>([]);
const liveLogs = computed(() => wsStore.consoleLogsFor(selectedDeviceId.value).map(l => l.log));
const mergedLogs = computed(() => [...historyLogs.value, ...liveLogs.value]);

const fetchHistory = async () => {
  if (!selectedDeviceId.value) return;
  const token = getStoredJwt();
  if (!token) return;
  try {
    const res = await fetch(`${getApiBase()}/api/console?deviceId=${selectedDeviceId.value}&limit=1000`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.ok) {
      const data = await res.json();
      historyLogs.value = data.logs || [];
    }
  } catch (err) {
    console.error('Failed to fetch console history:', err);
  }
};

const onDeviceChange = async () => {
  historyLogs.value = [];
  if (!selectedDeviceId.value) return;
  const target = wsStore.devices.find(d => d.info.deviceId === selectedDeviceId.value);
  if (target) wsStore.selectDevice(target);
  await fetchHistory();
  await wsStore.subscribeConsole(true).catch((e) => console.error('subscribeConsole failed:', e));
};

onMounted(() => {
  selectedDeviceId.value = props.deviceId || (devices.value[0]?.info.deviceId ?? '');
  if (selectedDeviceId.value) onDeviceChange();
});

watch(() => devices.value, (list) => {
  if (!selectedDeviceId.value && list.length > 0) {
    selectedDeviceId.value = props.deviceId || list[0].info.deviceId;
    onDeviceChange();
  }
});

onUnmounted(() => {
  wsStore.subscribeConsole(false).catch(() => {});
});
</script>

<style scoped>
.console-monitor {
  max-width: 1600px;
  margin: 0 auto;
  padding: 16px;
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

.monitor-content {
  min-height: 600px;
}
</style>
