/**
 * @electron-agent/agent-core
 * Electron Agent 核心模块
 */

import { v4 as uuidv4 } from 'uuid';
import { ConnectionManager } from './connection';
import { CDPBridge } from './cdp-bridge';
import { CaptureService } from './capture';
import { CommandExecutor } from './executor';
import { StatusReporter } from './reporter';
import type { DeviceInfo, ServerDownstreamMessage } from '@electron-agent/shared';
import type { BrowserWindow } from 'electron';
import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';
import { createHash } from 'crypto';

/**
 * Stable device ID — hardware-derived, immutable once set.
 *
 * Priority:
 *   1. Existing ~/.electron-agent-device-id  (migration from old versions)
 *   2. Hardware fingerprint → saved to disk → permanent
 *
 * Fingerprint inputs (all sorted for deterministic order):
 *   - ALL non-internal MAC addresses  (sorted, so NIC order / VPN don't matter)
 *   - CPU model
 *   - Total RAM
 *   - Hostname  (avoids VM clone collisions)
 */
function resolveDeviceId(): string {
  const idFile = path.join(os.homedir(), '.electron-agent-device-id');

  // 1. Migration: old file-based ID takes priority
  try {
    if (fs.existsSync(idFile)) {
      const existing = fs.readFileSync(idFile, 'utf-8').trim();
      if (existing.length > 0) return existing;
    }
  } catch {}

  // 2. Hardware fingerprint
  const parts: string[] = [];

  // ALL non-internal, non-zero MACs — sorted for stable ordering
  const nets = os.networkInterfaces();
  const macs: string[] = [];
  for (const ifaces of Object.values(nets)) {
    for (const a of ifaces || []) {
      if (!a.internal && a.mac !== '00:00:00:00:00:00') {
        macs.push(a.mac.replace(/[:-]/g, '').toLowerCase());
      }
    }
  }
  parts.push(...macs.sort());

  // CPU
  const cpu = os.cpus()[0]?.model || '';
  parts.push(cpu);

  // RAM
  parts.push(os.totalmem().toString());

  // Hostname — prevents VM clone collisions
  parts.push(os.hostname());

  const fingerprint = parts.join('|');
  const id = createHash('sha256').update(fingerprint).digest('hex').slice(0, 16);

  // 3. Persist — immutable anchor for future starts
  try {
    fs.writeFileSync(idFile, id, 'utf-8');
  } catch {}

  return id;
}

export interface AgentConfig {
  serverUrl: string;
  agentToken: string;
  deviceInfo: {
    name: string;
    appVersion?: string;
    tags?: string[];
  };
  reconnectInterval: number;
  heartbeatInterval: number;
  captureQuality: number;
  onCommandLog?: (log: { ts: string; type: string; requestId: string; detail: string }) => void;
  /** Ask user permission before executing remote commands. Returns true if allowed. */
  onPermissionRequired?: (cmd: { type: string; detail: string; requestId: string }) => Promise<boolean>;
}

const COMMAND_LOG_PREFIX = '[AGENT]';

export class ElectronAgent {
  private deviceId: string;
  private deviceInfo: DeviceInfo;
  private config: AgentConfig;
  private connection: ConnectionManager;
  private cdpBridge: CDPBridge;
  private captureService: CaptureService;
  private commandExecutor: CommandExecutor;
  private statusReporter: StatusReporter;

  constructor(private win: BrowserWindow, config: AgentConfig) {
    this.config = config;
    this.deviceId = resolveDeviceId();
    this.deviceInfo = {
      deviceId: this.deviceId,
      name: config.deviceInfo.name || 'Electron Agent',
      os: process.platform as 'win32' | 'darwin' | 'linux',
      version: process.versions.electron,
      appVersion: config.deviceInfo.appVersion || '0.1.0',
      ip: 'localhost',
      tags: config.deviceInfo.tags,
    };

    this.connection = new ConnectionManager({
      serverUrl: config.serverUrl,
      agentToken: config.agentToken,
      reconnectInterval: config.reconnectInterval,
      heartbeatInterval: config.heartbeatInterval,
    });

    this.cdpBridge = new CDPBridge(win);
    this.captureService = new CaptureService(win, {
      quality: config.captureQuality,
    });

    this.statusReporter = new StatusReporter(win, {
      deviceId: this.deviceId,
      send: (msg) => this.connection.send(msg),
    });

    this.commandExecutor = new CommandExecutor(win, this.cdpBridge, (requestId, result) => {
      this.statusReporter.reportCommandResult(requestId, result.success, result.data, result.error);
    });

    this.setupEventHandlers();
  }

  async start(): Promise<void> {
    await this.cdpBridge.attach();
    this.connection.connect(this.deviceId);
    console.log(`${COMMAND_LOG_PREFIX} Electron Agent started: ${this.deviceId}`);
  }

  stop(): void {
    this.captureService.stopCaptureLoop();
    this.statusReporter.destroy();
    this.connection.disconnect();
    this.cdpBridge.detach();
    console.log(`${COMMAND_LOG_PREFIX} Agent stopped`);
  }

