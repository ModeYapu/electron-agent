<template>
  <div class="dom-inspector">
    <el-card>
      <template #header>
        <div class="card-header">
          <h2>DOM 检查器</h2>
          <div class="device-selector">
            <el-select v-model="selectedDeviceId" placeholder="选择设备" size="small" @change="onDeviceChange">
              <el-option
                v-for="device in devices"
                :key="device.info.deviceId"
                :label="device.info.name"
                :value="device.info.deviceId"
              />
            </el-select>
            <el-button
              size="small"
              type="primary"
              :loading="loading"
              :disabled="!selectedDeviceId"
              @click="fetchDOM"
            >
              获取 DOM
            </el-button>
          </div>
        </div>
      </template>

      <div v-if="selectedDeviceId" class="inspector-content">
        <div class="inspector-layout">
          <div class="tree-panel">
            <DOMTree
              ref="treeRef"
              :dom-data="domData"
              @node-click="handleNodeClick"
              @node-highlight="handleNodeHighlight"
              @refresh="fetchDOM"
            />
          </div>
          <div class="detail-panel">
            <DOMNodeDetail
              :node="selectedNode"
              @highlight="handleNodeHighlight"
            />
          </div>
        </div>
      </div>

      <el-empty v-else description="请选择一个设备" />
    </el-card>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue';
import { useWebSocketStore } from '@/stores/websocket';
import DOMTree from '@/components/DOMTree.vue';
import DOMNodeDetail from '@/components/DOMNodeDetail.vue';
import type { DOMNode } from '@electron-agent/shared';
import { ElMessage } from 'element-plus';

interface Props {
  deviceId?: string;
}
const props = defineProps<Props>();

const wsStore = useWebSocketStore();

const devices = computed(() => wsStore.devices);
const selectedDeviceId = ref('');
// Mirror the store's shared DOM snapshot so it survives device re-selection
// within the same view lifecycle.
const domData = ref<DOMNode | null>(null);
const selectedNode = ref<DOMNode | null>(null);
const loading = ref(false);
const treeRef = ref();

const onDeviceChange = () => {
  domData.value = null;
  selectedNode.value = null;
  if (!selectedDeviceId.value) return;
  const target = wsStore.devices.find(d => d.info.deviceId === selectedDeviceId.value);
  if (target) wsStore.selectDevice(target);
};

const fetchDOM = async () => {
  if (!selectedDeviceId.value) return;

  // Ensure the store's currentDevice matches what's selected here.
  if (wsStore.currentDevice?.info.deviceId !== selectedDeviceId.value) {
    const target = wsStore.devices.find(d => d.info.deviceId === selectedDeviceId.value);
    if (target) wsStore.selectDevice(target);
  }

  loading.value = true;
  try {
    // Full chain: cmd:getDOM → relay → agent executor → server:result → here.
    const dom = await wsStore.getDOM();
    if (dom) {
      domData.value = dom;
      selectedNode.value = null;
      ElMessage.success('DOM 获取成功');
    } else {
      ElMessage.warning('DOM 为空');
    }
  } catch (error) {
    console.error('Failed to fetch DOM:', error);
    ElMessage.error(`获取 DOM 失败: ${error}`);
  } finally {
    loading.value = false;
  }
};

const handleNodeClick = (node: DOMNode) => {
  selectedNode.value = node;
};

const handleNodeHighlight = async (node: DOMNode) => {
  if (!wsStore.currentDevice) return;
  try {
    // Highlight via a CSS selector built from the node's id/class attributes.
    const selectorParts: string[] = [];
    if (node.attributes?.id) selectorParts.push(`#${node.attributes.id}`);
    if (node.attributes?.class) {
      node.attributes.class.split(/\s+/).filter(Boolean).forEach(c => selectorParts.push(`.${c}`));
    }
    const selector = selectorParts.length > 0 ? selectorParts.join('') : node.nodeName;
    await wsStore.send({
      type: 'cmd:eval',
      requestId: `dom-hl_${Date.now()}`,
      code: `(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (el) { const old = el.style.outline; el.style.outline = '2px solid red'; setTimeout(() => { el.style.outline = old; }, 3000); } })();`,
    });
    ElMessage.success('节点已高亮');
  } catch (error) {
    console.error('Failed to highlight node:', error);
    ElMessage.error(`高亮失败: ${error}`);
  }
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
.dom-inspector {
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

.device-selector {
  display: flex;
  gap: 8px;
}

.inspector-content {
  min-height: 600px;
}

.inspector-layout {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
  height: 600px;
}

.tree-panel,
.detail-panel {
  border: 1px solid #dcdfe6;
  border-radius: 4px;
  padding: 8px;
  overflow: auto;
}
</style>
