/**
 * 被叫信令客户端
 *
 * 移植自 Android App：
 *   - yx-loan-webrtc-android-uniappx/script/websocketEx.uts  (WS 封装 + 重连 + 心跳)
 *   - yx-loan-webrtc-android-uniappx/script/webrtcUtil.uts   (cmd_* 命令路由 + _loginServer)
 *
 * 被叫端协议（与主叫端 WebRTCSDK 互补）：
 *   连接: WS = signalUrl + "/ws/signal?roomId={手机号}&uid={手机号}"
 *   登录: cmd_login { uid, roomId, from:'APP' }
 *   登录成功: 收到 cmd_current_peers
 *   来电: 收 cmd_start_call { uid(主叫), msg(客户信息), data:{callLogId} }
 *   接听: 发 cmd_join_room
 *   媒体协商: 收 cmd_offer(主叫主动发) → 发 cmd_answer + cmd_ice
 *
 * 注意：被叫不主动 createOffer，是"收 offer 再 answer"。
 */

import { SIGNAL_CONFIG } from './config'
import { rtcLog } from './log'

// cmd 常量（对齐 App webrtcUtil.uts）
export const CMD = {
  ping: 'cmd_ping',
  pong: 'cmd_pong',
  login: 'cmd_login',
  currentPeers: 'cmd_current_peers',
  peerJoin: 'cmd_peer_join',
  peerLeave: 'cmd_peer_leave',
  startCall: 'cmd_start_call',
  joinRoom: 'cmd_join_room',
  newPeer: 'cmd_new_peer',
  offer: 'cmd_offer',
  avStatus: 'cmd_av_status',
  ice: 'cmd_ice',
  answer: 'cmd_answer',
  hangUp: 'cmd_hang_up',
  error: 'cmd_error',
  telStatus: 'cmd_tel_status',
} as const

/** 来电业务信息（cmd_start_call.msg） */
export interface CallIncomingInfo {
  name?: string
  station?: string
  order_id?: string
  phone?: string
  account?: string
  idcard?: string
  current_node?: string
  finance_info?: {
    periods?: string
    carInfo?: string
    amount?: string
    month_pay?: string
  }
  [k: string]: any
}

/** 信令消息（宽松类型，按 cmd 分发） */
export type SignalMessage = {
  cmd: string
  uid?: string
  remoteUid?: string
  roomId?: string
  msg?: any
  data?: any
}

/** 信令事件回调 */
export interface SignalClientCallbacks {
  /** 登录成功（cmd_current_peers） */
  onLoginOk?: (clientChannel: string, clientStation: string) => void
  /** 来电（cmd_start_call） */
  onIncomingCall?: (clientUid: string, callLogId: string, info: CallIncomingInfo) => void
  /** 主叫进房间（cmd_new_peer） */
  onNewPeer?: (uid: string) => void
  /** 收到主叫 offer（cmd_offer，msg 为 SDP 字符串） */
  onOffer?: (fromUid: string, sdp: string) => void
  /** 收到 answer（被叫一般不会收到，但保留） */
  onAnswer?: (fromUid: string, sdp: string) => void
  /** 收到 ICE（cmd_ice，msg = {sdpMid, sdpMLineIndex, sdp}） */
  onIce?: (fromUid: string, candidate: { sdpMid: string; sdpMLineIndex: number; sdp: string }) => void
  /** 对端音视频状态（cmd_av_status，mirror/mic/cam） */
  onAvStatus?: (fromUid: string, settings: any) => void
  /** 对端挂断（cmd_hang_up） */
  onHangup?: () => void
  /** 服务器错误（cmd_error） */
  onError?: (type: string, message?: string) => void
  /** WS 连接状态 */
  onOpen?: () => void
  onClose?: (code: number, reason: string) => void
  onError_ws?: (error: any) => void
}

/**
 * 被叫信令客户端
 *
 * 用法：
 *   const sc = new SignalClient()
 *   sc.bind({ onIncomingCall: ..., onOffer: ..., ... })
 *   sc.connect('13800001234', '13800001234')  // uid = roomId = 坐席手机号
 *   sc.sendJoinRoom()                          // 接听
 */
export class SignalClient {
  private ws: WebSocket | null = null
  private uid = ''
  private roomId = ''
  private cb: SignalClientCallbacks = {}

