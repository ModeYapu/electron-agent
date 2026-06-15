/**
 * CDP (Chrome DevTools Protocol) 桥接
 * 通过 Electron webContents.debugger API 连接 CDP
 */

import { BrowserWindow } from 'electron';
import type { ConsoleLog, JSError, NetworkRequest, DOMNode, Cookie, StorageEntry } from '@electron-agent/shared';

export class CDPBridge {
  private attached = false;
  private eventHandlers: Map<string, (...args: any[]) => void> = new Map();

  constructor(private win: BrowserWindow) {}

  async attach(): Promise<void> {
    if (this.attached) return;

    const wc = this.win.webContents;

    try {
      wc.debugger.attach('1.3');
      this.attached = true;

      wc.debugger.on('message', (event, method, params) => {
        this.handleCDPEvent(method, params);
      });

      // 启用基础域
      await this.sendCommand('Runtime.enable');
      await this.sendCommand('Network.enable');

      // Start periodic cleanup of stale network requests
      this.networkCleanupTimer = setInterval(() => {
        const now = Date.now();
        for (const [key, val] of this.networkRequests) {
          if (now - val.timestamp > CDPBridge.NETWORK_REQUEST_TTL) {
            this.networkRequests.delete(key);
          }
        }
      }, 30000);
    } catch (err) {
      console.error('Failed to attach CDP:', err);
      throw err;
    }
  }

  detach(): void {
    if (!this.attached) return;

    try {
      this.win.webContents.debugger.detach();
      this.attached = false;
      this.eventHandlers.clear();
      if (this.networkCleanupTimer) {
        clearInterval(this.networkCleanupTimer);
        this.networkCleanupTimer = null;
      }
      this.networkRequests.clear();
    } catch (err) {
      console.error('Failed to detach CDP:', err);
    }
  }

  isAttached(): boolean {
    return this.attached;
  }

  async sendCommand(method: string, params?: any): Promise<any> {
    if (!this.attached) {
      throw new Error('CDP not attached');
    }

    try {
      return this.win.webContents.debugger.sendCommand(method, params);
    } catch (err) {
      console.error(`CDP command failed: ${method}`, err);
      throw err;
    }
  }

  on(event: 'console', handler: (log: ConsoleLog) => void): void;
  on(event: 'error', handler: (error: JSError) => void): void;
  on(event: 'network', handler: (request: NetworkRequest) => void): void;
  on(event: string, handler: (...args: any[]) => void): void {
    this.eventHandlers.set(event, handler);
  }

  off(event: string): void {
    this.eventHandlers.delete(event);
  }

  private handleCDPEvent(method: string, params: any): void {
    switch (method) {
      case 'Runtime.consoleAPICalled':
        this.handleConsoleAPICalled(params);
        break;
      case 'Runtime.exceptionThrown':
        this.handleExceptionThrown(params);
        break;
      case 'Network.responseReceived':
        this.handleNetworkResponse(params);
        break;
      case 'Network.requestWillBeSent':
        this.handleNetworkRequest(params);
        break;
    }
  }

  private handleConsoleAPICalled(params: any): void {
    const handler = this.eventHandlers.get('console');
    if (!handler) return;

    const levelMap: Record<number, ConsoleLog['level']> = {
      1: 'error',
      2: 'warn',
      3: 'info',
      4: 'log',
      5: 'debug',
    };

    const log: ConsoleLog = {
      level: levelMap[params.type] || 'log',
      args: params.args.map((arg: any) => {
        if (arg.type === 'string') return arg.value;
        if (arg.type === 'number') return String(arg.value);
        if (arg.type === 'boolean') return String(arg.value);
        if (arg.description) return arg.description;
        return JSON.stringify(arg);
      }),
      timestamp: params.timestamp ?? Date.now(),
    };

    handler(log);
  }

