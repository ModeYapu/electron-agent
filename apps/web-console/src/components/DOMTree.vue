<template>
  <div class="dom-tree">
    <div class="tree-header">
      <el-input
        v-model="searchQuery"
        placeholder="搜索节点（标签/类/ID）"
        size="small"
        clearable
        @keyup.enter="handleSearch"
      >
        <template #append>
          <el-button @click="handleSearch" icon="Search">搜索</el-button>
        </template>
      </el-input>
      <el-button size="small" @click="handleExpandAll">展开全部</el-button>
      <el-button size="small" @click="handleCollapseAll">折叠全部</el-button>
      <el-button size="small" @click="handleRefresh">刷新</el-button>
    </div>

    <div class="tree-container">
      <el-tree
        ref="treeRef"
        :data="treeData"
        :props="treeProps"
        :load="loadNode"
        :expand-on-click-node="false"
        :highlight-current="true"
        node-key="nodeId"
        lazy
        @node-click="handleNodeClick"
        class="dom-el-tree"
      >
        <template #default="{ node, data }">
          <span class="custom-tree-node">
            <span class="node-label">
              <span class="tag-name">{{ data.nodeName }}</span>
              <span v-if="data.attributes" class="node-attributes">
                <span v-if="data.attributes.id" class="attr-id">#{{ data.attributes.id }}</span>
                <span v-if="data.attributes.class" class="attr-class">.{{ data.attributes.class.split(' ')[0] }}</span>
              </span>
              <span v-if="data.nodeValue" class="node-value">: {{ truncateText(data.nodeValue) }}</span>
            </span>
            <span class="node-actions">
              <el-button size="small" link @click.stop="handleHighlight(data)">
                高亮
              </el-button>
              <el-button size="small" link @click.stop="handleSelect(data)">
                选择
              </el-button>
            </span>
          </span>
        </template>
      </el-tree>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';
import type { DOMNode } from '@electron-agent/shared';

interface Props {
  domData?: DOMNode | null;
}

const props = withDefaults(defineProps<Props>(), {
  domData: null,
});

const emit = defineEmits<{
  (e: 'node-click', node: DOMNode): void;
  (e: 'node-highlight', node: DOMNode): void;
  (e: 'node-select', node: DOMNode): void;
  (e: 'refresh'): void;
}>();

const treeRef = ref();
const searchQuery = ref('');

const treeProps = {
  label: 'nodeName',
  children: 'children',
};

const treeData = computed(() => {
  if (!props.domData) return [];
  return [formatDOMNode(props.domData)];
});

const formatDOMNode = (node: DOMNode): any => {
  return {
    nodeId: node.nodeId,
    nodeType: node.nodeType,
    nodeName: node.nodeName,
    localName: node.localName,
    nodeValue: node.nodeValue,
    attributes: node.attributes,
    children: node.children?.map(child => formatDOMNode(child)),
    original: node,
  };
};

const truncateText = (text: string) => {
  if (!text) return '';
  return text.length > 30 ? text.substring(0, 30) + '...' : text;
};

const loadNode = (node: any, resolve: any) => {
  // Lazy loading of children
  if (node.data.children && node.data.children.length > 0) {
    resolve(node.data.children);
  } else {
    resolve([]);
  }
};

const handleNodeClick = (data: any) => {
  emit('node-click', data.original);
};

const handleHighlight = (data: any) => {
  emit('node-highlight', data.original);
};

const handleSelect = (data: any) => {
  emit('node-select', data.original);
};

const handleExpandAll = () => {
  const nodes = treeRef.value.store.nodesMap;
  Object.values(nodes).forEach((node: any) => {
    node.expanded = true;
  });
};

const handleCollapseAll = () => {
  const nodes = treeRef.value.store.nodesMap;
  Object.values(nodes).forEach((node: any) => {
    node.expanded = false;
  });
};

const handleRefresh = () => {
  emit('refresh');
};

const handleSearch = () => {
  if (!searchQuery.value) return;

  const query = searchQuery.value.toLowerCase();
  const nodes = treeRef.value.store.nodesMap;

  // Collapse all first
  Object.values(nodes).forEach((node: any) => {
    node.expanded = false;
  });

  // Search and expand matching nodes
  Object.values(nodes).forEach((node: any) => {
    const data = node.data;
    const matches =
      data.nodeName?.toLowerCase().includes(query) ||
      data.attributes?.id?.toLowerCase().includes(query) ||
      data.attributes?.class?.toLowerCase().includes(query);

    if (matches) {
      // Expand all parent nodes
      let parent = node.parent;
      while (parent) {
        parent.expanded = true;
        parent = parent.parent;
      }
    }
  });
};

defineExpose({
  expandAll: handleExpandAll,
  collapseAll: handleCollapseAll,
  search: handleSearch,
});
</script>

<style scoped>
.dom-tree {
  height: 100%;
  display: flex;
  flex-direction: column;
}

.tree-header {
  display: flex;
  gap: 8px;
  margin-bottom: 16px;
  align-items: center;
}

.tree-container {
  flex: 1;
  overflow: auto;
  border: 1px solid #dcdfe6;
  border-radius: 4px;
  padding: 8px;
}

.dom-el-tree {
  background: transparent;
}

.custom-tree-node {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  padding-right: 8px;
}

.node-label {
  display: flex;
  align-items: center;
  gap: 4px;
  flex: 1;
}

.tag-name {
  color: #e6a23c;
  font-weight: 600;
}

.node-attributes {
  display: flex;
  gap: 4px;
}

.attr-id {
  color: #409eff;
  font-weight: 500;
}

.attr-class {
  color: #67c23a;
  font-weight: 500;
}

.node-value {
  color: #909399;
  font-size: 12px;
}

.node-actions {
  display: flex;
  gap: 4px;
  opacity: 0;
  transition: opacity 0.2s;
}

.custom-tree-node:hover .node-actions {
  opacity: 1;
}

.el-tree-node__content:hover {
  background-color: #f5f7fa;
}
</style>
