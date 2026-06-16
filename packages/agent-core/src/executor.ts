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
        case 'cmd:fillForm':
          result = await this.executeFillForm(command);
          break;
        case 'cmd:getFields':
          result = await this.executeGetFields(command);
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

  private ensureWindowFocused(): void {
    try {
      if (!this.win.isFocused()) {
        this.win.focus();
      }
      this.win.webContents.focus();
    } catch {
      // Best-effort only; hidden/background windows may reject focus changes.
    }
  }

  private async executeClick(command: Extract<ServerDownstreamMessage, { type: 'cmd:click' }>): Promise<CommandResult> {
    const wc = this.win.webContents;
    this.ensureWindowFocused();

    // 1. Move mouse to target position (required for proper hit-testing)
    await wc.debugger.sendCommand('Input.dispatchMouseEvent', {
      type: 'mouseMoved',
      x: command.x,
      y: command.y,
      button: 'none',
    });

    // 2. Press
    await wc.debugger.sendCommand('Input.dispatchMouseEvent', {
      type: 'mousePressed',
      x: command.x,
      y: command.y,
      button: command.button,
      clickCount: 1,
    });

    await new Promise(resolve => setTimeout(resolve, 50));

    // 3. Release
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
    this.ensureWindowFocused();

    for (const char of text) {
      const upper = char.toUpperCase();
      const isLetter = /^[A-Z]$/.test(upper);
      const isDigit = /^[0-9]$/.test(char);
      const code = isLetter ? `Key${upper}` : isDigit ? `Digit${char}` : 'Unidentified';
      const keyCode = char.charCodeAt(0);

      await wc.debugger.sendCommand('Input.dispatchKeyEvent', {
        type: 'rawKeyDown',
        key: char,
        code,
        text: char,
        unmodifiedText: char,
        keyCode,
        windowsVirtualKeyCode: keyCode,
        nativeVirtualKeyCode: keyCode,
      });

      await wc.debugger.sendCommand('Input.dispatchKeyEvent', {
        type: 'char',
        key: char,
        text: char,
        unmodifiedText: char,
        keyCode,
        windowsVirtualKeyCode: keyCode,
        nativeVirtualKeyCode: keyCode,
      });

      await wc.debugger.sendCommand('Input.dispatchKeyEvent', {
        type: 'keyUp',
        key: char,
        code,
        keyCode,
        windowsVirtualKeyCode: keyCode,
        nativeVirtualKeyCode: keyCode,
      });
    }

    return { success: true };
  }

  private async dispatchSpecialKey(keyCode: number, key: string, code: string, action: 'down' | 'up' | 'press'): Promise<void> {
    const wc = this.win.webContents;

    if (action === 'down' || action === 'press') {
      await wc.debugger.sendCommand('Input.dispatchKeyEvent', {
        type: 'rawKeyDown',
        key,
        code,
        keyCode,
        windowsVirtualKeyCode: keyCode,
        nativeVirtualKeyCode: keyCode,
      });
    }

    if (action === 'up' || action === 'press') {
      await wc.debugger.sendCommand('Input.dispatchKeyEvent', {
        type: 'keyUp',
        key,
        code,
        keyCode,
        windowsVirtualKeyCode: keyCode,
        nativeVirtualKeyCode: keyCode,
      });
    }
  }

  private async executeKey(command: Extract<ServerDownstreamMessage, { type: 'cmd:key' }>): Promise<CommandResult> {
    this.ensureWindowFocused();
    const keyMap: Record<number, { key: string; code: string }> = {
      13: { key: 'Enter', code: 'Enter' },
      8: { key: 'Backspace', code: 'Backspace' },
      9: { key: 'Tab', code: 'Tab' },
      27: { key: 'Escape', code: 'Escape' },
      33: { key: 'PageUp', code: 'PageUp' },
      34: { key: 'PageDown', code: 'PageDown' },
      35: { key: 'End', code: 'End' },
      36: { key: 'Home', code: 'Home' },
      37: { key: 'ArrowLeft', code: 'ArrowLeft' },
      38: { key: 'ArrowUp', code: 'ArrowUp' },
      39: { key: 'ArrowRight', code: 'ArrowRight' },
      40: { key: 'ArrowDown', code: 'ArrowDown' },
      46: { key: 'Delete', code: 'Delete' },
    };

    const keyInfo = keyMap[command.keyCode] || {
      key: String.fromCharCode(command.keyCode),
      code: `Key${String.fromCharCode(command.keyCode).toUpperCase()}`,
    };

    await this.dispatchSpecialKey(command.keyCode, keyInfo.key, keyInfo.code, command.action);

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

  private async executeFillForm(command: Extract<ServerDownstreamMessage, { type: 'cmd:fillForm' }>): Promise<CommandResult> {
    try {
      const wc = this.win.webContents;
      const fieldsJson = JSON.stringify(command.fields);
      // Self-contained: inject helper + call in one expression
      const result = await wc.debugger.sendCommand('Runtime.evaluate', {
        expression: `(() => {
          const fields = ${fieldsJson};
          const results = [];
          for (const name of Object.keys(fields)) {
            const el = document.querySelector('[name="' + name + '"]') || document.getElementById(name);
            if (!el) { results.push({ok:false, field:name, error:'not found'}); continue; }
            const val = fields[name];
            if (el.type === 'radio') {
              const r = document.querySelector('[name="' + name + '"][value="' + val + '"]');
              if (r) { r.checked = true; }
              else { results.push({ok:false, field:name, error:'radio value not found'}); continue; }
            } else if (el.type === 'checkbox') {
              el.checked = val === true || val === 'true';
            } else {
              el.value = val;
            }
            el.dispatchEvent(new Event('input', {bubbles:true}));
            el.dispatchEvent(new Event('change', {bubbles:true}));
            results.push({ok:true, field:name, value:val});
          }
          return {ok:true, filled:results.length, results};
        })()`,
        returnByValue: true,
      });

      if (result.exceptionDetails) {
        return {
          success: false,
          error: result.exceptionDetails.exception?.description || 'FillForm execution failed',
        };
      }

      return { success: true, data: result.result?.value };
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      return { success: false, error };
    }
  }

  private async executeGetFields(command: Extract<ServerDownstreamMessage, { type: 'cmd:getFields' }>): Promise<CommandResult> {
    try {
      const wc = this.win.webContents;
      // Self-contained scan — works on any page, not just demo form
      const result = await wc.debugger.sendCommand('Runtime.evaluate', {
        expression: `(() => {
          const fields = [];
          document.querySelectorAll('input, select, textarea').forEach(el => {
            if (!el.name && !el.id) return;
            let value = '';
            if (el.type === 'radio' || el.type === 'checkbox') {
              value = el.checked;
            } else {
              value = el.value;
            }
            fields.push({
              name: el.name || el.id,
              id: el.id || '',
              type: el.type || el.tagName.toLowerCase(),
              value: value,
              placeholder: el.placeholder || '',
              required: !!el.required,
            });
          });
          return fields;
        })()`,
        returnByValue: true,
      });

      if (result.exceptionDetails) {
        return {
          success: false,
          error: result.exceptionDetails.exception?.description || 'GetFields execution failed',
        };
      }

      return { success: true, data: result.result?.value };
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      return { success: false, error };
    }
  }
}
