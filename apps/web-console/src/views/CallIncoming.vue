<template>
  <el-dialog
    v-model="visible"
    :show-close="false"
    :close-on-click-modal="false"
    :close-on-press-escape="false"
    width="440px"
    class="call-incoming-dialog"
    align-center
    append-to-body
  >
    <div class="incoming-body">
      <div class="caller-avatar">
        <el-icon :size="56"><Iphone /></el-icon>
      </div>
      <div class="caller-name">{{ callerName }}</div>
      <div class="caller-station">{{ callerStation || '一体机来电' }}</div>

      <div class="ringing-indicator">
        <span class="dot"></span>
        <span class="dot"></span>
        <span class="dot"></span>
        <span class="ring-text">来电振铃中…</span>
      </div>

      <!-- 客户业务信息 -->
      <div class="caller-info-card" v-if="hasInfo">
        <el-descriptions :column="1" size="small" border>
          <el-descriptions-item v-if="info.order_id" label="订单号">{{ info.order_id }}</el-descriptions-item>
          <el-descriptions-item v-if="info.phone" label="客户手机">{{ info.phone }}</el-descriptions-item>
          <el-descriptions-item v-if="info.current_node" label="业务节点">{{ info.current_node }}</el-descriptions-item>
        </el-descriptions>
        <el-descriptions v-if="hasFinance" :column="1" size="small" border style="margin-top: 8px">
          <el-descriptions-item v-if="finance.carInfo" label="车型">{{ finance.carInfo }}</el-descriptions-item>
          <el-descriptions-item v-if="finance.amount" label="融资额">{{ finance.amount }}</el-descriptions-item>
          <el-descriptions-item v-if="finance.month_pay" label="月供">{{ finance.month_pay }}</el-descriptions-item>
          <el-descriptions-item v-if="finance.periods" label="期数">{{ finance.periods }}</el-descriptions-item>
        </el-descriptions>
      </div>

      <div class="incoming-actions">
        <el-button type="danger" size="large" round @click="handleReject">
          <el-icon><Close /></el-icon>
          <span>拒接</span>
        </el-button>
        <el-button type="success" size="large" round @click="handleAccept">
          <el-icon><Microphone /></el-icon>
          <span>接听</span>
        </el-button>
      </div>
    </div>
  </el-dialog>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { Iphone, Close, Microphone } from '@element-plus/icons-vue'
import { useCallStore } from '@/stores/call'

const callStore = useCallStore()

const visible = computed({
  get: () => callStore.phase === 'ringing',
  set: () => {},
})

const info = computed(() => callStore.incoming || ({} as any))
const finance = computed(() => info.value.finance_info || ({} as any))
const hasInfo = computed(
  () => !!(info.value.order_id || info.value.phone || info.value.current_node),
)
const hasFinance = computed(
  () => !!(finance.value.carInfo || finance.value.amount || finance.value.month_pay),
)

const callerName = computed(() => info.value.name || '未知客户')
const callerStation = computed(() => info.value.station || '')

const handleAccept = () => {
  void callStore.accept()
}
const handleReject = () => {
  callStore.reject()
}
</script>

<style scoped>
.incoming-body {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 12px 8px 8px;
}
.caller-avatar {
  width: 96px;
  height: 96px;
  border-radius: 50%;
  background: linear-gradient(135deg, #67c23a, #409eff);
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  margin-bottom: 16px;
}
.caller-name {
  font-size: 22px;
  font-weight: 600;
  color: #303133;
}
.caller-station {
  font-size: 14px;
  color: #909399;
  margin-top: 4px;
}
.ringing-indicator {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 16px;
  margin-bottom: 12px;
}
.ringing-indicator .dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #f56c6c;
  animation: pulse 1.2s infinite ease-in-out;
}
.ringing-indicator .dot:nth-child(2) {
  animation-delay: 0.2s;
}
.ringing-indicator .dot:nth-child(3) {
  animation-delay: 0.4s;
}
.ringing-indicator .ring-text {
  font-size: 13px;
  color: #f56c6c;
  margin-left: 4px;
}
@keyframes pulse {
  0%,
  80%,
  100% {
    opacity: 0.3;
    transform: scale(0.8);
  }
  40% {
    opacity: 1;
    transform: scale(1.2);
  }
}
.caller-info-card {
  width: 100%;
  max-height: 200px;
  overflow-y: auto;
  margin-bottom: 16px;
}
.incoming-actions {
  display: flex;
  gap: 40px;
}
.incoming-actions .el-button {
  width: 110px;
  height: 56px;
  font-size: 16px;
}
.incoming-actions .el-button span {
  margin-left: 4px;
}
</style>
