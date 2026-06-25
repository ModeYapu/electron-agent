/**
 * 指令转发总线
 * 将 Web Console 的指令转发给对应的 Agent
 */

import { EventEmitter } from 'events';
import type { ServerDownstreamMessage, AgentUpstreamMessage, ServerBroadcastMessage } from '@electron-agent/shared';
import WebSocket from 'ws';

// Track web connection with role
interface WebConnection {
  ws: WebSocket;
  role: 'admin' | 'viewer';
}

// P0 COMMAND RECEIPT: Track pending requests
interface PendingRequest {
  deviceId: string;
  requestId: string;
  commandType: string;
  ws: WebSocket;
  timeout: NodeJS.Timeout;
  timestamp: number;
}

// LIFO screenshot slot — per web client, only the latest frame matters
interface ScreenshotSlot {
  data: string;
  version: number;
  sending: boolean;
  sentVersion: number;
}

const DEFAULT_REQUEST_TIMEOUT = 10000; // 10 seconds

export class CommandBus extends EventEmitter {
  private agentConnections: Map<string, WebSocket> = new Map();
  private webConnections: Set<WebConnection> = new Set();
  private pendingRequests: Map<string, PendingRequest> = new Map();
  private screenshotSlots: Map<WebSocket, ScreenshotSlot> = new Map();

  constructor(private requestTimeoutMs: number = DEFAULT_REQUEST_TIMEOUT) {
    super();
  }

  registerAgent(deviceId: string, ws: WebSocket): void {
    this.agentConnections.set(deviceId, ws);

    ws.on('close', () => {
      this.agentConnections.delete(deviceId);
      // P0 COMMAND RECEIPT: Reject all pending requests for this device
      this.rejectAllPendingForDevice(deviceId, 'Device disconnected');
      this.emit('agentDisconnected', deviceId);
    });

    this.emit('agentConnected', deviceId);
  }

  registerWeb(ws: WebSocket, role: 'admin' | 'viewer'): void {
    this.webConnections.add({ ws, role });

    ws.on('close', () => {
      // Find and remove this connection
      for (const conn of this.webConnections) {
        if (conn.ws === ws) {
          this.webConnections.delete(conn);
          break;
        }
      }
      // Clean up LIFO screenshot slot
      this.screenshotSlots.delete(ws);
    });
  }

  forwardToAgent(deviceId: string, command: ServerDownstreamMessage, ws?: WebSocket): boolean {
    const agentWs = this.agentConnections.get(deviceId);
    if (!agentWs || agentWs.readyState !== WebSocket.OPEN) {
      return false;
    }

    try {
      // P0 COMMAND RECEIPT: Register pending request if requestId present
      if (command.requestId && ws) {
        this.registerPendingRequest(deviceId, command.requestId, command.type, ws);
      }

      agentWs.send(JSON.stringify(command));
      return true;
    } catch (err) {
      console.error(`Failed to forward command to agent ${deviceId}:`, err);
      return false;
    }
  }

  // P0 COMMAND RECEIPT: Register a pending request with timeout
  private registerPendingRequest(deviceId: string, requestId: string, commandType: string, ws: WebSocket): void {
    const key = `${deviceId}:${requestId}`;

    // Clear existing if any
    const existing = this.pendingRequests.get(key);
    if (existing) {
      clearTimeout(existing.timeout);
    }

    const timeout = setTimeout(() => {
      this.rejectRequest(deviceId, requestId, `Command timeout (${Math.round(this.requestTimeoutMs / 1000)}s)`);
    }, this.requestTimeoutMs);

    this.pendingRequests.set(key, {
      deviceId,
      requestId,
      commandType,
      ws,
      timeout,
      timestamp: Date.now(),
    });
  }

  // P0 COMMAND RECEIPT: Resolve a pending request
  resolveRequest(deviceId: string, requestId: string, result: any): void {
    const key = `${deviceId}:${requestId}`;
    const pending = this.pendingRequests.get(key);

    if (pending) {
      clearTimeout(pending.timeout);
      this.pendingRequests.delete(key);

      // Diagnostic: log cursor/type results
      if (pending.commandType === 'cmd:showCursor' || pending.commandType === 'cmd:type') {
        const ok = result?.success;
        const data = result?.data;
        console.log(`[CmdResult] ${deviceId?.slice(0,8)}... ${pending.commandType} → ${ok ? '✓' : '✗'} data=${JSON.stringify(data)?.substring(0, 80)}`);
      }

      // Send server:result to the web client
      this.sendToWeb(pending.ws, {
        type: 'server:result',
        deviceId,
        requestId,
        result,
      } as ServerBroadcastMessage);
    }
  }

