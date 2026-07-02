<template>
  <div class="call-panel-overlay" ref="overlayRef" v-if="show" :style="panelOverlayStyle">
    <div class="call-panel">
      <!-- 顶部状态条（可拖动手柄） -->
      <div class="panel-header" @mousedown="startDrag">
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
        <!-- 远端（客户/一体机）大屏 ↔ 点击小窗可切换大小 -->
        <video
          ref="remoteVideoRef"
          :class="['remote-video', { 'video-small': swapped }]"
          autoplay
          playsinline
          controlslist="noplaybackrate nodownload nofullscreen noremoteplayback"
          disablepictureinpicture
          @click="swapped = !swapped"
        ></video>
        <div class="remote-empty" v-if="!callStore.remoteStream">
          <el-icon :size="48"><VideoCamera /></el-icon>
          <span>等待对方画面…</span>
        </div>

        <!-- 本地（坐席）小窗 ↔ 点击小窗可切换大小 -->
        <div :class="['local-video-box', { 'video-large': swapped }]" @click="swapped = !swapped">
          <video ref="localVideoRef" class="local-video" autoplay playsinline muted controlslist="noplaybackrate nodownload nofullscreen noremoteplayback" disablepictureinpicture></video>
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
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
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
// 视频切换：false=远端大屏/本地小窗，true=本地大屏/远端小窗
const swapped = ref(false)
const remoteVideoRef = ref<HTMLVideoElement | null>(null)
const localVideoRef = ref<HTMLVideoElement | null>(null)

// ====== 面板拖拽（按住 header 拖动）======
const panelPos = ref<{ left: number | null; top: number | null }>({ left: null, top: null })
const dragState = ref<{ startX: number; startY: number; origLeft: number; origTop: number } | null>(null)
const overlayRef = ref<HTMLElement | null>(null)

const startDrag = (e: MouseEvent) => {
  if (e.button !== 0) return
  // 排除点击按钮（最小化等）
  if ((e.target as HTMLElement).closest('button')) return
  const el = overlayRef.value
  if (!el) return
  const rect = el.getBoundingClientRect()
  // 首次拖拽：从 right 定位切换到 left 定位
  if (panelPos.value.left === null) {
    panelPos.value = { left: rect.left, top: rect.top }
  }
  dragState.value = {
    startX: e.clientX,
    startY: e.clientY,
    origLeft: panelPos.value.left || rect.left,
    origTop: panelPos.value.top || rect.top,
  }
  e.preventDefault()
}
const onDragMove = (e: MouseEvent) => {
  const ds = dragState.value
  if (!ds) return
  panelPos.value = {
    left: ds.origLeft + (e.clientX - ds.startX),
    top: ds.origTop + (e.clientY - ds.startY),
  }
}
const endDrag = () => { dragState.value = null }

const panelOverlayStyle = computed(() => {
  const p = panelPos.value
  if (p.left !== null && p.top !== null) {
    return { left: `${p.left}px`, top: `${p.top}px`, right: 'auto' }
  }
  return {}
})

onMounted(() => {
  window.addEventListener('mousemove', onDragMove)
  window.addEventListener('mouseup', endDrag)
})
onUnmounted(() => {
  window.removeEventListener('mousemove', onDragMove)
  window.removeEventListener('mouseup', endDrag)
})

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
// minimized 变化时重新绑定（最小化用 v-if 销毁 video 元素，展开重建后需重新 attach 流）
watch(minimized, async (m) => {
  if (!m) {
    await nextTick()
    void attachStream(remoteVideoRef.value, callStore.remoteStream)
    void attachStream(localVideoRef.value, callStore.localStream)
  }
})
// swapped（切换大小屏）变化时也重新绑定（CSS class 变化 + HMR 可能导致 video srcObject 丢失）
watch(swapped, async () => {
  await nextTick()
  void attachStream(remoteVideoRef.value, callStore.remoteStream)
  void attachStream(localVideoRef.value, callStore.localStream)
})

// ★ 流保活：通话中每 3 秒检查 video.srcObject，丢失则重新 attach。
//   黑屏根因：HMR 热更新重建 video 元素 / 浏览器长时间运行 GC 流 / ICE 重连后流引用变化，
//   都可能导致 srcObject 为空 → 黑屏。定期检查兜底。
let keepAliveTimer: ReturnType<typeof setInterval> | null = null
watch(show, (v) => {
  if (v) {
    keepAliveTimer = setInterval(async () => {
      const rv = remoteVideoRef.value
      const lv = localVideoRef.value
      // 远端流存在但 video 没绑定 → 重新 attach
      if (rv && callStore.remoteStream && rv.srcObject !== callStore.remoteStream) {
        void attachStream(rv, callStore.remoteStream)
      }
      if (lv && callStore.localStream && lv.srcObject !== callStore.localStream) {
        void attachStream(lv, callStore.localStream)
      }
    }, 3000)
  } else if (keepAliveTimer) {
    clearInterval(keepAliveTimer)
    keepAliveTimer = null
  }
})
onUnmounted(() => {
  if (keepAliveTimer) clearInterval(keepAliveTimer)
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
  cursor: move;
  user-select: none;
}
.panel-header :deep(button),
.panel-header button {
  cursor: pointer;
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
  cursor: pointer;
}
/* 切换：远端缩小到右上角小窗 */
.remote-video.video-small {
  position: absolute;
  top: 10px;
  right: 10px;
  width: 110px;
  height: 80px;
  border-radius: 8px;
  border: 1px solid rgba(255, 255, 255, 0.2);
  z-index: 2;
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
  cursor: pointer;
}
/* 切换：本地放大占满整个视频区 */
.local-video-box.video-large {
  top: 0;
  right: 0;
  bottom: 0;
  left: 0;
  width: auto;
  height: auto;
  border-radius: 0;
  border: none;
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
