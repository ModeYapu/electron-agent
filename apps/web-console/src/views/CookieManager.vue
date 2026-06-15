<template>
  <div class="cookie-manager">
    <div class="manager-header">
      <h2>Cookie 管理器</h2>
      <div class="actions">
        <el-button size="small" @click="handleRefresh" :loading="loading">
          <el-icon><Refresh /></el-icon>
          刷新
        </el-button>
        <el-button size="small" type="primary" @click="showAddDialog = true" :disabled="!deviceId">
          <el-icon><Plus /></el-icon>
          添加 Cookie
        </el-button>
        <el-button size="small" type="danger" @click="handleClearAll" :disabled="cookies.length === 0">
          <el-icon><Delete /></el-icon>
          清空全部
        </el-button>
      </div>
    </div>

    <div v-if="!deviceId" class="no-device">
      <el-empty description="请先从设备列表选择一台设备" />
    </div>
    <el-table
      v-else
      :data="cookies"
      stripe
      height="calc(100vh - 200px)"
      v-loading="loading"
      class="cookie-table"
    >
      <el-table-column prop="name" label="名称" width="150" />
      <el-table-column prop="value" label="值" min-width="200" show-overflow-tooltip />
      <el-table-column prop="domain" label="域名" width="150" />
      <el-table-column prop="path" label="路径" width="100" />
      <el-table-column prop="expires" label="过期时间" width="160">
        <template #default="{ row }">
          {{ row.expires ? formatExpires(row.expires) : '会话 Cookie' }}
        </template>
      </el-table-column>
      <el-table-column prop="httpOnly" label="HttpOnly" width="80">
        <template #default="{ row }">
          <el-tag :type="row.httpOnly ? 'success' : 'info'" size="small">
            {{ row.httpOnly ? '是' : '否' }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column prop="secure" label="Secure" width="80">
        <template #default="{ row }">
          <el-tag :type="row.secure ? 'success' : 'info'" size="small">
            {{ row.secure ? '是' : '否' }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column prop="sameSite" label="SameSite" width="100" />
      <el-table-column label="操作" width="100" fixed="right">
        <template #default="{ row }">
          <el-button
            size="small"
            type="danger"
            link
            @click="handleDelete(row)"
          >
            删除
          </el-button>
        </template>
      </el-table-column>
    </el-table>

    <!-- 添加 Cookie 对话框 -->
    <el-dialog
      v-model="showAddDialog"
      title="添加 Cookie"
      width="600px"
      :close-on-click-modal="false"
    >
      <el-form
        ref="formRef"
        :model="cookieForm"
        :rules="formRules"
        label-width="120px"
      >
        <el-form-item label="名称" prop="name">
          <el-input v-model="cookieForm.name" placeholder="Cookie 名称" />
        </el-form-item>
        <el-form-item label="值" prop="value">
          <el-input v-model="cookieForm.value" placeholder="Cookie 值" />
        </el-form-item>
        <el-form-item label="域名" prop="domain">
          <el-input v-model="cookieForm.domain" placeholder=".example.com" />
        </el-form-item>
        <el-form-item label="路径" prop="path">
          <el-input v-model="cookieForm.path" placeholder="/" />
        </el-form-item>
        <el-form-item label="过期时间" prop="expires">
          <el-date-picker
            v-model="cookieForm.expires"
            type="datetime"
            placeholder="选择过期时间"
            format="YYYY-MM-DD HH:mm:ss"
            value-format="YYYY-MM-DD HH:mm:ss"
          />
        </el-form-item>
        <el-form-item label="HttpOnly">
          <el-switch v-model="cookieForm.httpOnly" />
        </el-form-item>
        <el-form-item label="Secure">
          <el-switch v-model="cookieForm.secure" />
        </el-form-item>
        <el-form-item label="SameSite">
          <el-select v-model="cookieForm.sameSite" placeholder="选择 SameSite 策略">
            <el-option label="Strict" value="Strict" />
            <el-option label="Lax" value="Lax" />
            <el-option label="None" value="None" />
          </el-select>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="showAddDialog = false">取消</el-button>
        <el-button type="primary" @click="handleAddCookie" :loading="submitting">
          添加
        </el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue';
import { ElMessage, ElMessageBox, type FormInstance, type FormRules } from 'element-plus';
import { Refresh, Plus, Delete } from '@element-plus/icons-vue';
import { useWebSocketStore } from '@/stores/websocket';
import type { Cookie, CookieParam } from '@electron-agent/shared';

interface Props {
  deviceId?: string;
}
const props = defineProps<Props>();

const wsStore = useWebSocketStore();

// Bind to the store so cookies reflect the live, shared state.
const cookies = computed<Cookie[]>(() => wsStore.cookies);
const deviceId = computed(() => {
  if (props.deviceId) return props.deviceId;
  return wsStore.currentDevice?.info.deviceId ?? '';
});

const loading = ref(false);
const submitting = ref(false);
const showAddDialog = ref(false);
const formRef = ref<FormInstance>();

const cookieForm = ref({
  name: '',
  value: '',
  domain: '',
  path: '/',
  expires: '',
  httpOnly: false,
  secure: false,
  sameSite: 'Lax' as 'Strict' | 'Lax' | 'None' | '',
});

const formRules: FormRules = {
  name: [{ required: true, message: '请输入 Cookie 名称', trigger: 'blur' }],
  value: [{ required: true, message: '请输入 Cookie 值', trigger: 'blur' }],
};

const formatExpires = (timestamp: number) => {
  // CDP/Electron expirationDate is seconds since epoch; our type stores ms.
  return new Date(timestamp).toLocaleString();
};

// Select the route/target device so store helpers target the right agent.
const ensureDeviceSelected = () => {
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
    await wsStore.getCookies();
    ElMessage.success(`已获取 ${cookies.value.length} 条 Cookie`);
  } catch (error) {
    ElMessage.error(`获取 Cookies 失败: ${error}`);
  } finally {
    loading.value = false;
  }
};

const handleAddCookie = async () => {
  if (!formRef.value) return;
  await formRef.value.validate(async (valid) => {
    if (!valid) return;
    if (!ensureDeviceSelected()) {
      ElMessage.warning('未选择设备');
      return;
    }
    submitting.value = true;
    try {
      const param: CookieParam = {
        name: cookieForm.value.name,
        value: cookieForm.value.value,
        domain: cookieForm.value.domain || undefined,
        path: cookieForm.value.path || undefined,
        expires: cookieForm.value.expires
          ? new Date(cookieForm.value.expires).getTime()
          : undefined,
        httpOnly: cookieForm.value.httpOnly,
        secure: cookieForm.value.secure,
        sameSite: cookieForm.value.sameSite || undefined,
      };
      await wsStore.setCookie(param);
      ElMessage.success('Cookie 已添加');
      showAddDialog.value = false;
      resetForm();
    } catch (error) {
      ElMessage.error(`添加 Cookie 失败: ${error}`);
    } finally {
      submitting.value = false;
    }
  });
};

const handleDelete = async (cookie: Cookie) => {
  if (!ensureDeviceSelected()) return;
  try {
    await ElMessageBox.confirm(
      `确定要删除 Cookie "${cookie.name}" 吗？`,
      '确认删除',
      { confirmButtonText: '删除', cancelButtonText: '取消', type: 'warning' }
    );
    await wsStore.deleteCookie(cookie.name);
    ElMessage.success(`已删除 Cookie: ${cookie.name}`);
  } catch (error) {
    if (error !== 'cancel' && error !== undefined) {
      ElMessage.error(`删除 Cookie 失败: ${error}`);
    }
  }
};

const handleClearAll = async () => {
  if (!ensureDeviceSelected() || cookies.value.length === 0) return;
  try {
    await ElMessageBox.confirm(
      '确定要清空所有 Cookies 吗？此操作不可撤销。',
      '确认清空',
      { confirmButtonText: '清空', cancelButtonText: '取消', type: 'warning' }
    );
    // Delete each cookie by name (no bulk-delete command in the protocol).
    const names = cookies.value.map(c => c.name);
    for (const name of names) {
      await wsStore.deleteCookie(name).catch(() => {});
    }
    await wsStore.getCookies();
    ElMessage.success('已清空所有 Cookies');
  } catch (error) {
    if (error !== 'cancel' && error !== undefined) {
      ElMessage.error(`清空 Cookies 失败: ${error}`);
    }
  }
};

const resetForm = () => {
  cookieForm.value = {
    name: '',
    value: '',
    domain: '',
    path: '/',
    expires: '',
    httpOnly: false,
    secure: false,
    sameSite: 'Lax',
  };
  formRef.value?.clearValidate();
};

const load = async () => {
  if (ensureDeviceSelected()) {
    await handleRefresh();
  }
};

onMounted(() => {
  load();
});

// If the device list resolves after mount, select + load.
watch(
  () => [props.deviceId, wsStore.devices.length],
  () => {
    if (deviceId.value && wsStore.currentDevice?.info.deviceId !== deviceId.value) {
      load();
    }
  }
);
</script>

<style scoped>
.cookie-manager {
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
}

.manager-header h2 {
  margin: 0;
  color: #303133;
}

.actions {
  display: flex;
  gap: 12px;
}

.cookie-table {
  flex: 1;
}

.no-device {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
}
</style>