  // P0 COMMAND RECEIPT: Reject a pending request
  private rejectRequest(deviceId: string, requestId: string, error: string): void {
    const key = `${deviceId}:${requestId}`;
    const pending = this.pendingRequests.get(key);

    if (pending) {
      clearTimeout(pending.timeout);
      this.pendingRequests.delete(key);

      // Send server:commandError to the web client
      this.sendToWeb(pending.ws, {
        type: 'server:commandError',
        deviceId,
        requestId,
        error,
      } as ServerBroadcastMessage);
    }
  }

  // P0 COMMAND RECEIPT: Reject all pending requests for a device
  private rejectAllPendingForDevice(deviceId: string, reason: string): void {
    for (const [key, pending] of this.pendingRequests) {
      if (pending.deviceId === deviceId) {
        clearTimeout(pending.timeout);
        this.pendingRequests.delete(key);

        // Send server:commandError to the web client
        this.sendToWeb(pending.ws, {
          type: 'server:commandError',
          deviceId,
          requestId: pending.requestId,
          error: reason,
        } as ServerBroadcastMessage);
      }
    }
  }

  broadcastToWeb(message: ServerBroadcastMessage): void {
    const data = JSON.stringify(message);

    // LIFO for screenshots: only the latest frame matters, drop old queued frames
    if (message.type === 'server:screenshot') {
      for (const conn of this.webConnections) {
        if (conn.ws.readyState !== WebSocket.OPEN) continue;

        let slot = this.screenshotSlots.get(conn.ws);
        if (!slot) {
          slot = { data, version: 0, sending: false, sentVersion: -1 };
          this.screenshotSlots.set(conn.ws, slot);
        }
        // Replace stale frame with latest
        slot.data = data;
        slot.version++;

        if (!slot.sending) {
          this._flushScreenshotLIFO(conn.ws, slot);
        }
        // else: frame replaced in-place, will be sent when current send completes
      }
      return;
    }

    // Non-screenshot: normal broadcast
    for (const conn of this.webConnections) {
      if (conn.ws.readyState === WebSocket.OPEN) {
        try {
          conn.ws.send(data);
        } catch (err) {
          console.error('Failed to broadcast to web client:', err);
        }
      }
    }
  }

  // LIFO flush: send latest screenshot, re-check on callback for newer frames
  private _flushScreenshotLIFO(ws: WebSocket, slot: ScreenshotSlot): void {
    if (slot.version <= slot.sentVersion) {
      slot.sending = false;
      return; // nothing new
    }
    slot.sending = true;
    const versionToSend = slot.version;
    const dataToSend = slot.data;
    slot.sentVersion = versionToSend;

    ws.send(dataToSend, (err) => {
      if (err) {
        console.error('[LIFO] screenshot send error:', err.message);
        slot.sending = false;
        return;
      }
      // New frame arrived while we were sending? Send it now.
      if (slot.version > versionToSend) {
        setImmediate(() => this._flushScreenshotLIFO(ws, slot));
      } else {
        slot.sending = false;
      }
    });
  }

  // Send to a specific web connection
  sendToWeb(ws: WebSocket, message: ServerBroadcastMessage): boolean {
    if (ws.readyState === WebSocket.OPEN) {
      try {
        ws.send(JSON.stringify(message));
        return true;
      } catch (err) {
        console.error('Failed to send to web client:', err);
        return false;
      }
    }
    return false;
  }

  broadcastToAll(message: ServerBroadcastMessage): void {
    // 广播给所有 Web 客户端
    this.broadcastToWeb(message);
  }

  getOnlineDeviceIds(): string[] {
    return Array.from(this.agentConnections.keys());
  }

  isAgentConnected(deviceId: string): boolean {
    const ws = this.agentConnections.get(deviceId);
    return ws !== undefined && ws.readyState === WebSocket.OPEN;
  }
}
