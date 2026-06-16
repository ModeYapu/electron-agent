<template>
  <div class="dom-node-detail">
    <div v-if="node" class="detail-content">
      <el-descriptions :column="1" border class="node-info">
        <el-descriptions-item label="标签名">
          <el-tag type="warning">{{ node.nodeName }}</el-tag>
        </el-descriptions-item>
        <el-descriptions-item label="节点类型">
          {{ getNodeType(node.nodeType) }}
        </el-descriptions-item>
        <el-descriptions-item label="节点 ID">
          {{ node.nodeId }}
        </el-descriptions-item>
        <el-descriptions-item v-if="node.localName" label="本地名称">
          {{ node.localName }}
        </el-descriptions-item>
      </el-descriptions>

      <el-divider v-if="node.attributes && Object.keys(node.attributes).length > 0">
        属性
      </el-divider>
      <el-table
        v-if="node.attributes && Object.keys(node.attributes).length > 0"
        :data="attributeRows"
        size="small"
        max-height="200"
        class="attributes-table"
      >
        <el-table-column prop="key" label="属性名" width="150" />
        <el-table-column prop="value" label="属性值" show-overflow-tooltip />
      </el-table>

      <el-divider v-if="node.nodeValue">内容</el-divider>
      <div v-if="node.nodeValue" class="node-value">
        <pre>{{ node.nodeValue }}</pre>
      </div>

      <el-divider v-if="node.children && node.children.length > 0">
        子节点
      </el-divider>
      <div v-if="node.children && node.children.length > 0" class="node-children">
        <el-tag
          v-for="(child, index) in node.children.slice(0, 10)"
          :key="child.nodeId"
          size="small"
          style="margin: 2px"
        >
          {{ child.nodeName }}{{ index < node.children.length - 1 && index < 9 ? '' : '...' }}
        </el-tag>
        <span v-if="node.children.length > 10" class="more-children">
          等 {{ node.children.length }} 个子节点
        </span>
      </div>

      <el-divider>操作</el-divider>
      <div class="node-actions">
        <el-button size="small" @click="handleCopyPath">复制 XPath</el-button>
        <el-button size="small" @click="handleCopyAttributes">复制属性</el-button>
        <el-button size="small" type="primary" @click="handleHighlight">高亮节点</el-button>
      </div>
    </div>

    <el-empty v-else description="请选择一个节点" />
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';
import type { DOMNode } from '@electron-agent/shared';
import { ElMessage } from 'element-plus';

interface Props {
  node?: DOMNode | null;
}

const props = withDefaults(defineProps<Props>(), {
  node: null,
});

const emit = defineEmits<{
  (e: 'highlight', node: DOMNode): void;
}>();

const attributeRows = computed(() => {
  if (!props.node?.attributes) return [];
  return Object.entries(props.node.attributes).map(([key, value]) => ({ key, value }));
});

const getNodeType = (nodeType: number) => {
  const types: Record<number, string> = {
    1: 'Element',
    3: 'Text',
    8: 'Comment',
    9: 'Document',
    11: 'Document Fragment',
  };
  return types[nodeType] || 'Unknown';
};

const handleCopyPath = () => {
  if (!props.node) return;

  // Generate a simple XPath
  const path = generateXPath(props.node);
  navigator.clipboard.writeText(path).then(() => {
    ElMessage.success('XPath 复制成功');
  });
};

const handleCopyAttributes = () => {
  if (!props.node?.attributes) return;

  const text = Object.entries(props.node.attributes)
    .map(([key, value]) => `${key}="${value}"`)
    .join(' ');
  navigator.clipboard.writeText(text).then(() => {
    ElMessage.success('属性复制成功');
  });
};

const handleHighlight = () => {
  if (props.node) {
    emit('highlight', props.node);
  }
};

const generateXPath = (node: DOMNode, path = ''): string => {
  const tagName = node.nodeName.toLowerCase();
  const idAttr = node.attributes?.id ? `#${node.attributes.id}` : '';
  const classAttr = node.attributes?.class ? `.${node.attributes.class.split(' ')[0]}` : '';
  return `${path}${tagName}${idAttr}${classAttr}`;
};
</script>

<style scoped>
.dom-node-detail {
  height: 100%;
  display: flex;
  flex-direction: column;
}

.detail-content {
  flex: 1;
  overflow: auto;
}

.node-info {
  margin-bottom: 16px;
}

.attributes-table {
  margin-bottom: 16px;
}

.node-value {
  background: #f5f7fa;
  padding: 12px;
  border-radius: 4px;
  margin-bottom: 16px;
}

.node-value pre {
  margin: 0;
  white-space: pre-wrap;
  word-break: break-word;
  font-size: 12px;
}

.node-children {
  margin-bottom: 16px;
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

.more-children {
  color: #909399;
  font-size: 12px;
  margin-left: 4px;
}

.node-actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.el-divider {
  margin: 16px 0;
}
</style>
