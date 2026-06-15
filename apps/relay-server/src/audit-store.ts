/**
 * 审计日志存储
 */

export interface AuditEvent {
  type: 'connect' | 'disconnect' | 'screenshot' | 'click' | 'type' | 'navigate' | 'eval';
  deviceId: string;
  operatorId: string;
  timestamp: number;
  detail: string;
}

export class AuditStore {
  private events: AuditEvent[] = [];
  private maxSize: number;

  constructor(maxSize: number = 10000) {
    this.maxSize = maxSize;
  }

  log(event: AuditEvent): void {
    this.events.push(event);

    // 保持日志大小在限制内
    if (this.events.length > this.maxSize) {
      this.events = this.events.slice(-this.maxSize);
    }
  }

  getEvents(limit?: number): AuditEvent[] {
    if (limit) {
      return this.events.slice(-limit);
    }
    return [...this.events];
  }

  getDeviceEvents(deviceId: string, limit?: number): AuditEvent[] {
    const deviceEvents = this.events.filter(e => e.deviceId === deviceId);
    if (limit) {
      return deviceEvents.slice(-limit);
    }
    return deviceEvents;
  }

  getRecentEvents(minutes: number = 60): AuditEvent[] {
    const cutoff = Date.now() - minutes * 60 * 1000;
    return this.events.filter(e => e.timestamp > cutoff);
  }

  clear(): void {
    this.events = [];
  }
}
