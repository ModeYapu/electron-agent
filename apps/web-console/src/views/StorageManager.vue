<template>
  <div class="storage-manager">
    <div class="manager-header">
      <h2>Storage 管理器</h2>
      <div class="actions">
        <el-radio-group v-model="storageType" size="small" @change="handleRefresh">
          <el-radio-button label="localStorage" />
          <el-radio-button label="sessionStorage" />
        </el-radio-group>
        <el-button size="small" @click="handleRefresh" :loading="loading">
          <el-icon><Refresh /></el-icon>
          刷新
        </el-button>
        <el-button size="small" type="primary" @click="openAdd" :disabled="!deviceId">
          <el-icon><Plus /></el-icon>
          添加 / 修改
        </el-button>
        <el-button size="small" type="danger" @click="handleClear" :disabled="entries.length === 0">
          <el-icon><Delete /></el-icon>
          清空
        </el-button>
      </div>
    </div>

    <div v-if="!deviceId" class="no-device">
      <el-empty description="请先从设备列表选择一台设备" />
    </div>
    <el-table
      v-else
      :data="entries"
      stripe
      height="calc(100vh - 200px)"
      v-loading="loading"
      class="storage-table"
    >
      <el-table-column prop="key" label="键" width="240" show-overflow-tooltip />
      <el-table-column prop="value" label="值" min-width="300" show-overflow-tooltip />
      <el-table-column label="操作" width="160" fixed="right">
        <template #default="{ row }">
          <el-button size="small" link @click="openEdit(row)">编辑</el-button>
          <el-button size="small" type="danger" link @click="handleDelete(row)">删除</el-button>
        </template>
      </el-table-column>
    </el-table>

    <el-dialog v-model="showDialog" :title="editingKey ? '修改 Storage' : '添加 Storage'" width="520px" :close-on-click-modal="false">
      <el-form ref="formRef" :model="form" :rules="rules" label-width="80px">
        <el-form-item label="键" prop="key">
          <el-input v-model="form.key" :disabled="!!editingKey" placeholder="storage key" />
        </el-form-item>
        <el-form-item label="值" prop="value">
          <el-input v-model="form.value" type="textarea" :rows="3" placeholder="storage value" />
        </el-form-item>
        <el-form-item label="类型">
          <el-tag>{{ storageType }}</el-tag>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="showDialog = false">取消</el-button>
        <el-button type="primary" @click="handleSave" :loading="submitting">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue';
import { ElMessage, ElMessageBox, type FormInstance, type FormRules } from 'element-plus';
import { Refresh, Plus, Delete } from '@element-plus/icons-vue';
import { useWebSocketStore } from '@/stores/websocket';
import type { StorageEntry } from '@electron-agent/shared';

interface Props {
  deviceId?: string;
}
const props = defineProps<Props>();

const wsStore = useWebSocketStore();

const deviceId = computed(() => props.deviceId || wsStore.currentDevice?.info.deviceId || '');
// Only show entries matching the currently selected storage type.
const entries = computed<StorageEntry[]>(() =>
  wsStore.storage.filter(e => e.storageType === storageType.value)
);

const storageType = ref<'localStorage' | 'sessionStorage'>('localStorage');
const loading = ref(false);
const submitting = ref(false);
const showDialog = ref(false);
const editingKey = ref('');
const formRef = ref<FormInstance>();

const form = ref({ key: '', value: '' });
const rules: FormRules = {
  key: [{ required: true, message: '请输入键', trigger: 'blur' }],
  value: [{ required: true, message: '请输入值', trigger: 'blur' }],
};

const ensureDeviceSelected = (): boolean => {
  if (!deviceId.value) return false;
  if (wsStore.currentDevice?.info.deviceId !== deviceId.value) {
    const target = wsStore.devices.find(d => d.info.deviceId === deviceId.value);
    if (target) wsStore.selectDevice(target);
  }
  return true;
};

const handleRefresh = async () => {
  if (!ensureDeviceSelected()) {
    ElMessage.warning('未选择设备');
    return;
  }
  loading.value = true;
  try {
    await wsStore.getStorage(storageType.value);
  } catch (error) {
    ElMessage.error(`获取 Storage 失败: ${error}`);
  } finally {
    loading.value = false;
  }
};

const openAdd = () => {
  editingKey.value = '';
  form.value = { key: '', value: '' };
  showDialog.value = true;
};

const openEdit = (row: StorageEntry) => {
  editingKey.value = row.key;
  form.value = { key: row.key, value: row.value };
  showDialog.value = true;
};

const handleSave = async () => {
  if (!formRef.value) return;
  await formRef.value.validate(async (valid) => {
    if (!valid) return;
    if (!ensureDeviceSelected()) {
      ElMessage.warning('未选择设备');
      return;
    }
    submitting.value = true;
    try {
      await wsStore.setStorage(form.value.key, form.value.value, storageType.value);
      ElMessage.success(editingKey.value ? '已修改' : '已添加');
      showDialog.value = false;
    } catch (error) {
      ElMessage.error(`保存失败: ${error}`);
    } finally {
      submitting.value = false;
    }
  });
};

const handleDelete = async (row: StorageEntry) => {
  if (!ensureDeviceSelected()) return;
  try {
    await ElMessageBox.confirm(`确定要删除 "${row.key}" 吗？`, '确认删除', {
      confirmButtonText: '删除', cancelButtonText: '取消', type: 'warning',
    });
    // No dedicated delete command — overwrite with empty then clear-empty entries.
    await wsStore.setStorage(row.key, '', storageType.value);
    await wsStore.getStorage(storageType.value);
    ElMessage.success(`已删除: ${row.key}`);
  } catch (error) {
    if (error !== 'cancel' && error !== undefined) ElMessage.error(`删除失败: ${error}`);
  }
};

const handleClear = async () => {
  if (!ensureDeviceSelected() || entries.value.length === 0) return;
  try {
    await ElMessageBox.confirm(`确定要清空 ${storageType.value} 吗？此操作不可撤销。`, '确认清空', {
      confirmButtonText: '清空', cancelButtonText: '取消', type: 'warning',
    });
    await wsStore.clearStorage(storageType.value);
    ElMessage.success(`已清空 ${storageType.value}`);
  } catch (error) {
    if (error !== 'cancel' && error !== undefined) ElMessage.error(`清空失败: ${error}`);
  }
};

const load = async () => {
  if (ensureDeviceSelected()) await handleRefresh();
};

onMounted(() => {
  load();
});

watch(
  () => [props.deviceId, wsStore.devices.length],
  () => {
    if (deviceId.value && wsStore.currentDevice?.info.deviceId !== deviceId.value) load();
  }
);
</script>

<style scoped>
.storage-manager {
  padding: 20px;
  height: 100%;
  display: flex;
  flex-direction: column;
}

.manager-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 20px;
  gap: 16px;
}

.manager-header h2 {
  margin: 0;
  color: #303133;
  white-space: nowrap;
}

.actions {
  display: flex;
  gap: 12px;
  align-items: center;
}

.storage-table {
  flex: 1;
}

.no-device {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
}
</style>
