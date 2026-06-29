<template>
  <!-- 坐席通话上线入口（顶栏小弹窗） -->
  <el-popover :visible="visible" placement="bottom-end" :width="320" @update:visible="onToggle">
    <template #reference>
      <el-badge :is-dot="isDot" type="success">
        <el-button size="small" :type="callStore.online ? 'success' : 'default'" @click="visible = !visible">
          <el-icon><Headset /></el-icon>
          <span class="btn-text">{{ callStore.online ? '在线' : '客服通话' }}</span>
        </el-button>
      </el-badge>
    </template>

    <div class="operator-panel">
      <div class="panel-title">客服通话 · 被叫接听</div>

      <el-form label-position="top" size="small">
        <el-form-item label="坐席手机号（uid = roomId）">
          <el-input
            v-model="phone"
            placeholder="如 18211112222"
            :disabled="callStore.online"
            maxlength="11"
            clearable
            @input="onPhoneInput"
          />
          <div class="hint">一体机主叫端的 roomId 须填此号（11 位手机号）</div>
        </el-form-item>

        <div class="status-row">
          <span>状态：</span>
          <el-tag :type="statusTagType" size="small">{{ statusText }}</el-tag>
        </div>

        <div class="actions">
          <el-button
            v-if="!callStore.online"
            type="primary"
            size="small"
            @click="handleOnline"
            :disabled="!phone.trim()"
          >
            上线待命
          </el-button>
          <el-button v-else type="danger" size="small" @click="handleOffline"> 下线 </el-button>
        </div>
      </el-form>

      <el-alert
        v-if="callStore.errorMessage"
        :title="callStore.errorMessage"
        type="error"
        :closable="true"
        show-icon
        @close="callStore.clearError()"
        style="margin-top: 8px"
      />
    </div>
  </el-popover>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { Headset } from '@element-plus/icons-vue'
import { useCallStore } from '@/stores/call'

const callStore = useCallStore()
const visible = ref(false)
const phone = ref(callStore.operatorPhone || '')

const statusText = computed(() => {
  switch (callStore.phase) {
    case 'idle':
      return callStore.online ? '已上线·待命' : '未上线'
    case 'online':
      return '待命中'
    case 'ringing':
      return '来电!'
    case 'connecting':
      return '接通中'
    case 'connected':
      return '通话中'
    default:
      return callStore.phase
  }
})

const statusTagType = computed(() => {
  switch (callStore.phase) {
    case 'connected':
      return 'success'
    case 'ringing':
      return 'danger'
    case 'connecting':
      return 'warning'
    case 'online':
      return 'success'
    default:
      return callStore.online ? 'success' : 'info'
  }
})

const isDot = computed(
  () => callStore.online && (callStore.phase === 'online' || callStore.phase === 'idle'),
)

const handleOnline = () => {
  // 前端手机号格式校验
  const p = phone.value.trim()
  if (!/^1\d{10}$/.test(p)) {
    callStore.clearError()
    // 借用 errorMessage 展示（goOnline 也会校验，这里提前拦截）
    ;(callStore as any).errorMessage = '手机号格式错误，需 11 位数字（1 开头）'
    return
  }
  callStore.goOnline(p)
}

// 限制只能输入数字
const onPhoneInput = (val: string) => {
  phone.value = val.replace(/\D/g, '').slice(0, 11)
}
const handleOffline = () => {
  callStore.goOffline()
}

const onToggle = (v: boolean) => {
  visible.value = v
}

// 通话来临时自动关闭面板，让 CallIncoming 弹窗聚焦
watch(
  () => callStore.phase,
  (p) => {
    if (p === 'ringing') visible.value = false
    // 同步手机号回显（goOnline 后 store 里存了）
    if (!phone.value && callStore.operatorPhone) phone.value = callStore.operatorPhone
  },
)
</script>

<style scoped>
.btn-text {
  margin-left: 4px;
}
.operator-panel {
  padding: 4px;
}
.panel-title {
  font-size: 14px;
  font-weight: 600;
  margin-bottom: 12px;
  color: #303133;
}
.hint {
  font-size: 12px;
  color: #909399;
  margin-top: 4px;
  line-height: 1.4;
}
.status-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 8px 0;
  font-size: 13px;
  color: #606266;
}
.actions {
  display: flex;
  gap: 8px;
  margin-top: 8px;
}
</style>
