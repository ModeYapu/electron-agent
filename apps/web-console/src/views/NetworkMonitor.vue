<template>
  <div class="network-monitor">
    <el-card>
      <template #header>
        <div class="card-header">
          <h2>网络请求监控</h2>
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
        <NetworkPanel
          :device-id="selectedDeviceId"
          :requests="mergedRequests"
        />
      </div>

      <el-empty v-else description="请选择一个设备" />
    </el-card>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch } from 'vue';
import { useWebSocketStore, getStoredJwt } from '@/stores/websocket';
import NetworkPanel from '@/components/NetworkPanel.vue';
import type { NetworkRequest } from '@electron-agent/shared';

interface Props {
  deviceId?: string;
}
const props = defineProps<Props>();

const wsStore = useWebSocketStore();

const devices = computed(() => wsStore.devices);
const selectedDeviceId = ref('');

// Historical requests pulled from the relay's store via HTTP (uses JWT, not a hardcoded token).
const historyRequests = ref<NetworkRequest[]>([]);

// Live requests since connecting, scoped to this device.
const liveRequests = computed(() =>
  wsStore.networkLogsFor(selectedDeviceId.value).map(l => l.request)
);

// De-dup is best-effort (live may overlap the tail of history right after fetch);
// the relay flushes batches every 500ms so the overlap window is tiny.
const mergedRequests = computed(() => [...historyRequests.value, ...liveRequests.value]);

const fetchHistory = async () => {
  if (!selectedDeviceId.value) return;
  const token = getStoredJwt();
  if (!token) return;
  try {
    const res = await fetch(`/api/network?deviceId=${selectedDeviceId.value}&limit=1000`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.ok) {
      const data = await res.json();
      historyRequests.value = data.requests || [];
    }
  } catch (err) {
    console.error('Failed to fetch network history:', err);
  }
};

const onDeviceChange = async () => {
  historyRequests.value = [];
  if (!selectedDeviceId.value) return;
  const target = wsStore.devices.find(d => d.info.deviceId === selectedDeviceId.value);
  if (target) wsStore.selectDevice(target);
  await fetchHistory();
  // Enable the live stream from the agent for this device.
  await wsStore.subscribeNetwork(true).catch((e) => console.error('subscribeNetwork failed:', e));
};

onMounted(() => {
  selectedDeviceId.value = props.deviceId || (devices.value[0]?.info.deviceId ?? '');
  if (selectedDeviceId.value) onDeviceChange();
});

// If the device list loads after mount, default to the first one.
watch(() => devices.value, (list) => {
  if (!selectedDeviceId.value && list.length > 0) {
    selectedDeviceId.value = props.deviceId || list[0].info.deviceId;
    onDeviceChange();
  }
});

onUnmounted(() => {
  // Stop the stream when leaving the page.
  wsStore.subscribeNetwork(false).catch(() => {});
});
</script>

<style scoped>
.network-monitor {
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
