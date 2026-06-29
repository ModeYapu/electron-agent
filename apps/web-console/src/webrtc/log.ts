/**
 * 通话模块日志工具
 *
 * 所有通话相关日志统一带 [RTC] 前缀，便于在浏览器控制台筛选过滤。
 * 真机调试时可通过 console 打开/关闭：window.__RTC_DEBUG__ = true/false
 */

declare global {
  interface Window {
    __RTC_DEBUG__?: boolean
  }
}

const PREFIX = '%c[RTC]'
const STYLES = {
  sys: 'color:#ffd700;font-weight:bold',
  in: 'color:#4ade80',
  out: 'color:#61affe',
  err: 'color:#ff6b6b;font-weight:bold',
  info: 'color:#9cdcfe',
}

function enabled(): boolean {
  return typeof window !== 'undefined' ? window.__RTC_DEBUG__ !== false : true
}

function ts(): string {
  const d = new Date()
  const pad = (n: number, l = 2) => String(n).padStart(l, '0')
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`
}

export const rtcLog = {
  sys(msg: string, ...args: any[]) {
    if (enabled()) console.log(`${PREFIX} ${ts()} ${msg}`, STYLES.sys, ...args)
  },
  /** 收到信令消息 */
  in(msg: string, ...args: any[]) {
    if (enabled()) console.log(`${PREFIX} ◀ ${ts()} ${msg}`, STYLES.in, ...args)
  },
  /** 发送信令消息 */
  out(msg: string, ...args: any[]) {
    if (enabled()) console.log(`${PREFIX} ▶ ${ts()} ${msg}`, STYLES.out, ...args)
  },
  err(msg: string, ...args: any[]) {
    if (enabled()) console.error(`${PREFIX} ✖ ${ts()} ${msg}`, STYLES.err, ...args)
  },
  info(msg: string, ...args: any[]) {
    if (enabled()) console.log(`${PREFIX} ${ts()} ${msg}`, STYLES.info, ...args)
  },
}

// 默认开启调试
if (typeof window !== 'undefined' && window.__RTC_DEBUG__ === undefined) {
  window.__RTC_DEBUG__ = true
}
