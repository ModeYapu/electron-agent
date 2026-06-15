/**
 * 指令执行器
 * 执行来自服务器的远程控制命令
 */

import { BrowserWindow } from 'electron';
import type { ServerDownstreamMessage, CommandResult, CookieParam, StorageEntry } from '@electron-agent/shared';
import { CDPBridge } from './cdp-bridge';

export class CommandExecutor {
  constructor(
    private win: BrowserWindow,
    private cdp: CDPBridge,
    private sendResult: (requestId: string, result: CommandResult) => void
  ) {}

  async execute(command: ServerDownstreamMessage): Promise<void> {
    const requestId = command.requestId;

    try {
      let result: CommandResult;

      switch (command.type) {
        case 'cmd:click':
          result = await this.executeClick(command);
          break;
        case 'cmd:type':
          result = await this.executeType(command);
          break;
        case 'cmd:key':
          result = await this.executeKey(command);
          break;
        case 'cmd:navigate':
          result = await this.executeNavigate(command);
          break;
        case 'cmd:eval':
          result = await this.executeEval(command);
          break;
        case 'cmd:scroll':
          result = await this.executeScroll(command);
          break;
        case 'cmd:getInfo':
          result = await this.executeGetInfo(command);
          break;
        case 'cmd:screenshot':
          // 单次截图由 reporter 处理
          result = { success: true, data: 'Screenshot requested' };
          break;
        case 'cmd:startCapture':
          result = { success: true, data: 'Capture started' };
          break;
        case 'cmd:stopCapture':
          result = { success: true, data: 'Capture stopped' };
          break;
        case 'cmd:getDOM':
          result = await this.executeGetDOM(command);
          break;
        case 'cmd:subscribeNetwork':
          // Network subscription is handled by reporter via CDPBridge events
          // The enable flag controls whether events are forwarded
          result = { success: true, data: 'Network subscription updated' };
          break;
        case 'cmd:subscribeConsole':
          result = { success: true, data: 'Console subscription updated' };
          break;
        case 'cmd:getCookies':
          result = await this.executeGetCookies(command);
          break;
        case 'cmd:setCookie':
          result = await this.executeSetCookie(command);
          break;
        case 'cmd:deleteCookie':
          result = await this.executeDeleteCookie(command);
          break;
        case 'cmd:getStorage':
          result = await this.executeGetStorage(command);
          break;
        case 'cmd:setStorage':
          result = await this.executeSetStorage(command);
          break;
        case 'cmd:clearStorage':
          result = await this.executeClearStorage(command);
          break;
        default: {
          const unknownCmd = command as ServerDownstreamMessage & { type: string };
          result = { success: false, error: `Unknown command: ${unknownCmd.type}` };
        }
      }

      this.sendResult(requestId, result);
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      this.sendResult(requestId, { success: false, error });
    }
  }

  private async executeClick(command: Extract<ServerDownstreamMessage, { type: 'cmd:click' }>): Promise<CommandResult> {
    const wc = this.win.webContents;

    // 使用 CDP 发送鼠标事件
    await wc.debugger.sendCommand('Input.dispatchMouseEvent', {
      type: 'mousePressed',
      x: command.x,
      y: command.y,
      button: command.button,
      clickCount: 1,
    });

    await new Promise(resolve => setTimeout(resolve, 50));

    await wc.debugger.sendCommand('Input.dispatchMouseEvent', {
      type: 'mouseReleased',
      x: command.x,
      y: command.y,
      button: command.button,
      clickCount: 1,
    });

    return { success: true };
  }

  private async executeType(command: Extract<ServerDownstreamMessage, { type: 'cmd:type' }>): Promise<CommandResult> {
    const wc = this.win.webContents;
    const text = command.text;

    // Use CDP Input.insertText for efficient batch text input
    // This is ~100x faster than dispatching keyDown/keyUp per character
    try {
      await wc.debugger.sendCommand('Input.insertText', { text });
      return { success: true };
    } catch {
      // Fallback: some pages/envs don't support insertText, use per-char dispatch
      for (const char of text) {
        const keyCode = char.charCodeAt(0);

        await wc.debugger.sendCommand('Input.dispatchKeyEvent', {
          type: 'keyDown',
          keyCode,
          key: char,
          text: char,
        });

        await wc.debugger.sendCommand('Input.dispatchKeyEvent', {
          type: 'keyUp',
          keyCode,
          key: char,
        });
      }
      return { success: true };
    }
  }

