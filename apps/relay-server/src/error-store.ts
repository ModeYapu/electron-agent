/**
 * JS 错误存储
 */

import type { JSError } from '@electron-agent/shared';

export interface JSErrorDetail extends JSError {
  id: string;
  deviceId: string;
  url?: string;
  line?: number;
  col?: number;
  errorType?: string;
}

export class ErrorStore {
  private errors: Map<string, JSErrorDetail[]> = new Map();
  private maxErrorsPerDevice: number;

  constructor(maxErrorsPerDevice: number = 200) {
    this.maxErrorsPerDevice = maxErrorsPerDevice;
  }

  addError(deviceId: string, error: JSError, detail: Partial<JSErrorDetail> = {}): void {
    if (!this.errors.has(deviceId)) {
      this.errors.set(deviceId, []);
    }

    const deviceErrors = this.errors.get(deviceId)!;
    const errorDetail: JSErrorDetail = {
      id: `${deviceId}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      deviceId,
      ...error,
      ...detail,
    };

    deviceErrors.push(errorDetail);

    // 保持错误数量在限制内
    if (deviceErrors.length > this.maxErrorsPerDevice) {
      deviceErrors.splice(0, deviceErrors.length - this.maxErrorsPerDevice);
    }
  }

  getDeviceErrors(deviceId: string, limit?: number): JSErrorDetail[] {
    const deviceErrors = this.errors.get(deviceId) || [];
    if (limit) {
      return deviceErrors.slice(-limit);
    }
    return [...deviceErrors];
  }

  getFilteredErrors(
    deviceId: string,
    filters: {
      from?: number;
      to?: number;
      limit?: number;
      offset?: number;
    } = {}
  ): JSErrorDetail[] {
    let deviceErrors = this.errors.get(deviceId) || [];

    if (filters.from) {
      deviceErrors = deviceErrors.filter(err => err.timestamp >= (filters.from as number));
    }

    if (filters.to) {
      deviceErrors = deviceErrors.filter(err => err.timestamp <= (filters.to as number));
    }

    const offset = filters.offset || 0;
    const limit = filters.limit || 50;
    const sliced = deviceErrors.slice(offset, offset + limit);

    return sliced;
  }

  getAllErrors(): Map<string, JSErrorDetail[]> {
    return new Map(this.errors);
  }

  clearDevice(deviceId: string): void {
    this.errors.delete(deviceId);
  }

  clear(): void {
    this.errors.clear();
  }
}
