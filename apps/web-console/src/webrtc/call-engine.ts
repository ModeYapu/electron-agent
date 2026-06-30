/**
 * 被叫 RTC 引擎
 *
 * 移植自 Android App:
 *   yx-loan-webrtc-android-uniappx/uni_modules/hlb-floatwindow/utssdk/app-android/index.uts
 *   (NativeWebRtc 类: 媒体采集 + PeerConnection + handleOffer + handleIce + stopCall)
 *
 * 被叫端媒体协商流程（与 App 一致）：
 *   1. 收到 offer (handleOffer) → 采集本地媒体 → 建 PC → setRemoteDescription(offer)
 *   2. createAnswer → setLocalDescription → 发 cmd_answer + cmd_av_status
 *   3. onicecandidate → 发 cmd_ice
 *   4. ontrack → 远端流赋给 <video>
 *   5. oniceconnectionstatechange → connected/fail
 *
 * 与 App 原生版 (~900行) 相比，浏览器原生 API 使代码量降到 ~150 行：
 *   Camera2Enumerator + initVideoTrack → getUserMedia
 *   PeerConnectionFactory + createPeerConnection → new RTCPeerConnection
 *   handleOffer + SdpObserver 回调 → setRemoteDescription/createAnswer (async)
 *   onAddStream + SurfaceViewRenderer → ontrack + <video>.srcObject
 */

import { SignalClient } from './signal-client'
import { RTC_CONFIG, MEDIA_CONSTRAINTS, USE_CANVAS_FAKE_VIDEO, buildCanvasFakeStream } from './config'
import { rtcLog } from './log'

/** RTC 引擎状态 */
export type CallEnginePhase =
  | 'idle'
  | 'connecting' // 正在协商 offer/answer
  | 'connected'
  | 'ended'

export interface CallEngineCallbacks {
  /** 本地流就绪 */
  onLocalStream?: (stream: MediaStream) => void
  /** 远端流就绪 */
  onRemoteStream?: (stream: MediaStream) => void
  /** ICE 连接状态变化 */
  onIceStateChange?: (state: RTCIceConnectionState) => void
  /** 通话已建立（ICE connected） */
  onConnected?: () => void
  /** 连接失败 */
  onFailed?: (reason: string) => void
  /** 通话结束（挂断/对端关闭/错误） */
  onEnded?: () => void
}

export class CallEngine {
  private pc: RTCPeerConnection | null = null
  private localStream: MediaStream | null = null
  private signal: SignalClient
  private cb: CallEngineCallbacks = {}

  /** 当前通话的主叫 uid（来自 cmd_start_call/cmd_new_peer） */
  private remoteUid = ''
  /** 当前通话的 callLogId（answer/hangup 必须回传） */
  private callLogId = ''
  private phase: CallEnginePhase = 'idle'

  /** ICE candidate 缓冲（远端 answer 前 candidate 可能先到，对齐 App 的处理思路） */
  private iceCandidateBuffer: Array<{ sdpMid: string; sdpMLineIndex: number; sdp: string }> = []
  private remoteDescriptionSet = false

  constructor(signal: SignalClient) {
    this.signal = signal
  }

  bind(callbacks: CallEngineCallbacks) {
    this.cb = { ...this.cb, ...callbacks }
  }

  /**
   * 设置当前会话的主叫信息
   * 在 cmd_start_call 来电时由 store 调用
   */
  setRemote(uid: string, callLogId: string): void {
    this.remoteUid = uid
    this.callLogId = callLogId
    rtcLog.sys(`设置会话主叫: uid=${uid} callLogId=${callLogId}`)
  }

