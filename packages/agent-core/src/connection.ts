/**
 * WebSocket 连接管理器
 * 维护 Agent 与中继服务器的连接
 */

import WebSocket from 'ws';
import { EventEmitter } from 'events';
import type { AgentUpstreamMessage, ServerDownstreamMessage } from '@electron-agent/shared';

export interface ConnectionConfig {
  serverUrl: string;
  agentToken: string;
  reconnectInterval: number;
  heartbeatInterval: number;
  maxReconnectInterval?: number; // Max reconnect delay (default: 60000)
  reconnectBackoffFactor?: number; // Backoff multiplier (default: 2)
}

export class ConnectionManager extends EventEmitter {
  private ws: WebSocket | null = null;
  private connected = false;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private currentReconnectDelay: number;
  private readonly maxReconnectDelay: number;
  private readonly backoffFactor: number;
  // P2 CONNECTION LIFECYCLE: true only when disconnect() was explicitly called.
  // An intentional close must NOT trigger exponential-backoff reconnect; only
  // an unexpected close (server drop / network error) reconnects.
  private intentionalClose = false;

  constructor(private config: ConnectionConfig) {
    super();
    this.currentReconnectDelay = config.reconnectInterval;
    this.maxReconnectDelay = config.maxReconnectInterval || 60000;
    this.backoffFactor = config.reconnectBackoffFactor || 2;
  }

  connect(deviceId: string): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      return;
    }

    // Starting a fresh connection clears any prior intentional-close intent.
    this.intentionalClose = false;

    const wsUrl = `${this.config.serverUrl}?deviceId=${deviceId}`;
    this.ws = new WebSocket(wsUrl);

    this.ws.on('open', () => {
      // Send authentication as first message instead of URL parameter
      this.ws!.send(JSON.stringify({ type: 'auth', token: this.config.agentToken, deviceId }));
      this.connected = true;
      this.currentReconnectDelay = this.config.reconnectInterval; // Reset backoff on success
      this.emit('connected');
      this.startHeartbeat(deviceId);
    });

    this.ws.on('message', (data: Buffer) => {
      try {
        const message = JSON.parse(data.toString()) as ServerDownstreamMessage;
        this.emit('command', message);
      } catch (err) {
        console.error('Failed to parse server message:', err);
      }
    });

    this.ws.on('error', (err: Error) => {
      console.error('WebSocket error:', err);
      this.emit('error', err);
      // NOTE: do not reconnect here. ws always fires a 'close' after 'error',
      // and reconnect logic lives in the close handler where intentionalClose
      // is known. Reconnecting here would double-schedule on top of close.
    });

    this.ws.on('close', () => {
      this.connected = false;
      this.stopHeartbeat();
      this.emit('disconnected');

      // Only unexpected closures trigger exponential-backoff reconnect.
      if (this.intentionalClose) {
        console.log('Connection closed intentionally — no reconnect scheduled.');
        return;
      }

      this.scheduleReconnect(deviceId);
    });
  }

  disconnect(): void {
    // Mark this as intentional so the close handler does not reconnect.
    this.intentionalClose = true;
    this.stopHeartbeat();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.connected = false;
  }

  send(message: AgentUpstreamMessage): boolean {
    if (!this.connected || !this.ws) {
      console.warn('Cannot send message: not connected');
      return false;
    }

    try {
      this.ws.send(JSON.stringify(message));
      return true;
    } catch (err) {
      console.error('Failed to send message:', err);
      return false;
    }
  }

  isConnected(): boolean {
    return this.connected;
  }

  private startHeartbeat(deviceId: string): void {
    this.heartbeatTimer = setInterval(() => {
      this.send({
        type: 'agent:heartbeat',
        deviceId,
        timestamp: Date.now(),
      });
    }, this.config.heartbeatInterval);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private scheduleReconnect(deviceId: string): void {
    if (this.reconnectTimer) return;

    const delay = this.currentReconnectDelay;
    this.currentReconnectDelay = Math.min(
      delay * this.backoffFactor,
      this.maxReconnectDelay
    );

    console.log(`Reconnecting in ${delay}ms (next: ${this.currentReconnectDelay}ms)`);

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect(deviceId);
    }, delay);
  }
}
