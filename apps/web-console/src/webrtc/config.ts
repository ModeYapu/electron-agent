/**
 * 通话配置（来自 Android App config.uts + WebRTCSDK.js）
 *
 * 信令服务器、TURN/STUN、心跳重连等参数。
 * 移植自 yx-loan-webrtc-android-uniappx/script/config.uts
 */

// 信令服务器（App url_xl）
// 正式服: wss://polaris.yxqiche.com/aio-webrtc（默认）
// 测试服: wss://polaris.uat.yixincapital.com/aio-webrtc
// 通过 VITE_RTC_SIGNAL_URL 环境变量覆盖（UAT 联调时在 .env 设置）
const ENV = (typeof import.meta !== 'undefined' && (import.meta as any).env) || {}
const SIGNAL_URL =
  ENV.VITE_RTC_SIGNAL_URL || 'wss://polaris.yxqiche.com/aio-webrtc'

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

/**
 * 本地测试环境判断：是否用 canvas 模拟视频流。
 *
 * 背景：本地联调时，主叫端（Electron winRtc）与被叫端（web-console 浏览器）跑在同一台机器，
 * 只有一个物理摄像头，被叫 getUserMedia 会和 winRtc 抢占，导致 NotReadableError。
 * 因此本地环境（localhost / 127.0.0.1）被叫端用 canvas.captureStream() 生成假视频，
 * 把真实摄像头让给主叫端 winRtc。
 *
 * 生产环境（一体机 kiosk 与坐席 PC 物理分离）各自有摄像头，用真实 getUserMedia。
 */
const hostname = (typeof location !== 'undefined' && location.hostname) || ''
export const USE_CANVAS_FAKE_VIDEO = hostname === 'localhost' || hostname === '127.0.0.1'

/**
 * 构造 canvas 模拟视频流（含音频轨道）。
 *
 * canvas 绘制一个带坐席标识的占位画面（避免纯黑看不出是否通），
 * 通过 captureStream(30) 转 30fps 视频轨道；
 * 音频用 WebAudio 生成静默轨道（保证 SDP 协商 audio m-line 正常）。
 * 真机生产环境不用此函数。
 */
export function buildCanvasFakeStream(): MediaStream {
  // 视频：canvas 彩条 + 坐席标识
  const canvas = document.createElement('canvas')
  canvas.width = 640
  canvas.height = 360
  const ctx = canvas.getContext('2d')!

  // 静态背景 + 动态时间戳，方便主叫端确认画面在动
  const draw = () => {
    // ★ 预先镜像绘制：CallPanel 的 .local-video 有 transform:scaleX(-1)（真实摄像头镜像），
    //   canvas 文字被 CSS 镜像会反转。这里绘制时反向，CSS 镜像后抵消，文字正常显示。
    ctx.save()
    ctx.translate(canvas.width, 0)
    ctx.scale(-1, 1)

    // 渐变背景
    const grad = ctx.createLinearGradient(0, 0, canvas.width, canvas.height)
    grad.addColorStop(0, '#1e3a8a')
    grad.addColorStop(1, '#0f766e')
    ctx.fillStyle = grad
    ctx.fillRect(0, 0, canvas.width, canvas.height)

    // 标题
    ctx.fillStyle = '#ffffff'
    ctx.font = 'bold 28px sans-serif'
    ctx.textAlign = 'center'
    ctx.fillText('[被叫端 canvas 模拟视频]', canvas.width / 2, canvas.height / 2 - 20)

    // 动态时间戳（证明流是活的）
    ctx.font = '18px sans-serif'
    ctx.fillText(new Date().toLocaleTimeString(), canvas.width / 2, canvas.height / 2 + 20)

    ctx.font = '14px sans-serif'
    ctx.fillStyle = '#a7f3d0'
    ctx.fillText('本地测试环境：真实摄像头已让给主叫端', canvas.width / 2, canvas.height / 2 + 50)

    ctx.restore()
  }
  draw()
  const drawTimer = window.setInterval(draw, 1000)

  const videoStream = canvas.captureStream(30)
  const stream = new MediaStream(videoStream.getVideoTracks())

  // 音频：WebAudio 静默轨道（OscillatorNode → MediaStreamDestination）
  // 保证 SDP 协商时 audio m-line 存在，被叫麦克风静音不影响主叫听感
  try {
    const audioCtx = new AudioContext()
    const dest = audioCtx.createMediaStreamDestination()
    const oscillator = audioCtx.createOscillator()
    const gain = audioCtx.createGain()
    gain.gain.value = 0 // 静音（避免测试噪音）
    oscillator.connect(gain)
    gain.connect(dest)
    oscillator.start()
    dest.stream.getAudioTracks().forEach((t) => stream.addTrack(t))
    // drawTimer 与 oscillator 随 track ended 自动停止（挂断时 stopCall 会 stop 所有 track）
    stream.getTracks().forEach((t) => {
      t.addEventListener('ended', () => {
        window.clearInterval(drawTimer)
        try { oscillator.stop() } catch {}
        try { audioCtx.close() } catch {}
      })
    })
  } catch (e) {
    // AudioContext 创建失败（极少见）则只有视频，不影响主链路
    console.warn('[RTC] canvas 模拟音频轨道创建失败，仅视频', e)
  }

  return stream
}
