<template>
  <div class="navigation-timeline">
    <div class="timeline-header">
      <h3>页面导航历史</h3>
      <el-button size="small" @click="handleClear">清空</el-button>
    </div>

    <div class="timeline-container">
      <el-timeline v-if="navigationEvents.length > 0">
        <el-timeline-item
          v-for="(event, index) in navigationEvents"
          :key="index"
          :timestamp="formatTime(event.timestamp)"
          :color="getEventColor(event.type)"
          placement="top"
        >
          <div class="timeline-item">
            <div class="event-header">
              <el-tag :type="getEventType(event.type)" size="small">
                {{ getEventLabel(event.type) }}
              </el-tag>
              <span v-if="event.loadTime" class="load-time">
                加载耗时: {{ event.loadTime }}ms
              </span>
            </div>
            <div class="event-url">
              <el-link :href="event.url" target="_blank" type="primary">
                {{ event.url }}
              </el-link>
            </div>
            <div v-if="event.title" class="event-title">
              {{ event.title }}
            </div>
            <div class="event-actions">
              <el-button size="small" link @click="handleNavigate(event)">
                跳转
              </el-button>
              <el-button size="small" link @click="handleCopy(event)">
                复制
              </el-button>
            </div>
          </div>
        </el-timeline-item>
      </el-timeline>

      <el-empty v-else description="暂无导航记录" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';
import { ElMessage } from 'element-plus';

interface NavigationEvent {
  url: string;
  title?: string;
  timestamp: number;
  loadTime?: number;
  type?: 'navigate' | 'load' | 'error';
}

interface Props {
  events?: NavigationEvent[];
}

const props = withDefaults(defineProps<Props>(), {
  events: () => [],
});

const emit = defineEmits<{
  (e: 'navigate', event: NavigationEvent): void;
  (e: 'clear'): void;
}>();

const navigationEvents = computed(() => {
  return [...props.events].sort((a, b) => b.timestamp - a.timestamp);
});

const formatTime = (timestamp: number) => {
  return new Date(timestamp).toLocaleString();
};

const getEventColor = (type?: string) => {
  switch (type) {
    case 'navigate':
      return '#409eff';
    case 'load':
      return '#67c23a';
    case 'error':
      return '#f56c6c';
    default:
      return '#909399';
  }
};

const getEventType = (type?: string) => {
  switch (type) {
    case 'navigate':
      return 'primary';
    case 'load':
      return 'success';
    case 'error':
      return 'danger';
    default:
      return 'info';
  }
};

const getEventLabel = (type?: string) => {
  switch (type) {
    case 'navigate':
      return '导航';
    case 'load':
      return '加载完成';
    case 'error':
      return '加载失败';
    default:
      return '未知';
  }
};

const handleNavigate = (event: NavigationEvent) => {
  emit('navigate', event);
};

const handleCopy = (event: NavigationEvent) => {
  const text = `${event.url}\n${event.title || ''}\n${formatTime(event.timestamp)}`;
  navigator.clipboard.writeText(text).then(() => {
    ElMessage.success('复制成功');
  });
};

const handleClear = () => {
  emit('clear');
};
</script>

<style scoped>
.navigation-timeline {
  height: 100%;
  display: flex;
  flex-direction: column;
}

.timeline-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 16px;
}

.timeline-header h3 {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
}

.timeline-container {
  flex: 1;
  overflow: auto;
  padding: 16px;
  background: #f5f7fa;
  border-radius: 4px;
}

.timeline-item {
  padding: 8px;
  background: #fff;
  border-radius: 4px;
  margin-bottom: 8px;
}

.event-header {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 8px;
}

.load-time {
  color: #67c23a;
  font-size: 12px;
  font-weight: 500;
}

.event-url {
  margin-bottom: 4px;
  word-break: break-word;
}

.event-title {
  color: #606266;
  font-size: 12px;
  margin-bottom: 8px;
}

.event-actions {
  display: flex;
  gap: 8px;
}

.el-timeline-item {
  padding-bottom: 16px;
}
</style>
