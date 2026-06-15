<template>
  <div class="console-panel">
    <div class="panel-header">
      <div class="filters">
        <el-select
          v-model="filters.level"
          placeholder="日志级别"
          clearable
          size="small"
          multiple
          collapse-tags
          style="width: 200px"
        >
          <el-option label="Log" value="log" />
          <el-option label="Info" value="info" />
          <el-option label="Warn" value="warn" />
          <el-option label="Error" value="error" />
          <el-option label="Debug" value="debug" />
        </el-select>
        <el-input
          v-model="filters.search"
          placeholder="搜索日志"
          size="small"
          clearable
          style="width: 200px"
          @keyup.enter="handleSearch"
        />
        <el-button size="small" @click="handleSearch">搜索</el-button>
        <el-button size="small" @click="handleReset">重置</el-button>
        <el-button size="small" @click="handleClear">清空</el-button>
        <el-switch v-model="autoScroll" active-text="自动滚动" size="small" />
      </div>
      <div class="stats">
        <span>日志数量: {{ pagination.total }}</span>
      </div>
    </div>

    <el-table
      ref="tableRef"
      :data="displayLogs"
      stripe
      height="400"
      @row-click="handleRowClick"
      class="console-table"
    >
      <el-table-column prop="level" label="级别" width="80">
        <template #default="{ row }">
          <el-tag :type="getLevelType(row.level)" size="small">
            {{ row.level.toUpperCase() }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column prop="args" label="消息" min-width="400">
        <template #default="{ row }">
          <span :class="`log-${row.level}`">{{ formatArgs(row.args) }}</span>
        </template>
      </el-table-column>
      <el-table-column prop="timestamp" label="时间" width="160">
        <template #default="{ row }">
          {{ formatTime(row.timestamp) }}
        </template>
      </el-table-column>
      <el-table-column label="操作" width="80">
        <template #default="{ row }">
          <el-button
            size="small"
            link
            @click.stop="handleCopy(row)"
          >
            复制
          </el-button>
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

    <el-drawer v-model="drawerVisible" title="日志详情" size="40%">
      <div v-if="selectedLog" class="log-detail">
        <el-descriptions :column="1" border>
          <el-descriptions-item label="级别">
            <el-tag :type="getLevelType(selectedLog.level)">
              {{ selectedLog.level.toUpperCase() }}
            </el-tag>
          </el-descriptions-item>
          <el-descriptions-item label="时间">
            {{ formatTime(selectedLog.timestamp) }}
          </el-descriptions-item>
        </el-descriptions>

        <el-divider>消息内容</el-divider>
        <div class="log-content">
          <pre>{{ formatArgs(selectedLog.args, true) }}</pre>
        </div>
      </div>
    </el-drawer>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, nextTick, onMounted } from 'vue';
import type { ConsoleLog } from '@electron-agent/shared';
import { ElMessage } from 'element-plus';

interface Props {
  deviceId: string;
  logs?: ConsoleLog[];
}

const props = withDefaults(defineProps<Props>(), {
  logs: () => [],
});

const tableRef = ref();
const filters = ref({
  level: [] as string[],
  search: '',
});

const pagination = ref({
  page: 1,
  pageSize: 50,
  total: 0,
});

const drawerVisible = ref(false);
const selectedLog = ref<ConsoleLog | null>(null);
const autoScroll = ref(true);

const filteredLogs = computed(() => {
  let result = [...props.logs];

  if (filters.value.level.length > 0) {
    result = result.filter(log => filters.value.level.includes(log.level));
  }

  if (filters.value.search) {
    const searchLower = filters.value.search.toLowerCase();
    result = result.filter(log =>
      log.args.some(arg => arg.toLowerCase().includes(searchLower))
    );
  }

  return result;
});

const displayLogs = computed(() => {
  const start = (pagination.value.page - 1) * pagination.value.pageSize;
  const end = start + pagination.value.pageSize;
  return filteredLogs.value.slice(start, end);
});

const getLevelType = (level: ConsoleLog['level']) => {
  switch (level) {
    case 'log': return '';
    case 'info': return 'primary';
    case 'warn': return 'warning';
    case 'error': return 'danger';
    case 'debug': return 'success';
    default: return '';
  }
};

const formatTime = (timestamp: number) => {
  return new Date(timestamp).toLocaleString();
};

const formatArgs = (args: string[], pretty = false) => {
  if (pretty) {
    return args.map(arg => {
      try {
        const parsed = JSON.parse(arg);
        return JSON.stringify(parsed, null, 2);
      } catch {
        return arg;
      }
    }).join('\n');
  }
  return args.join(' ');
};

const handleSearch = () => {
  pagination.value.page = 1;
  updatePagination();
};

const handleReset = () => {
  filters.value.level = [];
  filters.value.search = '';
  pagination.value.page = 1;
  updatePagination();
};

const handleClear = () => {
  // This would emit an event to clear logs
  console.log('Clear logs');
};

const handleSizeChange = () => {
  updatePagination();
};

const handlePageChange = () => {
  // Pagination is handled by computed
};

const handleRowClick = (row: ConsoleLog) => {
  selectedLog.value = row;
  drawerVisible.value = true;
};

const handleCopy = (row: ConsoleLog) => {
  const text = formatArgs(row.args, true);
  navigator.clipboard.writeText(text).then(() => {
    ElMessage.success('复制成功');
  });
};

const updatePagination = () => {
  pagination.value.total = filteredLogs.value.length;
};

const scrollToBottom = () => {
  if (autoScroll.value && tableRef.value) {
    nextTick(() => {
      const table = tableRef.value.$el;
      const scrollBody = table.querySelector('.el-table__body-wrapper');
      if (scrollBody) {
        scrollBody.scrollTop = scrollBody.scrollHeight;
      }
    });
  }
};

// Watch for new logs and auto-scroll
watch(() => props.logs.length, () => {
  if (autoScroll.value) {
    scrollToBottom();
  }
});

onMounted(() => {
  updatePagination();
});
</script>

<style scoped>
.console-panel {
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
  align-items: center;
  margin-bottom: 12px;
}

.stats {
  display: flex;
  gap: 16px;
  font-size: 14px;
  color: #606266;
}

.console-table {
  flex: 1;
}

.log-log {
  color: #606266;
}

.log-info {
  color: #409eff;
}

.log-warn {
  color: #e6a23c;
}

.log-error {
  color: #f56c6c;
}

.log-debug {
  color: #67c23a;
}

.pagination {
  margin-top: 16px;
  display: flex;
  justify-content: center;
}

.log-detail {
  padding: 0 16px;
}

.log-content {
  background: #f5f7fa;
  padding: 12px;
  border-radius: 4px;
  font-size: 12px;
  max-height: 400px;
  overflow: auto;
}

.log-content pre {
  margin: 0;
  white-space: pre-wrap;
  word-break: break-word;
}
</style>
