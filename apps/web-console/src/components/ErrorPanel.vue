<template>
  <div class="error-panel">
    <div class="panel-header">
      <div class="filters">
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
        <el-input
          v-model="filters.search"
          placeholder="搜索错误"
          size="small"
          clearable
          style="width: 200px"
          @keyup.enter="handleSearch"
        />
        <el-button size="small" @click="handleSearch">搜索</el-button>
        <el-button size="small" @click="handleReset">重置</el-button>
        <el-button size="small" type="primary" @click="handleExport">导出</el-button>
      </div>
      <div class="stats">
        <span>错误数量: {{ pagination.total }}</span>
        <el-select v-model="groupBy" placeholder="分组" size="small" style="width: 120px">
          <el-option label="按类型" value="type" />
          <el-option label="按消息" value="message" />
        </el-select>
      </div>
    </div>

    <el-table
      :data="displayErrors"
      stripe
      height="400"
      class="error-table"
    >
      <el-table-column type="expand">
        <template #default="{ row }">
          <div class="error-stack">
            <div class="stack-header">堆栈追踪:</div>
            <pre class="stack-content">{{ row.stack || 'No stack trace available' }}</pre>
          </div>
        </template>
      </el-table-column>
      <el-table-column prop="message" label="错误信息" min-width="300" show-overflow-tooltip />
      <el-table-column prop="url" label="URL" width="200" show-overflow-tooltip />
      <el-table-column prop="line" label="行号" width="80" />
      <el-table-column prop="col" label="列号" width="80" />
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
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import type { JSError } from '@electron-agent/shared';
import { ElMessage } from 'element-plus';

interface Props {
  deviceId: string;
  errors?: JSError[];
}

const props = withDefaults(defineProps<Props>(), {
  errors: () => [],
});

const dateRange = ref<[Date, Date] | null>(null);
const filters = ref({
  search: '',
  from: 0,
  to: 0,
});

const pagination = ref({
  page: 1,
  pageSize: 50,
  total: 0,
});

const groupBy = ref('type');

const filteredErrors = computed(() => {
  let result = [...props.errors];

  if (filters.value.search) {
    const searchLower = filters.value.search.toLowerCase();
    result = result.filter(err =>
      err.message.toLowerCase().includes(searchLower) ||
      (err.stack && err.stack.toLowerCase().includes(searchLower))
    );
  }

  if (filters.value.from) {
    result = result.filter(err => err.timestamp >= filters.value.from);
  }

  if (filters.value.to) {
    result = result.filter(err => err.timestamp <= filters.value.to);
  }

  return result;
});

const displayErrors = computed(() => {
  const start = (pagination.value.page - 1) * pagination.value.pageSize;
  const end = start + pagination.value.pageSize;
  return filteredErrors.value.slice(start, end);
});

const errorGroups = computed(() => {
  const groups: Record<string, number> = {};
  filteredErrors.value.forEach(err => {
    let key = 'Unknown';
    if (groupBy.value === 'type') {
      const match = err.message.match(/^[A-Z]\w+/);
      key = match ? match[0] : 'Unknown';
    } else if (groupBy.value === 'message') {
      key = err.message.substring(0, 50);
    }
    groups[key] = (groups[key] || 0) + 1;
  });
  return groups;
});

const formatTime = (timestamp: number) => {
  return new Date(timestamp).toLocaleString();
};

const handleDateChange = (dates: [Date, Date] | null) => {
  if (dates) {
    filters.value.from = dates[0].getTime();
    filters.value.to = dates[1].getTime();
  } else {
    filters.value.from = 0;
    filters.value.to = 0;
  }
  pagination.value.page = 1;
  updatePagination();
};

const handleSearch = () => {
  pagination.value.page = 1;
  updatePagination();
};

const handleReset = () => {
  filters.value.search = '';
  filters.value.from = 0;
  filters.value.to = 0;
  dateRange.value = null;
  pagination.value.page = 1;
  updatePagination();
};

const handleExport = () => {
  const data = filteredErrors.value.map(err => ({
    message: err.message,
    stack: err.stack,
    timestamp: new Date(err.timestamp).toISOString(),
  }));

  const json = JSON.stringify(data, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `errors-${props.deviceId}-${Date.now()}.json`;
  link.click();
  URL.revokeObjectURL(url);

  ElMessage.success('导出成功');
};

const handleSizeChange = () => {
  updatePagination();
};

const handlePageChange = () => {
  // Pagination is handled by computed
};

const updatePagination = () => {
  pagination.value.total = filteredErrors.value.length;
};

onMounted(() => {
  updatePagination();
});
</script>

<style scoped>
.error-panel {
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
  align-items: center;
  font-size: 14px;
  color: #606266;
}

.error-table {
  flex: 1;
}

.error-stack {
  padding: 16px;
  background: #f5f7fa;
}

.stack-header {
  font-weight: 600;
  margin-bottom: 8px;
  color: #303133;
}

.stack-content {
  background: #fff;
  padding: 12px;
  border-radius: 4px;
  font-size: 12px;
  max-height: 300px;
  overflow: auto;
  white-space: pre-wrap;
  word-break: break-word;
}

.pagination {
  margin-top: 16px;
  display: flex;
  justify-content: center;
}
</style>