  getDeviceId(): string {
    return this.deviceId;
  }

  getDeviceInfo(): DeviceInfo {
    return this.deviceInfo;
  }

  async getDOM(): Promise<any> {
    return await this.cdpBridge.getDOM();
  }

  private logCommand(command: ServerDownstreamMessage): void {
    const ts = new Date().toISOString().slice(11, 23);
    const { type, requestId } = command as any;
    const detail = this.commandDetail(command);
    console.log(`${COMMAND_LOG_PREFIX} [${ts}] ⬇ ${type} (${requestId})${detail}`);
    // Forward to renderer via callback (IPC)
    if (this.config.onCommandLog) {
      this.config.onCommandLog({ ts, type, requestId, detail });
    }
  }

  private commandDetail(command: ServerDownstreamMessage): string {
    const c = command as any;
    switch (c.type) {
      case 'cmd:click': return ` x=${c.x} y=${c.y} btn=${c.button}`;
      case 'cmd:type': return ` text="${c.text?.slice(0, 30)}"`;
      case 'cmd:navigate': return ` url=${c.url}`;
      case 'cmd:eval': return ' script';
      case 'cmd:scroll': return ` delta=${c.deltaX},${c.deltaY}`;
      case 'cmd:startCapture': return ` fps=${c.fps}`;
      case 'cmd:fillForm': return ` fields=${Object.keys(c.fields || {}).length}`;
      case 'cmd:getFields': return '';
      case 'cmd:screenshot': return '';
      case 'cmd:getDOM': return '';
      default: return '';
    }
  }

  /** Commands that modify page state or input data — require user permission */
  private needsPermission(type: string): boolean {
    const restricted = ['cmd:click', 'cmd:type', 'cmd:key', 'cmd:navigate',
      'cmd:eval', 'cmd:scroll', 'cmd:setCookie', 'cmd:deleteCookie',
      'cmd:setStorage', 'cmd:clearStorage', 'cmd:fillForm'];
    return restricted.includes(type);
  }

  private async askPermission(command: ServerDownstreamMessage): Promise<boolean> {
    if (!this.config.onPermissionRequired) return true; // No callback = allow all
    try {
      const detail = this.commandDetail(command);
      return await this.config.onPermissionRequired({
        type: command.type,
        detail,
        requestId: command.requestId,
      });
    } catch {
      return false; // Timeout or error = deny
    }
  }

  private setupEventHandlers(): void {
    this.connection.on('connected', () => {
      this.registerDevice();
      this.statusReporter.reportPageChange();
      console.log(`${COMMAND_LOG_PREFIX} ✅ Connected to relay`);
    });

    this.connection.on('disconnected', () => {
      console.log(`${COMMAND_LOG_PREFIX} ❌ Disconnected from relay`);
    });

    this.connection.on('error', (err) => {
      console.error(`${COMMAND_LOG_PREFIX} Connection error:`, err);
    });

    this.connection.on('command', (command) => {
      this.logCommand(command);
      this.handleCommand(command);
    });

    this.cdpBridge.on('console', (log) => {
      this.statusReporter.reportConsoleLog(log);
    });

    this.cdpBridge.on('error', (error) => {
      this.statusReporter.reportError(error);
    });

    this.cdpBridge.on('network', (request) => {
      this.statusReporter.reportNetworkRequest(request);
    });
  }

  private registerDevice(): void {
    this.connection.send({
      type: 'agent:register',
      deviceId: this.deviceId,
      info: this.deviceInfo,
    });
  }

  private async handleCommand(command: ServerDownstreamMessage): Promise<void> {
    // Check permission for destructive/input commands
    if (this.needsPermission(command.type)) {
      const allowed = await this.askPermission(command);
      if (!allowed) {
        this.statusReporter.reportCommandResult(command.requestId, false, undefined, 'User denied permission');
        return;
      }
    }

    switch (command.type) {
      case 'cmd:startCapture':
        this.captureService.startCaptureLoop(command.fps, (screenshot) => {
          this.statusReporter.reportScreenshot(screenshot);
        });
        this.statusReporter.reportCommandResult(command.requestId, true, 'Capture started');
        break;

      case 'cmd:stopCapture':
        this.captureService.stopCaptureLoop();
        this.statusReporter.reportCommandResult(command.requestId, true, 'Capture stopped');
        break;

      case 'cmd:screenshot':
        const screenshot = await this.captureService.capture();
        this.statusReporter.reportScreenshot(screenshot);
        this.statusReporter.reportCommandResult(command.requestId, true, screenshot);
        break;

      case 'cmd:subscribeNetwork':
        this.statusReporter.setNetworkEnabled(command.enable);
        this.statusReporter.reportCommandResult(command.requestId, true, 'Network subscription updated');
        break;

      case 'cmd:subscribeConsole':
        this.statusReporter.setConsoleEnabled(command.enable);
        this.statusReporter.reportCommandResult(command.requestId, true, 'Console subscription updated');
        break;

      default:
        this.commandExecutor.execute(command);
    }
  }
}
