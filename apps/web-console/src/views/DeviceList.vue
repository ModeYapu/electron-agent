<template>
  <div class="device-list">
    <el-card>
      <template #header>
        <div class="card-header">
          <h2>设备列表</h2>
          <el-button @click="refreshDevices" :loading="loading" type="primary" size="small">
            刷新
          </el-button>
        </div>
      </template>

      <el-table :data="devices" style="width: 100%">
        <el-table-column prop="info.name" label="设备名称" width="200" />
        <el-table-column prop="info.deviceId" label="设备 ID" width="300" />
        <el-table-column prop="info.os" label="操作系统" width="100" />
        <el-table-column prop="status" label="状态" width="100">
          <template #default="{ row }">
            <el-tag :type="row.status === 'online' ? 'success' : 'info'">
              {{ row.status === 'online' ? '在线' : '离线' }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="currentPage.url" label="当前页面" show-overflow-tooltip />
        <el-table-column label="操作" width="400">
          <template #default="{ row }">
            <el-button
              type="primary"
              size="small"
              @click="goToMonitor(row)"
              :disabled="row.status !== 'online'"
            >
              监控
            </el-button>
            <el-button
              type="default"
              size="small"
              @click="goToControl(row)"
              :disabled="row.status !== 'online'"
            >
              控制
            </el-button>
            <el-dropdown split-button type="default" size="small" @click="goToNetworkMonitor(row)">
              更多
              <template #dropdown>
                <el-dropdown-menu>
                  <el-dropdown-item @click="goToNetworkMonitor(row)">网络监控</el-dropdown-item>
                  <el-dropdown-item @click="goToConsoleMonitor(row)">控制台监控</el-dropdown-item>
                  <el-dropdown-item @click="goToErrorMonitor(row)">错误监控</el-dropdown-item>
                  <el-dropdown-item @click="goToDOMInspector(row)">DOM 检查器</el-dropdown-item>
                  <el-dropdown-item @click="goToCookieManager(row)">Cookie 管理器</el-dropdown-item>
                  <el-dropdown-item @click="goToStorageManager(row)">Storage 管理器</el-dropdown-item>
                </el-dropdown-menu>
              </template>
            </el-dropdown>
          </template>
        </el-table-column>
      </el-table>
    </el-card>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { useWebSocketStore } from '@/stores/websocket';
import type { Device } from '@electron-agent/shared';

const router = useRouter();
const wsStore = useWebSocketStore();
const loading = ref(false);

const devices = computed(() => wsStore.devices);

const refreshDevices = () => {
  loading.value = true;
  setTimeout(() => {
    loading.value = false;
  }, 500);
};

const goToMonitor = (device: Device) => {
  router.push(`/monitor/${device.info.deviceId}`);
};

const goToControl = (device: Device) => {
  router.push(`/control/${device.info.deviceId}`);
};

const goToNetworkMonitor = (device: Device) => {
  router.push(`/network/${device.info.deviceId}`);
};

const goToConsoleMonitor = (device: Device) => {
  router.push(`/console/${device.info.deviceId}`);
};

const goToErrorMonitor = (device: Device) => {
  router.push(`/errors/${device.info.deviceId}`);
};

const goToDOMInspector = (device: Device) => {
  router.push(`/dom/${device.info.deviceId}`);
};

const goToCookieManager = (device: Device) => {
  router.push(`/cookies/${device.info.deviceId}`);
};

const goToStorageManager = (device: Device) => {
  router.push(`/storage/${device.info.deviceId}`);
};
</script>

<style scoped>
.device-list {
  max-width: 1400px;
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
</style>
