/**
 * 状态上报器
 * 收集并上报页面状态、截图、事件等
 */

import { BrowserWindow } from 'electron';
import type {
  PageState,
  ScreenshotData,
  NetworkRequest,
  ConsoleLog,
  JSError,
  AgentUpstreamMessage,
} from '@electron-agent/shared';

export interface ReporterConfig {
  deviceId: string;
  send: (message: AgentUpstreamMessage) => boolean;
  batchInterval?: number; // Batch flush interval in ms (default: 500)
}

export class StatusReporter {
  private currentPage: PageState | null = null;
  private networkEnabled = false;
  private consoleEnabled = false;
  private networkBatch: NetworkRequest[] = [];
  private consoleBatch: ConsoleLog[] = [];
  private batchTimeout: NodeJS.Timeout | null = null;
  private batchInterval: NodeJS.Timeout | null = null;

  constructor(
    private win: BrowserWindow,
    private config: ReporterConfig
  ) {
    this.setupPageListeners();
    // BATCH is the only model: always start the periodic flush.
    this.setupBatching();
  }

  private setupPageListeners(): void {
    const wc = this.win.webContents;

    wc.on('did-navigate-in-page', (event, url, isMainFrame) => {
      if (isMainFrame) {
        this.reportPageChange();
      }
    });

    wc.on('did-navigate', (event, url, httpResponseCode, httpStatusText) => {
      this.reportPageChange();
    });

    wc.on('page-title-updated', (event, title) => {
      this.reportPageChange();
    });
  }

  reportPageChange(): void {
    const wc = this.win.webContents;
    this.currentPage = {
      url: wc.getURL(),
      title: wc.getTitle(),
    };

    this.config.send({
      type: 'agent:pageChanged',
      deviceId: this.config.deviceId,
      state: this.currentPage,
    });
  }

  reportScreenshot(screenshot: ScreenshotData): void {
    this.config.send({
      type: 'agent:screenshot',
      deviceId: this.config.deviceId,
      data: screenshot,
    });
  }

  reportNetworkRequest(request: NetworkRequest): void {
    if (!this.networkEnabled) return;
    this.networkBatch.push(request);
    this.scheduleBatchFlush();
  }

  reportConsoleLog(log: ConsoleLog): void {
    if (!this.consoleEnabled) return;
    this.consoleBatch.push(log);
    this.scheduleBatchFlush();
  }

  private setupBatching(): void {
    // Periodic flush every 500ms
    const interval = this.config.batchInterval || 500;
    this.batchInterval = setInterval(() => this.flushBatches(), interval);
  }

  destroy(): void {
    if (this.batchInterval) {
      clearInterval(this.batchInterval);
      this.batchInterval = null;
    }
    if (this.batchTimeout) {
      clearTimeout(this.batchTimeout);
      this.batchTimeout = null;
    }
    this.flushBatches();
  }

  private scheduleBatchFlush(): void {
    if (this.batchTimeout) return;

    this.batchTimeout = setTimeout(() => {
      this.flushBatches();
      this.batchTimeout = null;
    }, this.config.batchInterval || 500);
  }

  private flushBatches(): void {
    // Flush network batch as a single agent:networkBatch message
    if (this.networkBatch.length > 0) {
      this.config.send({
        type: 'agent:networkBatch',
        deviceId: this.config.deviceId,
        batch: this.networkBatch,
      });
      this.networkBatch = [];
    }

    // Flush console batch as a single agent:consoleBatch message
    if (this.consoleBatch.length > 0) {
      this.config.send({
        type: 'agent:consoleBatch',
        deviceId: this.config.deviceId,
        batch: this.consoleBatch,
      });
      this.consoleBatch = [];
    }
  }

  reportError(error: JSError): void {
    this.config.send({
      type: 'agent:error',
      deviceId: this.config.deviceId,
      error,
    });
  }

  reportCommandResult(requestId: string, success: boolean, data?: any, error?: string): void {
    this.config.send({
      type: 'agent:result',
      deviceId: this.config.deviceId,
      requestId,
      result: { success, data, error },
    });
  }

  setNetworkEnabled(enabled: boolean): void {
    this.networkEnabled = enabled;
  }

  setConsoleEnabled(enabled: boolean): void {
    this.consoleEnabled = enabled;
  }

  getCurrentPage(): PageState | null {
    return this.currentPage;
  }
}
