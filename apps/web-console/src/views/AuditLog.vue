<template>
  <div class="audit-log">
    <el-card>
      <template #header>
        <div class="card-header">
          <h2>审计日志</h2>
          <div class="actions">
            <el-button size="small" type="primary" @click="handleExportJSON">
              导出 JSON
            </el-button>
            <el-button size="small" @click="handleExportCSV">
              导出 CSV
            </el-button>
          </div>
        </div>
      </template>

      <div class="filters">
        <el-select v-model="filters.deviceId" placeholder="设备" clearable size="small" style="width: 200px">
          <el-option
            v-for="device in devices"
            :key="device.info.deviceId"
            :label="device.info.name"
            :value="device.info.deviceId"
          />
        </el-select>
        <el-select v-model="filters.type" placeholder="事件类型" clearable size="small" style="width: 150px">
          <el-option label="连接" value="connect" />
          <el-option label="断开" value="disconnect" />
          <el-option label="截图" value="screenshot" />
          <el-option label="点击" value="click" />
          <el-option label="输入" value="type" />
          <el-option label="导航" value="navigate" />
          <el-option label="执行" value="eval" />
        </el-select>
        <el-date-picker
          v-model="dateRange"
          type="daterange"
          range-separator="至"
          start-placeholder="开始日期"
          end-placeholder="结束日期"
          size="small"
          style="width: 240px"
          @change="handleDateChange"
        />
        <el-button size="small" @click="handleFilter">筛选</el-button>
        <el-button size="small" @click="handleReset">重置</el-button>
      </div>

      <el-table
        :data="displayEvents"
        stripe
        height="500"
        class="audit-table"
      >
        <el-table-column prop="type" label="事件类型" width="100">
          <template #default="{ row }">
            <el-tag :type="getEventType(row.type)" size="small">
              {{ getEventLabel(row.type) }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="deviceId" label="设备 ID" width="200" show-overflow-tooltip />
        <el-table-column prop="operatorId" label="操作者 ID" width="150" />
        <el-table-column prop="detail" label="详情" min-width="300" show-overflow-tooltip />
        <el-table-column prop="timestamp" label="时间" width="160">
          <template #default="{ row }">
            {{ formatTime(row.timestamp) }}
          </template>
        </el-table-column>
      </el-table>

      <el-pagination
        v-model:current-page="pagination.page"
        v-model:page-size="pagination.pageSize"
        :page-sizes="[20, 50, 100]"
        :total="pagination.total"
        layout="total, sizes, prev, pager, next, jumper"
        @size-change="handleSizeChange"
        @current-change="handlePageChange"
        class="pagination"
      />
    </el-card>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { useWebSocketStore, getStoredJwt, getApiBase } from '@/stores/websocket';
import type { AuditEvent } from '@electron-agent/shared';
import { ElMessage } from 'element-plus';

const wsStore = useWebSocketStore();

const dateRange = ref<[Date, Date] | null>(null);
const filters = ref({
  deviceId: '',
  type: '',
  from: 0,
  to: 0,
});

const pagination = ref({
  page: 1,
  pageSize: 50,
  total: 0,
});

const auditEvents = ref<AuditEvent[]>([]);

const devices = computed(() => wsStore.devices);

const filteredEvents = computed(() => {
  let result = [...auditEvents.value];

  if (filters.value.deviceId) {
    result = result.filter(event => event.deviceId === filters.value.deviceId);
  }

  if (filters.value.type) {
    result = result.filter(event => event.type === filters.value.type);
  }

  if (filters.value.from) {
    result = result.filter(event => event.timestamp >= filters.value.from);
  }

  if (filters.value.to) {
    result = result.filter(event => event.timestamp <= filters.value.to);
  }

  return result.sort((a, b) => b.timestamp - a.timestamp);
});

const displayEvents = computed(() => {
  const start = (pagination.value.page - 1) * pagination.value.pageSize;
  const end = start + pagination.value.pageSize;
  return filteredEvents.value.slice(start, end);
});

const formatTime = (timestamp: number) => {
  return new Date(timestamp).toLocaleString();
};

const getEventType = (type: string) => {
  switch (type) {
    case 'connect':
      return 'success';
    case 'disconnect':
      return 'info';
    case 'screenshot':
      return 'primary';
    case 'click':
    case 'type':
      return 'warning';
    case 'navigate':
      return 'primary';
    case 'eval':
      return 'danger';
    default:
      return '';
  }
};

const getEventLabel = (type: string) => {
  const labels: Record<string, string> = {
    connect: '连接',
    disconnect: '断开',
    screenshot: '截图',
    click: '点击',
    type: '输入',
    navigate: '导航',
    eval: '执行',
  };
  return labels[type] || type;
};

const handleDateChange = (dates: [Date, Date] | null) => {
  if (dates) {
    filters.value.from = dates[0].getTime();
    filters.value.to = dates[1].getTime();
  } else {
    filters.value.from = 0;
    filters.value.to = 0;
  }
};

const handleFilter = () => {
  pagination.value.page = 1;
  updatePagination();
};

const handleReset = () => {
  filters.value.deviceId = '';
  filters.value.type = '';
  filters.value.from = 0;
  filters.value.to = 0;
  dateRange.value = null;
  pagination.value.page = 1;
  updatePagination();
};

const handleSizeChange = () => {
  updatePagination();
};

const handlePageChange = () => {
  // Pagination is handled by computed
};

const updatePagination = () => {
  pagination.value.total = filteredEvents.value.length;
};

const handleExportJSON = () => {
  const data = filteredEvents.value.map(event => ({
    ...event,
    timestamp: new Date(event.timestamp).toISOString(),
  }));

  const json = JSON.stringify(data, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `audit-log-${Date.now()}.json`;
  link.click();
  URL.revokeObjectURL(url);

  ElMessage.success('导出成功');
};

const handleExportCSV = () => {
  const headers = ['type', 'deviceId', 'operatorId', 'timestamp', 'detail'];
  const rows = filteredEvents.value.map(event => [
    event.type,
    event.deviceId,
    event.operatorId,
    new Date(event.timestamp).toISOString(),
    `"${event.detail.replace(/"/g, '""')}"`,
  ]);

  const csv = [headers.join(','), ...rows.map(row => row.join(','))].join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `audit-log-${Date.now()}.csv`;
  link.click();
  URL.revokeObjectURL(url);

  ElMessage.success('导出成功');
};

const fetchAuditData = async () => {
  try {
    const token = getStoredJwt();
    if (!token) return;
    const params = new URLSearchParams({
      limit: '10000',
    });

    const response = await fetch(`${getApiBase()}/api/audit?${params}`, {
      headers: {
        'Authorization': `Bearer ${token}`,
      },
    });

    if (response.ok) {
      const data = await response.json();
      auditEvents.value = data.events || [];
      updatePagination();
    }
  } catch (error) {
    console.error('Failed to fetch audit data:', error);
  }
};

onMounted(() => {
  fetchAuditData();
});
</script>

<style scoped>
.audit-log {
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

.filters {
  display: flex;
  gap: 8px;
  margin-bottom: 16px;
  flex-wrap: wrap;
}

.audit-table {
  margin-bottom: 16px;
}

.pagination {
  display: flex;
  justify-content: center;
}
</style>
