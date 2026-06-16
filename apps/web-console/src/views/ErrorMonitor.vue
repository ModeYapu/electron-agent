<template>
  <div class="error-monitor">
    <el-card>
      <template #header>
        <div class="card-header">
          <h2>JS 错误监控</h2>
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
        <ErrorPanel
          :device-id="selectedDeviceId"
          :errors="mergedErrors"
        />
      </div>

      <el-empty v-else description="请选择一个设备" />
    </el-card>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue';
import { useWebSocketStore, getStoredJwt, getApiBase } from '@/stores/websocket';
import ErrorPanel from '@/components/ErrorPanel.vue';
import type { JSError } from '@electron-agent/shared';

interface Props {
  deviceId?: string;
}
const props = defineProps<Props>();

const wsStore = useWebSocketStore();

const devices = computed(() => wsStore.devices);
const selectedDeviceId = ref('');

const historyErrors = ref<JSError[]>([]);
// Errors are always reported by the agent (no subscription needed); the store
// keeps the live buffer, scoped to the selected device.
const liveErrors = computed(() => wsStore.errorLogsFor(selectedDeviceId.value).map(l => l.error));
const mergedErrors = computed(() => [...historyErrors.value, ...liveErrors.value]);

const fetchHistory = async () => {
  if (!selectedDeviceId.value) return;
  const token = getStoredJwt();
  if (!token) return;
  try {
    const res = await fetch(`${getApiBase()}/api/errors?deviceId=${selectedDeviceId.value}&limit=1000`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.ok) {
      const data = await res.json();
      historyErrors.value = data.errors || [];
    }
  } catch (err) {
    console.error('Failed to fetch error history:', err);
  }
};

const onDeviceChange = async () => {
  historyErrors.value = [];
  if (!selectedDeviceId.value) return;
  const target = wsStore.devices.find(d => d.info.deviceId === selectedDeviceId.value);
  if (target) wsStore.selectDevice(target);
  await fetchHistory();
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
</script>

<style scoped>
.error-monitor {
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
