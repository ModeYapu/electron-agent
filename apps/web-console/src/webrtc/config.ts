/**
 * 通话配置（来自 Android App config.uts + WebRTCSDK.js）
 *
 * 信令服务器、TURN/STUN、心跳重连等参数。
 * 移植自 yx-loan-webrtc-android-uniappx/script/config.uts
 */

// 信令服务器（App url_xl）
// 测试服: wss://polaris.uat.yixincapital.com/aio-webrtc
// 正式服: wss://polaris.yxqiche.com/aio-webrtc
// 可通过 VITE_RTC_SIGNAL_URL 环境变量覆盖
const ENV = (typeof import.meta !== 'undefined' && (import.meta as any).env) || {}
const SIGNAL_URL =
  ENV.VITE_RTC_SIGNAL_URL || 'wss://polaris.uat.yixincapital.com/aio-webrtc'

// ICE 服务器（App config.uts webrtcServers）
const ICE_SERVERS: RTCIceServer[] = [
  { urls: 'stun:turn.yxqiche.com:8478' },
  { urls: 'turn:turn.yxqiche.com:8478', username: 'webrtc', credential: '85Y3KrjFaLraKdnV' },
  { urls: 'turn:turn.yxqiche.com:8478?transport=tcp', username: 'webrtc', credential: '85Y3KrjFaLraKdnV' },
]

// RTC PeerConnection 配置（对齐 WebRTCSDK.js _getOptimizedIceConfig）
export const RTC_CONFIG: RTCConfiguration = {
  iceServers: ICE_SERVERS,
  iceTransportPolicy: 'all',
  iceCandidatePoolSize: 5,
  bundlePolicy: 'max-bundle',
  rtcpMuxPolicy: 'require',
}

// 信令参数（对齐 App websocketEx.uts）
export const SIGNAL_CONFIG = {
  url: SIGNAL_URL,
  // websocketEx.uts: heartbeatInterval = 5000
  heartbeatInterval: 5000,
  // websocketEx.uts: reconnectInterval = 6000
  reconnectInterval: 6000,
  // websocketEx.uts: reconnectCountMax = 3
  reconnectMax: 3,
  // App: 连接超时
  connectTimeout: 10000,
  // App: 无人接听超时 15s（来电视铃后若坐席不接，主叫会超时；本端用作振铃兜底）
  noAnswerTimeout: 15000,
}

// 本地媒体约束（对齐 App index.uts initVideoTrack + initLocalAudio）
export const MEDIA_CONSTRAINTS: MediaStreamConstraints = {
  video: {
    width: { ideal: 1280 },
    height: { ideal: 720 },
    facingMode: 'user',
  } as MediaTrackConstraints,
  audio: {
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
    sampleRate: 48000,
    channelCount: 1,
  } as MediaTrackConstraints,
}

// 日志开关（真机调试时可随时 console 修改 window.__RTC_DEBUG__）
export const RTC_DEBUG = true