  private handleExceptionThrown(params: any): void {
    const handler = this.eventHandlers.get('error');
    if (!handler) return;

    const exceptionDetails = params.exceptionDetails;
    const error: JSError = {
      message: exceptionDetails.exception?.description || exceptionDetails.text || 'Unknown error',
      stack: exceptionDetails.stackTrace?.callFrames
        ?.map((frame: any) => `    at ${frame.functionName || '(anonymous)'} (${frame.url}:${frame.lineNumber}:${frame.columnNumber})`)
        .join('\n') || '',
      timestamp: params.timestamp ?? Date.now(),
    };

    handler(error);
  }

  private networkRequests = new Map<string, { requestId: string; request: any; timestamp: number }>();
  private networkCleanupTimer: NodeJS.Timeout | null = null;
  private static NETWORK_REQUEST_TTL = 60000; // 60s

  private handleNetworkRequest(params: any): void {
    this.networkRequests.set(params.requestId, {
      requestId: params.requestId,
      request: params.request,
      timestamp: params.timestamp ?? Date.now(),
    });
  }

  private handleNetworkResponse(params: any): void {
    const handler = this.eventHandlers.get('network');
    if (!handler) return;

    const requestId = params.requestId;
    const requestData = this.networkRequests.get(requestId);
    if (!requestData) return;

    const { request, timestamp } = requestData;
    const response = params.response;

    const networkRequest: NetworkRequest = {
      method: request.method || 'GET',
      url: request.url,
      status: response.status,
      mimeType: response.mimeType || '',
      requestHeaders: response.requestHeaders,
      responseHeaders: response.headers,
      timing: params.timestamp ? (params.timestamp - timestamp) : 0,
      timestamp: timestamp,
    };

    handler(networkRequest);
    this.networkRequests.delete(requestId);
  }

  async getDOM(options?: { selector?: string; depth?: number }): Promise<DOMNode | null> {
    try {
      // 启用 DOM 域
      await this.sendCommand('DOM.enable');

      // 获取文档根节点
      const root = await this.sendCommand('DOM.getDocument');

      let targetNode = root.root;

      // 如果提供了选择器，查找对应节点
      if (options?.selector) {
        const nodeId = await this.findNodeBySelector(targetNode.nodeId, options.selector);
        if (nodeId) {
          const node = await this.sendCommand('DOM.describeNode', {
            nodeId,
            depth: options.depth || 10,
          });
          targetNode = node.node;
        } else {
          // 选择器未找到任何节点
          await this.sendCommand('DOM.disable');
          return null;
        }
      }

      // 递归构建 DOM 树
      const maxDepth = options?.depth ?? 50;
      const rootNode = await this.buildDOMNode(targetNode, 0, maxDepth);

      // 禁用 DOM 域以释放资源
      await this.sendCommand('DOM.disable');

      return rootNode;
    } catch (err) {
      console.error('Failed to get DOM:', err);
      return null;
    }
  }

  private async findNodeBySelector(rootNodeId: number, selector: string): Promise<number | null> {
    try {
      const result = await this.sendCommand('DOM.querySelector', {
        nodeId: rootNodeId,
        selector,
      });
      return result.nodeId || null;
    } catch (err) {
      console.error('Failed to find node by selector:', err);
      return null;
    }
  }

  private async buildDOMNode(node: any, currentDepth: number = 0, maxDepth: number = 50): Promise<DOMNode> {
    const MAX_CHILDREN = 100; // 限制子节点数量

    const domNode: DOMNode = {
      nodeId: node.nodeId,
      nodeType: node.nodeType,
      nodeName: node.nodeName,
      localName: node.localName,
      nodeValue: node.nodeValue,
      attributes: node.attributes ? this.parseAttributes(node.attributes) : {},
    };

    // 如果有子节点且深度未超限，递归处理
    if (node.children && node.children.length > 0 && currentDepth < maxDepth) {
      const limitedChildren = node.children.slice(0, MAX_CHILDREN);
      domNode.children = await Promise.all(
        limitedChildren.map((child: any) => this.buildDOMNode(child, currentDepth + 1, maxDepth))
      );
    }

    return domNode;
  }

  private parseAttributes(attributes: string[]): Record<string, string> {
    const result: Record<string, string> = {};
    for (let i = 0; i < attributes.length; i += 2) {
      if (i + 1 < attributes.length) {
        result[attributes[i]] = attributes[i + 1];
      }
    }
    return result;
  }

