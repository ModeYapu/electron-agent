<template>
  <div class="network-panel">
    <div class="panel-header">
      <div class="filters">
        <el-select v-model="filters.status" placeholder="状态码" clearable size="small" style="width: 120px">
          <el-option label="2xx" value="2" />
          <el-option label="3xx" value="3" />
          <el-option label="4xx" value="4" />
          <el-option label="5xx" value="5" />
        </el-select>
        <el-select v-model="filters.method" placeholder="方法" clearable size="small" style="width: 100px">
          <el-option label="GET" value="GET" />
          <el-option label="POST" value="POST" />
          <el-option label="PUT" value="PUT" />
          <el-option label="DELETE" value="DELETE" />
        </el-select>
        <el-input
          v-model="filters.search"
          placeholder="搜索 URL"
          size="small"
          clearable
          style="width: 200px"
          @keyup.enter="handleSearch"
        />
        <el-button size="small" @click="handleSearch">搜索</el-button>
        <el-button size="small" @click="handleReset">重置</el-button>
      </div>
      <div class="stats">
        <span>总请求数: {{ pagination.total }}</span>
        <span>平均耗时: {{ averageTime }}ms</span>
        <span>失败率: {{ failureRate }}%</span>
      </div>
    </div>

    <el-table
      :data="displayRequests"
      stripe
      height="400"
      @row-click="handleRowClick"
      class="network-table"
    >
      <el-table-column prop="method" label="方法" width="80" />
      <el-table-column prop="url" label="URL" min-width="300" show-overflow-tooltip />
      <el-table-column prop="status" label="状态" width="80">
        <template #default="{ row }">
          <el-tag :type="getStatusType(row.status)" size="small">
            {{ row.status }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column prop="mimeType" label="类型" width="120" show-overflow-tooltip />
      <el-table-column prop="timing" label="耗时" width="80">
        <template #default="{ row }">
          {{ row.timing }}ms
        </template>
      </el-table-column>
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

    <el-drawer v-model="drawerVisible" title="请求详情" size="50%">
      <div v-if="selectedRequest" class="request-detail">
        <el-descriptions :column="1" border>
          <el-descriptions-item label="方法">
            {{ selectedRequest.method }}
          </el-descriptions-item>
          <el-descriptions-item label="URL">
            {{ selectedRequest.url }}
          </el-descriptions-item>
          <el-descriptions-item label="状态码">
            <el-tag :type="getStatusType(selectedRequest.status)">
              {{ selectedRequest.status }}
            </el-tag>
          </el-descriptions-item>
          <el-descriptions-item label="MIME 类型">
            {{ selectedRequest.mimeType }}
          </el-descriptions-item>
          <el-descriptions-item label="耗时">
            {{ selectedRequest.timing }}ms
          </el-descriptions-item>
          <el-descriptions-item label="时间戳">
            {{ formatTime(selectedRequest.timestamp) }}
          </el-descriptions-item>
        </el-descriptions>

        <el-divider>Request Headers</el-divider>
        <pre class="headers-content">{{ formatHeaders(selectedRequest.requestHeaders) }}</pre>

        <el-divider>Response Headers</el-divider>
        <pre class="headers-content">{{ formatHeaders(selectedRequest.responseHeaders) }}</pre>

        <el-divider v-if="selectedRequest.requestBody">Request Body</el-divider>
        <div v-if="selectedRequest.requestBody" class="body-content">
          <pre>{{ selectedRequest.requestBody }}</pre>
        </div>

        <el-divider v-if="selectedRequest.responseBody">Response Body</el-divider>
        <div v-if="selectedRequest.responseBody" class="body-content">
          <pre>{{ selectedRequest.responseBody }}</pre>
        </div>
      </div>
    </el-drawer>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import type { NetworkRequest } from '@electron-agent/shared';

interface Props {
  deviceId: string;
  requests?: NetworkRequest[];
}

const props = withDefaults(defineProps<Props>(), {
  requests: () => [],
});

const filters = ref({
  status: '',
  method: '',
  search: '',
});

const pagination = ref({
  page: 1,
  pageSize: 50,
  total: 0,
});

const drawerVisible = ref(false);
const selectedRequest = ref<NetworkRequest | null>(null);

const filteredRequests = computed(() => {
  let result = [...props.requests];

  if (filters.value.status) {
    result = result.filter(req => req.status.toString().startsWith(filters.value.status));
  }

  if (filters.value.method) {
    result = result.filter(req => req.method === filters.value.method);
  }

  if (filters.value.search) {
    result = result.filter(req =>
      req.url.toLowerCase().includes(filters.value.search.toLowerCase())
    );
  }

  return result;
});

const displayRequests = computed(() => {
  const start = (pagination.value.page - 1) * pagination.value.pageSize;
  const end = start + pagination.value.pageSize;
  return filteredRequests.value.slice(start, end);
});

const averageTime = computed(() => {
  if (filteredRequests.value.length === 0) return 0;
  const total = filteredRequests.value.reduce((sum, req) => sum + req.timing, 0);
  return Math.round(total / filteredRequests.value.length);
});

const failureRate = computed(() => {
  if (filteredRequests.value.length === 0) return 0;
  const failures = filteredRequests.value.filter(req => req.status >= 400).length;
  return Math.round((failures / filteredRequests.value.length) * 100);
});

const getStatusType = (status: number) => {
  if (status >= 200 && status < 300) return 'success';
  if (status >= 300 && status < 400) return 'info';
  if (status >= 400 && status < 500) return 'warning';
  if (status >= 500) return 'danger';
  return '';
};

const formatTime = (timestamp: number) => {
  return new Date(timestamp).toLocaleString();
};

const formatHeaders = (headers: Record<string, string> | undefined) => {
  if (!headers) return 'N/A';
  return Object.entries(headers)
    .map(([key, value]) => `${key}: ${value}`)
    .join('\n');
};

const handleSearch = () => {
  pagination.value.page = 1;
  updatePagination();
};

const handleReset = () => {
  filters.value.status = '';
  filters.value.method = '';
  filters.value.search = '';
  pagination.value.page = 1;
  updatePagination();
};

const handleSizeChange = () => {
  updatePagination();
};

const handlePageChange = () => {
  // Pagination is handled by computed
};

const handleRowClick = (row: NetworkRequest) => {
  selectedRequest.value = row;
  drawerVisible.value = true;
};

const updatePagination = () => {
  pagination.value.total = filteredRequests.value.length;
};

onMounted(() => {
  updatePagination();
});
</script>

<style scoped>
.network-panel {
  height: 100%;
  display: flex;
  flex-direction: column;
}

.panel-header {
  margin-bottom: 16px;
}

.filters {
  display: flex;
  gap: 8px;
  margin-bottom: 12px;
}

.stats {
  display: flex;
  gap: 16px;
  font-size: 14px;
  color: #606266;
}

.network-table {
  flex: 1;
}

.pagination {
  margin-top: 16px;
  display: flex;
  justify-content: center;
}

.request-detail {
  padding: 0 16px;
}

.headers-content,
.body-content {
  background: #f5f7fa;
  padding: 12px;
  border-radius: 4px;
  font-size: 12px;
  max-height: 300px;
  overflow: auto;
}

.body-content {
  max-height: 400px;
}
</style>
