/**
 * 控制台日志存储
 */

import type { ConsoleLog } from '@electron-agent/shared';

export interface ConsoleLogDetail extends ConsoleLog {
  id: string;
  deviceId: string;
  source?: 'console' | 'network';
}

export class ConsoleStore {
  private logs: Map<string, ConsoleLogDetail[]> = new Map();
  private maxLogsPerDevice: number;

  constructor(maxLogsPerDevice: number = 500) {
    this.maxLogsPerDevice = maxLogsPerDevice;
  }

  addLog(deviceId: string, log: ConsoleLog, source: 'console' | 'network' = 'console'): void {
    if (!this.logs.has(deviceId)) {
      this.logs.set(deviceId, []);
    }

    const deviceLogs = this.logs.get(deviceId)!;
    const logDetail: ConsoleLogDetail = {
      id: `${deviceId}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      deviceId,
      ...log,
      source,
    };

    deviceLogs.push(logDetail);

    // 保持日志数量在限制内
    if (deviceLogs.length > this.maxLogsPerDevice) {
      deviceLogs.splice(0, deviceLogs.length - this.maxLogsPerDevice);
    }
  }

  getDeviceLogs(deviceId: string, limit?: number): ConsoleLogDetail[] {
    const deviceLogs = this.logs.get(deviceId) || [];
    if (limit) {
      return deviceLogs.slice(-limit);
    }
    return [...deviceLogs];
  }

  getFilteredLogs(
    deviceId: string,
    filters: {
      level?: ConsoleLog['level'];
      limit?: number;
      offset?: number;
    } = {}
  ): ConsoleLogDetail[] {
    let deviceLogs = this.logs.get(deviceId) || [];

    if (filters.level) {
      deviceLogs = deviceLogs.filter(log => log.level === filters.level);
    }

    const offset = filters.offset || 0;
    const limit = filters.limit || 50;
    const sliced = deviceLogs.slice(offset, offset + limit);

    return sliced;
  }

  getAllLogs(): Map<string, ConsoleLogDetail[]> {
    return new Map(this.logs);
  }

  clearDevice(deviceId: string): void {
    this.logs.delete(deviceId);
  }

  clear(): void {
    this.logs.clear();
  }
}