  /**
   * 接听：采集本地媒体并发 cmd_join_room
   *
   * 注意：被叫先发 join_room，主叫收到通知后主动 createOffer 发 cmd_offer，
   *       被叫再在 handleOffer 里建 PC。所以这里不建 PC，只采集媒体。
   *
   * 对齐 App: doAccept() → cmd_join_room；媒体采集延后到收到 offer 时（startCalll 里）。
   * 但为缩短接通延迟，这里预采集。
   */
  async prepareLocalStream(): Promise<void> {
    if (this.localStream) {
      rtcLog.sys('本地流已存在，跳过采集')
      return
    }
    try {
      // 本地测试环境（localhost/127.0.0.1）：用 canvas 模拟视频流，
      // 避免和主叫端 winRtc 抢同一个真实摄像头（NotReadableError）。
      // 生产环境（一体机 vs 坐席 PC 分离）用真实 getUserMedia。
      if (USE_CANVAS_FAKE_VIDEO) {
        this.localStream = buildCanvasFakeStream()
        rtcLog.sys(
          `本地媒体采集成功(canvas模拟): video=${this.localStream.getVideoTracks().length} audio=${this.localStream.getAudioTracks().length}`,
        )
        this.localStream.getTracks().forEach((t) => {
          rtcLog.sys(`  track: kind=${t.kind} enabled=${t.enabled} label=${t.label}`)
        })
        this.cb.onLocalStream?.(this.localStream)
        return
      }
      rtcLog.sys('请求摄像头/麦克风权限…')
      this.localStream = await navigator.mediaDevices.getUserMedia(MEDIA_CONSTRAINTS)
      rtcLog.sys(
        `本地媒体采集成功: video=${this.localStream.getVideoTracks().length} audio=${this.localStream.getAudioTracks().length}`,
      )
      // 输出轨道详情便于真机调试
      this.localStream.getTracks().forEach((t) => {
        rtcLog.sys(`  track: kind=${t.kind} enabled=${t.enabled} label=${t.label}`)
      })
      this.cb.onLocalStream?.(this.localStream)
    } catch (e: any) {
      rtcLog.err(`本地媒体采集失败: ${e?.name || ''} ${e?.message || e}`)
      throw e
    }
  }

  /**
   * 处理主叫 offer（核心：被叫媒体协商）
   *
   * 对齐 App index.uts handleOffer + SdpObserver：
   *   1. (兜底) 若未采集本地媒体，先采集
   *   2. 创建 PeerConnection
   *   3. 添加本地轨道
   *   4. setRemoteDescription(offer)
   *   5. createAnswer → setLocalDescription
   *   6. 发 cmd_answer (msg=SDP字符串, data={callLogId})
   *   7. 发 cmd_av_status
   */
  async handleOffer(fromUid: string, offerSdp: string): Promise<void> {
    if (this.phase !== 'idle' && this.phase !== 'connecting') {
      rtcLog.err(`handleOffer 时状态异常: phase=${this.phase}，忽略 offer`)
      return
    }
    // 如果 offer 来自不同 uid（异常），重置会话
    if (this.remoteUid && this.remoteUid !== fromUid) {
      rtcLog.err(`offer 来自 ${fromUid}，但当前会话主叫是 ${this.remoteUid}，拒绝`)
      return
    }
    if (!this.remoteUid) this.remoteUid = fromUid

    this.phase = 'connecting'
    rtcLog.sys(`收到 offer (来自 ${fromUid})，开始媒体协商`)
    rtcLog.sys(`offer SDP 长度=${offerSdp.length}`)

    try {
      // ① 兜底：若未采集本地媒体，先采集（对齐 App _createOffer 的兜底逻辑）
      if (!this.localStream) {
        await this.prepareLocalStream()
      }

      // ② 创建 PeerConnection（对齐 App createPeerConnection）
      this.pc = this.createPeerConnection()
      rtcLog.sys('RTCPeerConnection 已创建')

      // ③ 添加本地轨道（对齐 App peerConnection.addTrack）
      if (this.localStream) {
        this.localStream.getTracks().forEach((track) => {
          this.pc!.addTrack(track, this.localStream!)
          rtcLog.sys(`添加本地轨道: kind=${track.kind} id=${track.id}`)
        })
      }

      // ④ setRemoteDescription(offer)（对齐 App setRemoteDescription）
      await this.pc.setRemoteDescription({ type: 'offer', sdp: offerSdp })
      this.remoteDescriptionSet = true
      rtcLog.sys('已 setRemoteDescription(offer)')

      // 处理缓冲的 ICE candidates（offer 之前到达的）
      await this.flushIceCandidateBuffer()

      // ⑤ createAnswer → setLocalDescription（对齐 App onCreateSuccess/onSetSuccess）
      const answer = await this.pc.createAnswer()
      await this.pc.setLocalDescription(answer)
      const answerSdp = answer.sdp || ''
      rtcLog.sys(`已 createAnswer + setLocalDescription, answer SDP 长度=${answerSdp.length}`)

      // ⑥ 发 cmd_answer（对齐 App _sendAnswer: msg=SDP字符串, data={callLogId}）
      this.signal.sendAnswer(this.remoteUid, answerSdp, this.callLogId)

      // ⑦ 发 cmd_av_status（对齐 App handleOffer 后的 _broadcastAVStatus）
      this.signal.sendAvStatus(this.remoteUid, {
        mic: this.isMicEnabled(),
        cam: this.isCamEnabled(),
        mirror: false,
      })
    } catch (e: any) {
      rtcLog.err(`媒体协商失败: ${e?.name || ''} ${e?.message || e}`)
      this.cb.onFailed?.(e?.message || '媒体协商失败')
      this.stopCall(true)
    }
  }

