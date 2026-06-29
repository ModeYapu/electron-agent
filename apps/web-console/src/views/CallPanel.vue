<template>
  <div class="call-panel-overlay" v-if="show">
    <div class="call-panel">
      <!-- 顶部状态条 -->
      <div class="panel-header">
        <div class="header-left">
          <el-tag :type="statusTagType" effect="dark" size="small">{{ statusText }}</el-tag>
          <span class="duration" v-if="callStore.isConnected">{{ formatDuration(callStore.durationSec) }}</span>
        </div>
        <div class="header-right">
          <span class="remote-name">{{ callerName }}</span>
          <el-button text size="small" @click="minimized = true" v-if="!minimized">
            <el-icon><Minus /></el-icon>最小化
          </el-button>
        </div>
      </div>

      <!-- 视频区 -->
      <div class="video-area" v-if="!minimized">
        <!-- 远端（客户/一体机）大屏 -->
        <video ref="remoteVideoRef" class="remote-video" autoplay playsinline></video>
        <div class="remote-empty" v-if="!callStore.remoteStream">
          <el-icon :size="48"><VideoCamera /></el-icon>
          <span>等待对方画面…</span>
        </div>

        <!-- 本地（坐席）小窗 -->
        <div class="local-video-box">
          <video ref="localVideoRef" class="local-video" autoplay playsinline muted></video>
          <div class="local-empty" v-if="!callStore.localStream">
            <el-icon><Loading /></el-icon>
          </div>
        </div>

        <!-- 客户信息浮层 -->
        <div class="caller-overlay" v-if="hasInfo && !callStore.isConnected">
          <div class="caller-overlay-name">{{ callerName }}</div>
          <div class="caller-overlay-station" v-if="info.station">{{ info.station }}</div>
        </div>
      </div>

      <!-- 最小化时的紧凑条 -->
      <div class="mini-bar" v-else>
        <el-icon><VideoCamera /></el-icon>
        <span class="mini-text">通话中 · {{ formatDuration(callStore.durationSec) }}</span>
        <el-button text size="small" @click="minimized = false">
          <el-icon><FullScreen /></el-icon>展开
        </el-button>
      </div>

      <!-- 控制条 -->
      <div class="controls" v-if="!minimized">
        <el-tooltip :content="callStore.micEnabled ? '静音' : '取消静音'" placement="top">
          <el-button
            :type="callStore.micEnabled ? 'success' : 'warning'"
            circle
            size="large"
            @click="callStore.toggleMic()"
            :disabled="!callStore.isConnected"
          >
            <el-icon><Microphone v-if="callStore.micEnabled" /><Mute v-else /></el-icon>
          </el-button>
        </el-tooltip>

        <el-tooltip :content="callStore.camEnabled ? '关闭摄像头' : '开启摄像头'" placement="top">
          <el-button
            :type="callStore.camEnabled ? 'success' : 'warning'"
            circle
            size="large"
            @click="callStore.toggleCam()"
            :disabled="!callStore.isConnected"
          >
            <el-icon><VideoCamera v-if="callStore.camEnabled" /><VideoPause v-else /></el-icon>
          </el-button>
        </el-tooltip>

        <el-tooltip content="挂断" placement="top">
          <el-button type="danger" circle size="large" @click="callStore.hangup()">
            <el-icon><PhoneFilled /></el-icon>
          </el-button>
        </el-tooltip>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import {
  Microphone,
  Mute,
  VideoCamera,
  VideoPause,
  PhoneFilled,
  Minus,
  FullScreen,
  Loading,
} from '@element-plus/icons-vue'
import { useCallStore } from '@/stores/call'

const callStore = useCallStore()

const minimized = ref(false)
const remoteVideoRef = ref<HTMLVideoElement | null>(null)
const localVideoRef = ref<HTMLVideoElement | null>(null)

// 显示条件：正在接听协商中 或 通话中
const show = computed(
  () => callStore.phase === 'connecting' || callStore.phase === 'connected',
)