  // 心跳（websocketEx.uts）
  private heartbeatTimer: number | null = null
  private heartbeatSentCount = 0
  private lastPongAt = 0

  // 重连（websocketEx.uts handleReconnect）
  private reconnectTimer: number | null = null
  private reconnectCount = 0
  private reconnectEnabled = true

  // 登录（webrtcUtil.uts _loginServer: 多重试防服务端收不到）
  private loginTimer: number | null = null
  private isLoginOk = false

  /** 绑定事件回调 */
  bind(callbacks: SignalClientCallbacks) {
    this.cb = { ...this.cb, ...callbacks }
  }

  /** 连接信令服务器 */
  connect(uid: string, roomId: string): void {
    this.uid = uid
    this.roomId = roomId
    rtcLog.sys(`连接信令: uid=${uid}, roomId=${roomId}`)

    // 先清理旧连接
    this.closeInternal(false)

    // App websocketEx.uts connect(): url?roomId=&uid=
    const url = `${SIGNAL_CONFIG.url}/ws/signal?roomId=${encodeURIComponent(roomId)}&uid=${encodeURIComponent(uid)}`
    rtcLog.sys(`WebSocket URL: ${url}`)

    this.isLoginOk = false
    this.reconnectEnabled = true
    this.reconnectCount = 0

    try {
      this.ws = new WebSocket(url)
    } catch (e: any) {
      rtcLog.err(`WebSocket 创建异常: ${e?.message || e}`)
      this.cb.onError_ws?.(e)
      return
    }

    this.ws.onopen = () => {
      rtcLog.sys('WebSocket onopen: 连接成功')
      this.lastPongAt = Date.now()
      this.heartbeatSentCount = 0
      this.startHeartbeat()
      this.cb.onOpen?.()
      // App _loginServer: onOpen 后登录，多重试防丢
      this.login()
      window.setTimeout(() => {
        if (!this.isLoginOk) {
          rtcLog.sys('500ms 后重试登录（防服务端未收到）')
          this.login()
        }
      }, 500)
      this.loginTimer = window.setTimeout(() => {
        this.loginTimer = null
        if (!this.isLoginOk) {
          rtcLog.sys('5s 后重试登录（防服务端未收到）')
          this.login()
        }
      }, 5000)
    }

    this.ws.onmessage = (event) => {
      let msg: SignalMessage
      try {
        msg = JSON.parse(event.data)
      } catch (e) {
        rtcLog.err(`消息 JSON 解析失败: ${event.data}`)
        return
      }
      // 心跳响应单独处理（不打日志，避免刷屏）
      if (msg.cmd === CMD.pong) {
        this.onPong()
        return
      }
      rtcLog.in(`cmd=${msg.cmd}`, msg)
      this.handleMessage(msg)
    }

    this.ws.onerror = (e) => {
      rtcLog.err('WebSocket onerror（检查地址/网络/证书/Origin）')
      this.cb.onError_ws?.(e)
    }

    this.ws.onclose = (event) => {
      const code = event.code
      const reason = event.reason || ''
      rtcLog.sys(`WebSocket onclose: code=${code} reason=${reason}${code === 4000 ? ' (重复连接，禁重连)' : ''}`)
      this.stopHeartbeat()
      this.clearLoginTimer()
      // App websocketEx: code 4000 = 重复连接，禁重连
      if (code === 4000) this.reconnectEnabled = false
      this.cb.onClose?.(code, reason)
      this.handleReconnect()
    }
  }

  /** 主动断开（不重连） */
  disconnect(): void {
    rtcLog.sys('主动断开信令')
    this.closeInternal(true)
  }

