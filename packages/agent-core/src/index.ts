/**
 * @electron-agent/agent-core
 * Electron Agent 核心模块
 */

import { BrowserWindow, app } from 'electron';
import { v4 as uuidv4 } from 'uuid';
import type { DeviceInfo, ServerDownstreamMessage, CommandResult } from '@electron-agent/shared';
import { ConnectionManager } from './connection';
import { CDPBridge } from './cdp-bridge';
import { CaptureService } from './capture';
import { CommandExecutor } from './executor';
import { StatusReporter } from './reporter';

export interface AgentConfig {
  serverUrl: string;
  agentToken: string;
  deviceInfo: Partial<DeviceInfo>;
  reconnectInterval?: number;
  heartbeatInterval?: number;
  captureQuality?: number;
}

export class ElectronAgent {
  private connection: ConnectionManager;
  private cdpBridge: CDPBridge;
  private captureService: CaptureService;
  private commandExecutor: CommandExecutor;
  private statusReporter: StatusReporter;
  private deviceId: string;
  private deviceInfo: DeviceInfo;

  constructor(private win: BrowserWindow, private config: AgentConfig) {
    this.deviceId = uuidv4();

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
      reconnectInterval: config.reconnectInterval || 5000,
      heartbeatInterval: config.heartbeatInterval || 30000,
    });

    this.cdpBridge = new CDPBridge(win);
    this.captureService = new CaptureService(win, {
      quality: config.captureQuality || 60,
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
    // 先附加 CDP
    await this.cdpBridge.attach();

    // 连接服务器
    this.connection.connect(this.deviceId);

    console.log(`Electron Agent started: ${this.deviceId}`);
  }

  stop(): void {
    this.captureService.stopCaptureLoop();
    this.statusReporter.destroy();
    this.connection.disconnect();
    this.cdpBridge.detach();
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

  private setupEventHandlers(): void {
    // 连接事件
    this.connection.on('connected', () => {
      this.registerDevice();
      this.statusReporter.reportPageChange();
    });

    this.connection.on('disconnected', () => {
      console.log('Disconnected from server');
    });

    this.connection.on('error', (err) => {
      console.error('Connection error:', err);
    });

    // 接收命令
    this.connection.on('command', (command: ServerDownstreamMessage) => {
      this.handleCommand(command);
    });

    // CDP 事件
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
    switch (command.type) {
      case 'cmd:startCapture':
        this.captureService.startCaptureLoop(command.fps, (screenshot) => {
          this.statusReporter.reportScreenshot(screenshot);
        });
        break;

      case 'cmd:stopCapture':
        this.captureService.stopCaptureLoop();
        break;

      case 'cmd:screenshot':
        const screenshot = await this.captureService.capture();
        this.statusReporter.reportScreenshot(screenshot);
        break;

      case 'cmd:subscribeNetwork':
        this.statusReporter.setNetworkEnabled(command.enable);
        break;

      case 'cmd:subscribeConsole':
        this.statusReporter.setConsoleEnabled(command.enable);
        break;

      default:
        // 其他命令由 executor 处理
        this.commandExecutor.execute(command);
    }
  }
}

export * from './connection';
export * from './cdp-bridge';
export * from './capture';
export * from './executor';
export * from './reporter';