  private async executeKey(command: Extract<ServerDownstreamMessage, { type: 'cmd:key' }>): Promise<CommandResult> {
    const wc = this.win.webContents;
    const keyMap: Record<number, string> = {
      13: 'Enter',
      8: 'Backspace',
      9: 'Tab',
      27: 'Escape',
      37: 'ArrowLeft',
      38: 'ArrowUp',
      39: 'ArrowRight',
      40: 'ArrowDown',
    };

    const key = keyMap[command.keyCode] || String.fromCharCode(command.keyCode);

    if (command.action === 'down' || command.action === 'press') {
      await wc.debugger.sendCommand('Input.dispatchKeyEvent', {
        type: 'keyDown',
        keyCode: command.keyCode,
        key,
      });
    }

    if (command.action === 'up' || command.action === 'press') {
      await wc.debugger.sendCommand('Input.dispatchKeyEvent', {
        type: 'keyUp',
        keyCode: command.keyCode,
        key,
      });
    }

    return { success: true };
  }

  private async executeNavigate(command: Extract<ServerDownstreamMessage, { type: 'cmd:navigate' }>): Promise<CommandResult> {
    await this.win.webContents.loadURL(command.url);
    return { success: true };
  }

  private async executeEval(command: Extract<ServerDownstreamMessage, { type: 'cmd:eval' }>): Promise<CommandResult> {
    const wc = this.win.webContents;
    const result = await wc.debugger.sendCommand('Runtime.evaluate', {
      expression: command.code,
      returnByValue: true,
    });

    if (result.exceptionDetails) {
      return {
        success: false,
        error: result.exceptionDetails.exception?.description || 'Execution failed',
      };
    }

    return { success: true, data: result.result?.value };
  }

  private async executeScroll(command: Extract<ServerDownstreamMessage, { type: 'cmd:scroll' }>): Promise<CommandResult> {
    const wc = this.win.webContents;

    await wc.debugger.sendCommand('Input.dispatchMouseEvent', {
      type: 'mouseWheel',
      x: 0,
      y: 0,
      deltaX: command.deltaX,
      deltaY: command.deltaY,
    });

    return { success: true };
  }

  private async executeGetInfo(command: Extract<ServerDownstreamMessage, { type: 'cmd:getInfo' }>): Promise<CommandResult> {
    const wc = this.win.webContents;

    return {
      success: true,
      data: {
        url: wc.getURL(),
        title: wc.getTitle(),
      },
    };
  }

  private async executeGetDOM(command: Extract<ServerDownstreamMessage, { type: 'cmd:getDOM' }>): Promise<CommandResult> {
    try {
      const dom = await this.cdp.getDOM();
      return { success: true, data: dom };
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      return { success: false, error };
    }
  }

  private async executeGetCookies(command: Extract<ServerDownstreamMessage, { type: 'cmd:getCookies' }>): Promise<CommandResult> {
    try {
      const cookies = await this.cdp.getCookies();
      return { success: true, data: cookies };
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      return { success: false, error };
    }
  }

  private async executeSetCookie(command: Extract<ServerDownstreamMessage, { type: 'cmd:setCookie' }>): Promise<CommandResult> {
    try {
      await this.cdp.setCookie(command.cookie);
      return { success: true };
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      return { success: false, error };
    }
  }

  private async executeDeleteCookie(command: Extract<ServerDownstreamMessage, { type: 'cmd:deleteCookie' }>): Promise<CommandResult> {
    try {
      await this.cdp.deleteCookie(command.name);
      return { success: true };
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      return { success: false, error };
    }
  }

  private async executeGetStorage(command: Extract<ServerDownstreamMessage, { type: 'cmd:getStorage' }>): Promise<CommandResult> {
    try {
      const storage = await this.cdp.getStorage(command.storageType);
      return { success: true, data: storage };
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      return { success: false, error };
    }
  }

  private async executeSetStorage(command: Extract<ServerDownstreamMessage, { type: 'cmd:setStorage' }>): Promise<CommandResult> {
    try {
      await this.cdp.setStorage(command.key, command.value, command.storageType);
      return { success: true };
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      return { success: false, error };
    }
  }

  private async executeClearStorage(command: Extract<ServerDownstreamMessage, { type: 'cmd:clearStorage' }>): Promise<CommandResult> {
    try {
      await this.cdp.clearStorage(command.storageType);
      return { success: true };
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      return { success: false, error };
    }
  }
}
