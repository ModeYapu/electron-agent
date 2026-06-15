/**
 * 设备注册中心
 * 管理所有连接的设备信息
 */

import { EventEmitter } from 'events';
import type { Device, DeviceInfo, PageState } from '@electron-agent/shared';

export class DeviceRegistry extends EventEmitter {
  private devices: Map<string, Device> = new Map();

  register(deviceInfo: DeviceInfo): void {
    const device: Device = {
      info: deviceInfo,
      status: 'online',
      lastSeen: Date.now(),
    };

    this.devices.set(deviceInfo.deviceId, device);
    this.emit('deviceRegistered', device);
    this.emit('devicesUpdated', this.getAllDevices());
  }

  unregister(deviceId: string): void {
    const device = this.devices.get(deviceId);
    if (device) {
      device.status = 'offline';
      device.lastSeen = Date.now();
      this.emit('deviceOffline', device);
      this.emit('devicesUpdated', this.getAllDevices());
    }
  }

  updateHeartbeat(deviceId: string): void {
    const device = this.devices.get(deviceId);
    if (device) {
      device.lastSeen = Date.now();
      if (device.status === 'offline') {
        device.status = 'online';
        this.emit('deviceOnline', device);
        this.emit('devicesUpdated', this.getAllDevices());
      }
    }
  }

  updatePageState(deviceId: string, pageState: PageState): void {
    const device = this.devices.get(deviceId);
    if (device) {
      device.currentPage = pageState;
      this.emit('deviceUpdated', device);
    }
  }

  getDevice(deviceId: string): Device | undefined {
    return this.devices.get(deviceId);
  }

  getAllDevices(): Device[] {
    return Array.from(this.devices.values());
  }

  getOnlineDevices(): Device[] {
    return this.getAllDevices().filter(d => d.status === 'online');
  }

  cleanupStaleDevices(timeoutMs: number = 120000): void {
    const now = Date.now();
    const staleDevices: string[] = [];

    for (const [deviceId, device] of this.devices.entries()) {
      if (device.status === 'online' && (now - device.lastSeen) > timeoutMs) {
        device.status = 'offline';
        device.lastSeen = now;
        this.emit('deviceOffline', device);
        staleDevices.push(deviceId);
      }
    }

    if (staleDevices.length > 0) {
      this.emit('devicesUpdated', this.getAllDevices());
    }
  }
}