  /** 发送消息（对齐 App _websocket.send） */
  send(message: Record<string, any>): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      rtcLog.err(`发送失败(WS未连接): cmd=${message.cmd}`)
      return
    }
    try {
      const json = JSON.stringify(message)
      this.ws.send(json)
      if (message.cmd !== CMD.ping) rtcLog.out(`cmd=${message.cmd}`, message)
    } catch (e: any) {
      rtcLog.err(`发送异常: ${e?.message || e}`)
    }
  }

  // ====== 主动指令（对齐 App webrtcUtil）======

  /** 登录（cmd_login，from:'APP' 标识被叫端） */
  login(): void {
    this.send({ cmd: CMD.login, uid: this.uid, roomId: this.roomId, from: 'APP' })
  }

  /** 接听（cmd_join_room，对齐 App doAccept） */
  sendJoinRoom(): void {
    this.send({ cmd: CMD.joinRoom, uid: this.uid, roomId: this.roomId })
  }

  /** 回复 answer（cmd_answer，对齐 App _sendAnswer，msg=SDP字符串，data={callLogId}） */
  sendAnswer(remoteUid: string, sdp: string, callLogId: string): void {
    this.send({
      cmd: CMD.answer,
      uid: this.uid,
      remoteUid,
      roomId: this.roomId,
      msg: sdp,
      data: { callLogId },
    })
  }

  /** 发送 ICE（cmd_ice，对齐 App _sendIce，msg={sdpMid,sdpMLineIndex,sdp}） */
  sendIce(remoteUid: string, candidate: { sdpMid: string; sdpMLineIndex: number; sdp: string }): void {
    this.send({
      cmd: CMD.ice,
      uid: this.uid,
      remoteUid,
      roomId: this.roomId,
      msg: candidate,
    })
  }

  /** 挂断（cmd_hang_up，对齐 App _sendHangup，data={callLogId}） */
  sendHangup(callLogId: string): void {
    this.send({
      cmd: CMD.hangUp,
      uid: this.uid,
      roomId: this.roomId,
      data: { callLogId },
    })
  }

  /** 发送音视频状态（cmd_av_status，对齐 App broadcastAv） */
  sendAvStatus(remoteUid: string, settings: { mic: boolean; cam: boolean; mirror: boolean }): void {
    this.send({
      cmd: CMD.avStatus,
      uid: this.uid,
      remoteUid,
      roomId: this.roomId,
      msg: { is_share: false, ...settings },
    })
  }

  // ====== 私有：消息分发（对齐 App webrtcUtil listener + index.uts handleNetEvent）======

  private handleMessage(message: SignalMessage): void {
    switch (message.cmd) {
      case CMD.currentPeers: {
        // App _handleLoginSuccess: 登录成功，返回客户渠道信息
        this.isLoginOk = true
        this.clearLoginTimer()
        const msg = (message.msg || {}) as any
        const clientChannel = msg.cus_channel || ''
        const clientStation = msg.cus_node || ''
        rtcLog.sys(`✓ 登录成功! 客户渠道=${clientChannel} 站点=${clientStation}`)
        this.cb.onLoginOk?.(clientChannel, clientStation)
        break
      }

      case CMD.startCall: {
        // App _handleUserCall: 来电!
        const fromUid = String(message.uid || '')
        const callLogId = String(message.data?.callLogId || '')
        const info = (message.msg || {}) as CallIncomingInfo
        rtcLog.sys(`✓ 收到来电! from=${fromUid} callLogId=${callLogId}`)
        this.cb.onIncomingCall?.(fromUid, callLogId, info)
        break
      }

      case CMD.newPeer: {
        // App webrtcUtil: state.clientUid = jsonData['uid']
        const uid = String(message.uid || '')
        rtcLog.sys(`主叫进房间: uid=${uid}`)
        this.cb.onNewPeer?.(uid)
        break
      }

      case CMD.offer: {
        // App index.uts handleNetEvent: cmd_offer → handleOffer
        // 被叫收主叫 offer，msg 是 SDP 字符串
        const fromUid = String(message.uid || '')
        const sdp = typeof message.msg === 'string' ? message.msg : message.msg?.sdp || ''
        rtcLog.in(`收到 offer, sdp 长度=${sdp.length}`)
        this.cb.onOffer?.(fromUid, sdp)
        break
      }

      case CMD.answer: {
        // 被叫一般不收 answer，但兼容
        const fromUid = String(message.uid || '')
        const sdp = typeof message.msg === 'string' ? message.msg : message.msg?.sdp || ''
        this.cb.onAnswer?.(fromUid, sdp)
        break
      }

      case CMD.ice: {
        // App index.uts handleIce: msg = { sdpMid, sdpMLineIndex, sdp }
        const fromUid = String(message.uid || '')
        const candidate = message.msg as { sdpMid: string; sdpMLineIndex: number; sdp: string }
        rtcLog.in(`收到 ICE, from=${fromUid}`, candidate)
        this.cb.onIce?.(fromUid, candidate)
        break
      }

      case CMD.avStatus: {
        // App handleAVStatus: mirror/mic/cam
        const fromUid = String(message.uid || '')
        const settings = message.msg || {}
        this.cb.onAvStatus?.(fromUid, settings)
        break
      }

      case CMD.hangUp: {
        // App _handleUserHangup
        rtcLog.sys('收到对端挂断 cmd_hang_up')
        this.cb.onHangup?.()
        break
      }

      case CMD.error: {
        // App _handleServerError: msg.type
        const msgObj = (message.msg || {}) as any
        const type = typeof msgObj === 'string' ? msgObj : msgObj.type || ''
        const messageText = typeof msgObj === 'string' ? msgObj : msgObj.message || msgObj.error || ''
        rtcLog.err(`服务器错误: type=${type} message=${messageText}`)
        this.cb.onError?.(type, messageText)
        break
      }

      case CMD.peerLeave: {
        rtcLog.sys(`对端离开: ${JSON.stringify(message.msg)}`)
        break
      }

      default:
        rtcLog.sys(`未处理的 cmd: ${message.cmd}`, message)
    }
  }

  // ====== 私有：心跳（对齐 websocketEx.uts startHeartbeat）======

  private startHeartbeat(): void {
    this.stopHeartbeat()
    this.lastPongAt = Date.now()
    this.heartbeatSentCount = 0
    this.heartbeatTimer = window.setInterval(() => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return
      // websocketEx.uts: 心跳超时 3 次 → 判定断开重连
      if (this.heartbeatSentCount >= 3) {
        rtcLog.err('心跳超时 3 次，主动关闭重连')
        try {
          this.ws.close()
        } catch {}
        return
      }
      this.heartbeatSentCount++
      this.send({ cmd: CMD.ping, uid: this.uid, roomId: this.roomId, timestamp: Date.now() })
    }, SIGNAL_CONFIG.heartbeatInterval)
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer)
      this.heartbeatTimer = null
    }
  }

  private onPong(): void {
    this.heartbeatSentCount = 0
    this.lastPongAt = Date.now()
    // websocketEx/App: pong 时若未登录则补登录
    if (!this.isLoginOk) {
      rtcLog.sys('收到 pong 但未登录，补发 cmd_login')
      this.login()
    }
  }

  // ====== 私有：重连（对齐 websocketEx.uts handleReconnect）======

  private handleReconnect(): void {
    this.stopHeartbeat()
    this.clearReconnectTimer()
    if (!this.reconnectEnabled) {
      rtcLog.sys('reconnectEnabled=false，不再重连')
      return
    }
    if (this.reconnectCount >= SIGNAL_CONFIG.reconnectMax) {
      rtcLog.err(`达到最大重连次数 ${SIGNAL_CONFIG.reconnectMax}，停止`)
      return
    }
    this.reconnectCount++
    rtcLog.sys(`第 ${this.reconnectCount} 次重连，${SIGNAL_CONFIG.reconnectInterval}ms 后...`)
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null
      this.connect(this.uid, this.roomId)
    }, SIGNAL_CONFIG.reconnectInterval)
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
  }

  private clearLoginTimer(): void {
    if (this.loginTimer) {
      clearTimeout(this.loginTimer)
      this.loginTimer = null
    }
  }

  /** 关闭内部 */
  private closeInternal(suppressReconnect: boolean): void {
    if (suppressReconnect) this.reconnectEnabled = false
    this.stopHeartbeat()
    this.clearReconnectTimer()
    this.clearLoginTimer()
    if (this.ws) {
      // 移除监听避免触发 onclose 重连
      this.ws.onopen = null
      this.ws.onmessage = null
      this.ws.onerror = null
      this.ws.onclose = null
      try {
        this.ws.close()
      } catch {}
      this.ws = null
    }
    this.isLoginOk = false
  }

  /** 当前是否已连接 */
  isOpen(): boolean {
    return !!this.ws && this.ws.readyState === WebSocket.OPEN
  }

  /** 当前 uid（坐席手机号） */
  getUid(): string {
    return this.uid
  }
}