  // ========== Cookie 管理 ==========

  async getCookies(): Promise<Cookie[]> {
    try {
      const session = this.win.webContents.session;
      const cookies = await session.cookies.get({});

      return cookies.map(cookie => {
        // Convert Electron's expirationDate (seconds since epoch) to our format (ms since epoch)
        const expirationDate = cookie.expirationDate ? Math.floor(cookie.expirationDate * 1000) : undefined;
        return {
          name: cookie.name,
          value: cookie.value,
          domain: cookie.domain,
          path: cookie.path,
          expires: expirationDate,
          httpOnly: cookie.httpOnly,
          secure: cookie.secure,
          sameSite: cookie.sameSite as 'Strict' | 'Lax' | 'None' || undefined,
        };
      });
    } catch (err) {
      console.error('Failed to get cookies:', err);
      throw err;
    }
  }

  async setCookie(cookie: { name: string; value: string; domain?: string; path?: string; expires?: number; httpOnly?: boolean; secure?: boolean; sameSite?: 'Strict' | 'Lax' | 'None' }): Promise<void> {
    try {
      const session = this.win.webContents.session;

      const cookieParam: any = {
        url: `https://${cookie.domain || 'localhost'}`,
        name: cookie.name,
        value: cookie.value,
      };

      if (cookie.domain) cookieParam.domain = cookie.domain;
      if (cookie.path) cookieParam.path = cookie.path;
      if (cookie.expires) cookieParam.expirationDate = Math.floor(cookie.expires / 1000); // Convert ms → seconds for Electron
      if (cookie.httpOnly !== undefined) cookieParam.httpOnly = cookie.httpOnly;
      if (cookie.secure !== undefined) cookieParam.secure = cookie.secure;
      if (cookie.sameSite) cookieParam.sameSite = cookie.sameSite;

      await session.cookies.set(cookieParam);
    } catch (err) {
      console.error('Failed to set cookie:', err);
      throw err;
    }
  }

  async deleteCookie(name: string): Promise<void> {
    try {
      const session = this.win.webContents.session;
      const cookies = await session.cookies.get({});

      for (const cookie of cookies) {
        if (cookie.name === name) {
          const url = `https://${cookie.domain || 'localhost'}${cookie.path || '/'}`;
          await session.cookies.remove(url, cookie.name);
        }
      }
    } catch (err) {
      console.error('Failed to delete cookie:', err);
      throw err;
    }
  }

  // ========== Storage 管理 ==========

  async getStorage(storageType: 'localStorage' | 'sessionStorage'): Promise<StorageEntry[]> {
    try {
      const result = await this.sendCommand('Runtime.evaluate', {
        expression: `Array.from(Object.keys(${storageType})).map(key => ({ key, value: ${storageType}.getItem(key) }))`,
        returnByValue: true,
      });

      if (result.exceptionDetails) {
        throw new Error(result.exceptionDetails.exception?.description || 'Failed to get storage');
      }

      const entries = result.result?.value || [];
      return entries.map((entry: any) => ({
        key: entry.key,
        value: entry.value,
        storageType,
      }));
    } catch (err) {
      console.error('Failed to get storage:', err);
      throw err;
    }
  }

  async setStorage(key: string, value: string, storageType: 'localStorage' | 'sessionStorage'): Promise<void> {
    try {
      const sanitizedValue = JSON.stringify(value).slice(1, -1); // Remove extra quotes
      const expression = `${storageType}.setItem(${JSON.stringify(key)}, ${JSON.stringify(value)})`;

      await this.sendCommand('Runtime.evaluate', {
        expression,
        returnByValue: true,
      });
    } catch (err) {
      console.error('Failed to set storage:', err);
      throw err;
    }
  }

  async clearStorage(storageType: 'localStorage' | 'sessionStorage'): Promise<void> {
    try {
      await this.sendCommand('Runtime.evaluate', {
        expression: `${storageType}.clear()`,
        returnByValue: true,
      });
    } catch (err) {
      console.error('Failed to clear storage:', err);
      throw err;
    }
  }
}
