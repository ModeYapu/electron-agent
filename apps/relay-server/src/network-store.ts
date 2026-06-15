/**
 * 网络请求存储
 */

import type { NetworkRequest } from '@electron-agent/shared';

export interface NetworkRequestDetail extends Omit<NetworkRequest, 'timing' | 'requestBody' | 'responseBody'> {
  id: string;
  deviceId: string;
  initiator?: string;
  resourceType?: string;
  fromCache?: boolean;
  timing?: {
    dns: number;
    tcp: number;
    ttfb: number;
    download: number;
  };
  requestBody?: {
    size: number;
    preview?: string;
  };
  responseBody?: {
    size: number;
    preview?: string;
  };
}

export class NetworkStore {
  private requests: Map<string, NetworkRequestDetail[]> = new Map();
  private maxRequestsPerDevice: number;

  constructor(maxRequestsPerDevice: number = 500) {
    this.maxRequestsPerDevice = maxRequestsPerDevice;
  }

  addRequest(deviceId: string, request: NetworkRequest, detail: Partial<NetworkRequestDetail> = {}): void {
    if (!this.requests.has(deviceId)) {
      this.requests.set(deviceId, []);
    }

    const deviceRequests = this.requests.get(deviceId)!;
    const { timing: _t, requestBody: _rb, responseBody: _rb2, ...rest } = request;
    const requestDetail: NetworkRequestDetail = {
      id: `${deviceId}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      deviceId,
      ...rest,
      ...detail,
    };

    deviceRequests.push(requestDetail);

    // 保持请求数量在限制内
    if (deviceRequests.length > this.maxRequestsPerDevice) {
      deviceRequests.splice(0, deviceRequests.length - this.maxRequestsPerDevice);
    }
  }

  getDeviceRequests(deviceId: string, limit?: number): NetworkRequestDetail[] {
    const deviceRequests = this.requests.get(deviceId) || [];
    if (limit) {
      return deviceRequests.slice(-limit);
    }
    return [...deviceRequests];
  }

  getFilteredRequests(
    deviceId: string,
    filters: {
      status?: string;
      method?: string;
      limit?: number;
      offset?: number;
    } = {}
  ): NetworkRequestDetail[] {
    let deviceRequests = this.requests.get(deviceId) || [];

    if (filters.status) {
      const statusPrefix = filters.status;
      deviceRequests = deviceRequests.filter(req =>
        req.status.toString().startsWith(statusPrefix)
      );
    }

    if (filters.method) {
      deviceRequests = deviceRequests.filter(req => req.method === filters.method);
    }

    const offset = filters.offset || 0;
    const limit = filters.limit || 50;
    const sliced = deviceRequests.slice(offset, offset + limit);

    return sliced;
  }

  getAllRequests(): Map<string, NetworkRequestDetail[]> {
    return new Map(this.requests);
  }

  clearDevice(deviceId: string): void {
    this.requests.delete(deviceId);
  }

  clear(): void {
    this.requests.clear();
  }
}