  /**
   * 处理收到的 ICE candidate
   *
   * 对齐 App index.uts handleIce + WebRTCSDK.js _handleIceCandidate：
   *   若 remoteDescription 尚未设置，缓冲；否则立即 addIceCandidate
   */
  async handleRemoteIce(fromUid: string, candidate: { sdpMid: string; sdpMLineIndex: number; sdp: string }): Promise<void> {
    if (fromUid !== this.remoteUid) {
      rtcLog.sys(`忽略来自 ${fromUid} 的 ICE（当前主叫 ${this.remoteUid}）`)
      return
    }
    if (!this.pc) {
      rtcLog.sys('收到 ICE 但 PC 未建，忽略')
      return
    }
    // 远端描述未设置 → 缓冲
    if (!this.remoteDescriptionSet) {
      rtcLog.sys('remoteDescription 未设置，缓冲 ICE candidate')
      this.iceCandidateBuffer.push(candidate)
      return
    }
    try {
      await this.pc.addIceCandidate(new RTCIceCandidate({
        sdpMid: candidate.sdpMid,
        sdpMLineIndex: candidate.sdpMLineIndex,
        candidate: candidate.sdp,
      }))
      rtcLog.in(`addIceCandidate 成功`)
    } catch (e: any) {
      rtcLog.err(`addIceCandidate 失败: ${e?.message || e}`)
    }
  }

  /** 刷新缓冲的 ICE candidates */
  private async flushIceCandidateBuffer(): Promise<void> {
    while (this.iceCandidateBuffer.length > 0 && this.pc && this.remoteDescriptionSet) {
      const candidate = this.iceCandidateBuffer.shift()!
      try {
        await this.pc.addIceCandidate(new RTCIceCandidate({
          sdpMid: candidate.sdpMid,
          sdpMLineIndex: candidate.sdpMLineIndex,
          candidate: candidate.sdp,
        }))
      } catch (e: any) {
        rtcLog.err(`刷新缓冲 ICE 失败: ${e?.message || e}`)
      }
    }
  }

  /**
   * 创建 PeerConnection 并绑定事件（对齐 App createPeerConnection）
   */
  private createPeerConnection(): RTCPeerConnection {
    // 关闭旧的
    if (this.pc) {
      try {
        this.pc.close()
      } catch {}
      this.pc = null
    }

    const pc = new RTCPeerConnection(RTC_CONFIG)

    // ontrack → 远端流（对齐 App onAddStream + SurfaceViewRenderer）
    pc.ontrack = (event) => {
      const stream = (event.streams && event.streams[0]) || null
      rtcLog.sys(`★ ontrack: kind=${event.track.kind} stream=${stream ? '有' : '无'}`)
      if (stream) {
        this.cb.onRemoteStream?.(stream)
      }
    }

    // onicecandidate → 发 cmd_ice（对齐 App onIceCandidate → _sendIce）
    pc.onicecandidate = (event) => {
      if (event.candidate) {
        rtcLog.sys(`本地 ICE candidate: ${event.candidate.candidate.substring(0, 60)}…`)
        this.signal.sendIce(this.remoteUid, {
          sdpMid: event.candidate.sdpMid || '',
          sdpMLineIndex: event.candidate.sdpMLineIndex ?? 0,
          sdp: event.candidate.candidate,
        })
      } else {
        rtcLog.sys('ICE gathering 完成（无更多 candidate）')
      }
    }

    // oniceconnectionstatechange → 状态机（对齐 App onIceConnectionChange）
    pc.oniceconnectionstatechange = () => {
      const state = pc.iceConnectionState
      rtcLog.sys(`ICE 连接状态: ${state}`)
      this.cb.onIceStateChange?.(state)
      if (state === 'connected') {
        rtcLog.sys('✓✓✓ P2P/TURN 链路已建立! 通话成功!')
        this.phase = 'connected'
        this.cb.onConnected?.()
      } else if (state === 'failed') {
        rtcLog.err('ICE FAILED（TURN 可能不通或网络问题）')
        this.phase = 'ended'
        this.cb.onFailed?.('ICE 连接失败')
        this.stopCall(true)
      } else if (state === 'disconnected') {
        rtcLog.sys('ICE 断开，等待恢复（暂不清理）')
      } else if (state === 'closed') {
        this.phase = 'ended'
      }
    }

    pc.onconnectionstatechange = () => {
      rtcLog.sys(`PC 连接状态: ${pc.connectionState}`)
    }

    return pc
  }

