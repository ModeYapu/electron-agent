/**
 * 通话 Pinia Store
 *
 * 把 SignalClient + CallEngine 组合成对外暴露的状态机，
 * 是 UI 层（CallIncoming.vue / CallPanel.vue）的唯一数据来源。
 *
 * 状态机：
 *   idle → online(上线待命) → ringing(来电) → connecting(接听中协商) → connected(通话中) → idle
 *                                                    ↓
 *                                                ended/missed → idle
 */

import { defineStore } from 'pinia'
import { computed, ref, shallowRef } from 'vue'
import { SignalClient, type CallIncomingInfo } from '@/webrtc/signal-client'
import { CallEngine } from '@/webrtc/call-engine'
import { rtcLog } from '@/webrtc/log'

export type CallPhase = 'idle' | 'online' | 'ringing' | 'connecting' | 'connected' | 'ended'

export const useCallStore = defineStore('call', () => {
  // ====== 状态 ======
  const phase = ref<CallPhase>('idle')
  const online = ref(false) // 坐席是否上线待命
  const operatorPhone = ref('') // 坐席手机号（= uid = roomId）
  const clientChannel = ref('') // 登录后返回的客户渠道（cmd_current_peers）

  // 来电信息（cmd_start_call 携带的客户业务信息）
  const incoming = ref<CallIncomingInfo | null>(null)
  const incomingFromUid = ref('')
  const incomingCallLogId = ref('')

  // 通话中的远端 uid（用于 UI 显示）
  const remoteUid = ref('')

  // 媒体流（shallowRef，避免 Pinia 深度代理 MediaStream 对象）
  const localStream = shallowRef<MediaStream | null>(null)
  const remoteStream = shallowRef<MediaStream | null>(null)

  // 媒体控制
  const micEnabled = ref(true)
  const camEnabled = ref(true)

  // 通话计时
  const durationSec = ref(0)
  let durationTimer: number | null = null

  // 错误提示（UI 用）
  const errorMessage = ref('')

  // 引擎实例（shallowRef，不参与响应式代理）
  const signal = shallowRef<SignalClient | null>(null)
  const engine = shallowRef<CallEngine | null>(null)

  // ====== 计算属性 ======
  const isRinging = computed(() => phase.value === 'ringing')
  const isConnected = computed(() => phase.value === 'connected')
  const inSession = computed(() => phase.value === 'connecting' || phase.value === 'connected')

  // ====== 私有：绑定信令 + 引擎事件 ======

  /** 创建并绑定 SignalClient */
  function createSignal(): SignalClient {
    const sc = new SignalClient()
    sc.bind({
      onLoginOk: (channel, station) => {
        clientChannel.value = channel || station
        clearLoginTimeout() // 登录成功，取消超时检测
        // 仅在待命/空闲态切 online，避免重连时覆盖通话中状态
        if (phase.value === 'idle' || phase.value === 'online') {
          phase.value = 'online'
        }
      },
      onIncomingCall: (fromUid, callLogId, info) => {
        // 仅在上线待命状态接受来电
        if (phase.value !== 'online' && phase.value !== 'idle') {
          rtcLog.err(`收到来电但当前 phase=${phase.value}，忽略`)
          return
        }
        incoming.value = info
        incomingFromUid.value = fromUid
        incomingCallLogId.value = callLogId
        remoteUid.value = fromUid
        phase.value = 'ringing'
        // 播放振铃音（UI 层处理，这里仅设状态）
        playRingtone()
      },
      onNewPeer: (uid) => {
        // 主叫进房间，记录 uid（engine 的 handleOffer 会用到）
        if (!remoteUid.value) remoteUid.value = uid
      },
      onOffer: (fromUid, sdp) => {
        // 收到主叫 offer，交给 engine 协商
        void engine.value?.handleOffer(fromUid, sdp)
      },
      onIce: (fromUid, candidate) => {
        void engine.value?.handleRemoteIce(fromUid, candidate)
      },
      onAvStatus: (fromUid, settings) => {
        rtcLog.sys(`对端 ${fromUid} AV 状态:`, settings)
      },
      onHangup: () => {
        rtcLog.sys('对端挂断')
        endCallInternal(false)
      },
      onError: (type, message) => {
        rtcLog.err(`信令错误: type=${type} message=${message}`)
        errorMessage.value = message || type || '通话错误'
        // room_not_found / 通话已结束
        if (type === 'room_not_found') {
          endCallInternal(false)
        }
      },
      onOpen: () => {},
      onClose: (code, reason) => {
        // 信令断开：若在通话中，保持媒体；否则回 idle
        if (!inSession.value) {
          phase.value = online.value ? 'online' : 'idle'
        }
      },
      onError_ws: () => {},
    })
    return sc
  }

  /** 创建并绑定 CallEngine */
  function createEngine(sc: SignalClient): CallEngine {
    const eng = new CallEngine(sc)
    eng.bind({
      onLocalStream: (stream) => {
        localStream.value = stream
      },
      onRemoteStream: (stream) => {
        remoteStream.value = stream
      },
      onIceStateChange: () => {},
      onConnected: () => {
        phase.value = 'connected'
        startDurationTimer()
        stopRingtone()
      },
      onFailed: (reason) => {
        errorMessage.value = reason
        endCallInternal(false)
      },
      onEnded: () => {
        endCallInternal(false)
      },
    })
    return eng
  }

  // ====== 公开动作 ======

  // 上线登录超时检测（N 秒未收到 cmd_current_peers 则提示）
  let loginTimeoutTimer: number | null = null
  const LOGIN_TIMEOUT_MS = 8000

  /**
   * 上线待命：连接信令服务器
   * @param phone 坐席手机号（uid = roomId）
   */
  function goOnline(phone: string): void {
    const p = String(phone || '').trim()
    if (!p) {
      rtcLog.err('上线失败：坐席手机号格式错误')
      errorMessage.value = '请输入正确的坐席手机号（11 位数字）'
      return
    }
    // 手机号格式校验（11 位数字）
    if (!/^1\d{10}$/.test(p)) {
      rtcLog.err(`上线失败：手机号格式错误 ${p}`)
      errorMessage.value = '手机号格式错误，需 11 位数字（如 18211112222）'
      return
    }
    operatorPhone.value = p
    online.value = true
    phase.value = 'idle'

    // 创建/重置信令 + 引擎
    signal.value?.disconnect()
    signal.value = createSignal()
    engine.value = createEngine(signal.value)

    rtcLog.sys(`坐席上线: phone=${p}`)
    signal.value.connect(p, p)

    // 启动登录超时检测：8s 内未收到 cmd_current_peers 则提示
    clearLoginTimeout()
    loginTimeoutTimer = window.setTimeout(() => {
      loginTimeoutTimer = null
      if (phase.value === 'idle') {
        rtcLog.err('上线超时：8s 未收到登录成功响应')
        errorMessage.value = '连接信令服务器超时，请检查手机号或网络后重试'
        // 不自动下线，让坐席决定是否重试
      }
    }, LOGIN_TIMEOUT_MS)
  }

  function clearLoginTimeout(): void {
    if (loginTimeoutTimer) {
      clearTimeout(loginTimeoutTimer)
      loginTimeoutTimer = null
    }
  }

  /** 下线 */
  function goOffline(): void {
    rtcLog.sys('坐席下线')
    clearLoginTimeout()
    endCallInternal(false)
    signal.value?.disconnect()
    signal.value = null
    engine.value = null
    online.value = false
    phase.value = 'idle'
    operatorPhone.value = ''
    clientChannel.value = ''
  }

  /**
   * 接听来电
   *
   * 流程：设置会话主叫 → 发 cmd_join_room → 预采集本地媒体
   * 之后等主叫主动发 cmd_offer，engine.handleOffer 建媒体。
   */
  async function accept(): Promise<void> {
    if (phase.value !== 'ringing') {
      rtcLog.err(`接听失败：当前 phase=${phase.value}（需 ringing）`)
      return
    }
    stopRingtone()
    phase.value = 'connecting'

    if (!engine.value) {
      // 兜底
      engine.value = createEngine(signal.value!)
    }

    // 设置会话主叫信息（answer/hangup 需要 callLogId）
    engine.value.setRemote(incomingFromUid.value, incomingCallLogId.value)

    // 发 cmd_join_room（对齐 App doAccept）
    signal.value?.sendJoinRoom()

    // 预采集本地媒体（缩短接通延迟）
    try {
      await engine.value.prepareLocalStream()
    } catch (e: any) {
      rtcLog.err(`预采集媒体失败: ${e?.message || e}`)
      errorMessage.value = '无法访问摄像头/麦克风，请检查权限'
      endCallInternal(true)
    }
  }

  /**
   * 拒接来电
   */
  function reject(): void {
    if (phase.value !== 'ringing') return
    rtcLog.sys('拒接来电')
    // 发挂断通知主叫
    if (incomingCallLogId.value && signal.value) {
      signal.value.sendHangup(incomingCallLogId.value)
    }
    endCallInternal(false)
  }

  /**
   * 挂断通话
   */
  function hangup(): void {
    rtcLog.sys('坐席主动挂断')
    endCallInternal(true)
  }

  /** 内部：结束通话，清理状态 */
  function endCallInternal(notifyServer: boolean): void {
    stopRingtone()
    stopDurationTimer()

    // 释放引擎资源（含发 cmd_hang_up）
    engine.value?.stopCall(notifyServer)

    // 清空媒体引用
    localStream.value = null
    remoteStream.value = null

    // 清空来电信息
    incoming.value = null
    incomingFromUid.value = ''
    incomingCallLogId.value = ''
    remoteUid.value = ''
    durationSec.value = 0

    // 恢复到上线待命或 idle
    phase.value = online.value ? 'online' : 'idle'
  }

  // ====== 媒体控制 ======
  function toggleMic(): void {
    const enabled = engine.value?.toggleMicrophone()
    if (typeof enabled === 'boolean') micEnabled.value = enabled
  }
  function toggleCam(): void {
    const enabled = engine.value?.toggleCamera()
    if (typeof enabled === 'boolean') camEnabled.value = enabled
  }

  // ====== 计时 ======
  function startDurationTimer(): void {
    stopDurationTimer()
    durationSec.value = 0
    durationTimer = window.setInterval(() => {
      durationSec.value += 1
    }, 1000)
  }
  function stopDurationTimer(): void {
    if (durationTimer) {
      clearInterval(durationTimer)
      durationTimer = null
    }
  }

  // ====== 振铃音（AudioContext 蜂鸣，避免依赖外部音频文件）======
  let ringCtx: AudioContext | null = null
  let ringTimer: number | null = null
  function playRingtone(): void {
    try {
      if (!ringCtx) ringCtx = new (window.AudioContext || (window as any).webkitAudioContext)()
      const beep = () => {
        if (!ringCtx) return
        const osc = ringCtx.createOscillator()
        const gain = ringCtx.createGain()
        osc.frequency.value = 800
        osc.connect(gain)
        gain.connect(ringCtx.destination)
        gain.gain.setValueAtTime(0.15, ringCtx.currentTime)
        osc.start()
        osc.stop(ringCtx.currentTime + 0.5)
      }
      beep()
      ringTimer = window.setInterval(beep, 1500)
    } catch (e: any) {
      rtcLog.sys(`振铃播放失败(浏览器自动播放限制): ${e?.message || e}`)
    }
  }
  function stopRingtone(): void {
    if (ringTimer) {
      clearInterval(ringTimer)
      ringTimer = null
    }
  }

  // 清理错误消息
  function clearError(): void {
    errorMessage.value = ''
  }

  return {
    // 状态
    phase,
    online,
    operatorPhone,
    clientChannel,
    incoming,
    incomingFromUid,
    incomingCallLogId,
    remoteUid,
    localStream,
    remoteStream,
    micEnabled,
    camEnabled,
    durationSec,
    errorMessage,
    // 计算
    isRinging,
    isConnected,
    inSession,
    // 动作
    goOnline,
    goOffline,
    accept,
    reject,
    hangup,
    toggleMic,
    toggleCam,
    clearError,
  }
})