const info = computed(() => callStore.incoming || ({} as any))
const callerName = computed(() => info.value.name || '客户')
const hasInfo = computed(() => !!info.value.order_id)

const statusText = computed(() => {
  switch (callStore.phase) {
    case 'connecting':
      return '接通中…'
    case 'connected':
      return '通话中'
    default:
      return callStore.phase
  }
})
const statusTagType = computed(() => {
  if (callStore.phase === 'connected') return 'success'
  if (callStore.phase === 'connecting') return 'warning'
  return 'info'
})

const formatDuration = (sec: number) => {
  const m = Math.floor(sec / 60)
  const s = sec % 60
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

// 把媒体流绑定到 <video>
const attachStream = async (el: HTMLVideoElement | null, stream: MediaStream | null) => {
  if (!el || !stream) return
  if (el.srcObject !== stream) {
    el.srcObject = stream
  }
  await nextTick()
  try {
    await el.play()
  } catch {
    // 浏览器自动播放限制，忽略（用户已点击接听，通常可播）
  }
}

watch(
  () => callStore.remoteStream,
  (stream) => {
    void attachStream(remoteVideoRef.value, stream)
  },
)
watch(
  () => callStore.localStream,
  (stream) => {
    void attachStream(localVideoRef.value, stream)
  },
)
// show 变化时重新绑定（组件从隐藏到显示，video 元素重新挂载）
watch(show, async (v) => {
  if (v) {
    await nextTick()
    void attachStream(remoteVideoRef.value, callStore.remoteStream)
    void attachStream(localVideoRef.value, callStore.localStream)
  }
})

// 通话结束自动取消最小化
watch(
  () => callStore.phase,
  (p) => {
    if (p === 'idle' || p === 'online') minimized.value = false
  },
)
</script>

<style scoped>
.call-panel-overlay {
  position: fixed;
  top: 80px;
  right: 24px;
  z-index: 2000;
  width: 420px;
}
.call-panel {
  background: #1f1f1f;
  border-radius: 12px;
  overflow: hidden;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
  border: 1px solid #3a3a3a;
}
.panel-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 10px 14px;
  background: #2a2a2a;
  color: #fff;
}
.header-left {
  display: flex;
  align-items: center;
  gap: 10px;
}
.duration {
  font-family: Consolas, monospace;
  font-size: 14px;
  font-weight: 600;
}
.header-right {
  display: flex;
  align-items: center;
  gap: 8px;
}
.remote-name {
  font-size: 13px;
  color: #ddd;
}
.video-area {
  position: relative;
  width: 100%;
  height: 280px;
  background: #000;
}
.remote-video {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.remote-empty {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  color: #909399;
  font-size: 14px;
}
.local-video-box {
  position: absolute;
  right: 10px;
  bottom: 10px;
  width: 110px;
  height: 80px;
  border-radius: 8px;
  overflow: hidden;
  background: #0a0a0a;
  border: 1px solid rgba(255, 255, 255, 0.2);
}
.local-video {
  width: 100%;
  height: 100%;
  object-fit: cover;
  transform: scaleX(-1);
}
.local-empty {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #909399;
}
.caller-overlay {
  position: absolute;
  left: 10px;
  top: 10px;
  background: rgba(0, 0, 0, 0.5);
  padding: 6px 10px;
  border-radius: 6px;
  color: #fff;
}
.caller-overlay-name {
  font-size: 14px;
  font-weight: 600;
}
.caller-overlay-station {
  font-size: 12px;
  opacity: 0.8;
}
.mini-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 14px;
  color: #fff;
  background: #2a2a2a;
}
.mini-text {
  flex: 1;
  font-size: 13px;
}
.controls {
  display: flex;
  justify-content: center;
  gap: 24px;
  padding: 14px;
  background: #2a2a2a;
}
.controls .el-button {
  width: 48px;
  height: 48px;
}
</style>