  /**
   * 挂断/释放（对齐 App index.uts stopCall）
   *
   * 浏览器版极简：停止轨道 + 关闭 PC（无需释放 EGL/Camera/Renderer/SurfaceTexture）
   */
  stopCall(notifyServer: boolean): void {
    rtcLog.sys(`stopCall 开始, notifyServer=${notifyServer}, phase=${this.phase}`)
    const wasConnected = this.phase === 'connected' || this.phase === 'connecting'

    // 停止本地媒体（对齐 App videoCapturer.stopCapture + audioTrack.setEnabled(false)）
    if (this.localStream) {
      this.localStream.getTracks().forEach((t) => {
        try {
          t.stop()
        } catch {}
      })
      this.localStream = null
      rtcLog.sys('本地媒体轨道已停止')
    }

    // 关闭 PC（对齐 App peerConnection.close + dispose）
    if (this.pc) {
      try {
        this.pc.ontrack = null
        this.pc.onicecandidate = null
        this.pc.oniceconnectionstatechange = null
        this.pc.onconnectionstatechange = null
        this.pc.close()
      } catch {}
      this.pc = null
      rtcLog.sys('PeerConnection 已关闭')
    }

    // 发 cmd_hang_up（对齐 App _sendHangup）
    if (notifyServer && this.callLogId) {
      this.signal.sendHangup(this.callLogId)
    }

    // 重置状态
    this.remoteDescriptionSet = false
    this.iceCandidateBuffer = []
    this.remoteUid = ''
    this.callLogId = ''
    this.phase = 'idle'

    if (wasConnected || notifyServer) {
      this.cb.onEnded?.()
    }
  }

  // ====== 媒体控制（对齐 App setMicrophoneOn/setSpeakerOn）======

  /** 切换麦克风静音 */
  toggleMicrophone(): boolean {
    if (!this.localStream) return false
    const tracks = this.localStream.getAudioTracks()
    if (tracks.length === 0) return false
    const enabled = !tracks[0].enabled
    tracks[0].enabled = enabled
    rtcLog.sys(`麦克风 ${enabled ? '开启' : '静音'}`)
    this.signal.sendAvStatus(this.remoteUid, { mic: enabled, cam: this.isCamEnabled(), mirror: false })
    return enabled
  }

  /** 切换摄像头 */
  toggleCamera(): boolean {
    if (!this.localStream) return false
    const tracks = this.localStream.getVideoTracks()
    if (tracks.length === 0) return false
    const enabled = !tracks[0].enabled
    tracks[0].enabled = enabled
    rtcLog.sys(`摄像头 ${enabled ? '开启' : '关闭'}`)
    this.signal.sendAvStatus(this.remoteUid, { mic: this.isMicEnabled(), cam: enabled, mirror: false })
    return enabled
  }

  private isMicEnabled(): boolean {
    if (!this.localStream) return false
    const t = this.localStream.getAudioTracks()
    return t.length > 0 && t[0].enabled
  }

  private isCamEnabled(): boolean {
    if (!this.localStream) return false
    const t = this.localStream.getVideoTracks()
    return t.length > 0 && t[0].enabled
  }

  /** 当前状态 */
  getPhase(): CallEnginePhase {
    return this.phase
  }
  getLocalStream(): MediaStream | null {
    return this.localStream
  }
}
