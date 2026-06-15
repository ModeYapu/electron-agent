/**
 * Receipt tests — CommandBus pending-request tracking + timeout.
 *
 * Verifies the server half of the command-receipt loop:
 *   - forwardToAgent registers a pending request keyed by deviceId:requestId
 *   - agent:agent result (resolveRequest) sends server:result back to the web client
 *   - the per-request timeout fires server:commandError when no result arrives
 *   - agent disconnect rejects ALL pending requests for that device
 *   - forwarding to an unknown/absent agent fails fast
 *
 * Uses a tiny mock WebSocket so no real network is involved.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { CommandBus } from '../apps/relay-server/src/command-bus';
import type { ServerDownstreamMessage } from '@electron-agent/shared';

const OPEN = 1; // WebSocket.OPEN

/** Minimal WebSocket double: records sends, lets us emit lifecycle events. */
class MockWebSocket {
  readyState = OPEN;
  sent: any[] = [];
  private handlers = new Map<string, Array<(...args: any[]) => void>>();

  on(event: string, handler: (...args: any[]) => void): void {
    const list = this.handlers.get(event) ?? [];
    list.push(handler);
    this.handlers.set(event, list);
  }

  emit(event: string, ...args: any[]): void {
    for (const h of this.handlers.get(event) ?? []) h(...args);
  }

  send(data: string): void {
    this.sent.push(JSON.parse(data));
  }

  close(): void {
    this.readyState = 3; // CLOSED
    this.emit('close');
  }
}

const clickCmd = (requestId: string): ServerDownstreamMessage => ({
  type: 'cmd:click',
  deviceId: 'dev-1',
  requestId,
  x: 10,
  y: 20,
  button: 'left',
});

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

describe('forwardToAgent', () => {
  test('forwards the command to the agent and registers a pending request', () => {
    const bus = new CommandBus();
    const agent = new MockWebSocket();
    const web = new MockWebSocket();
    bus.registerAgent('dev-1', agent);
    bus.registerWeb(web, 'admin');

    const ok = bus.forwardToAgent('dev-1', clickCmd('r1'), web);

    assert.equal(ok, true);
    assert.equal(agent.sent.length, 1);
    assert.equal(agent.sent[0].type, 'cmd:click');
    assert.equal(agent.sent[0].requestId, 'r1');
  });

  test('returns false (and sends nothing) when the agent is absent', () => {
    const bus = new CommandBus();
    const web = new MockWebSocket();
    bus.registerWeb(web, 'admin');

    const ok = bus.forwardToAgent('ghost', clickCmd('r1'), web);

    assert.equal(ok, false);
    assert.equal(web.sent.length, 0); // the relay, not the bus, surfaces this error
  });
});

describe('resolveRequest (agent result → server:result)', () => {
  test('sends server:result to the originating web client and clears the pending entry', async () => {
    const bus = new CommandBus();
    const agent = new MockWebSocket();
    const web = new MockWebSocket();
    bus.registerAgent('dev-1', agent);
    bus.registerWeb(web, 'admin');

    bus.forwardToAgent('dev-1', clickCmd('r1'), web);
    assert.equal(web.sent.length, 0);

    // Simulate the agent replying with a result for r1.
    bus.resolveRequest('dev-1', 'r1', { success: true, data: { ok: 1 } });

    assert.equal(web.sent.length, 1);
    assert.equal(web.sent[0].type, 'server:result');
    assert.equal(web.sent[0].requestId, 'r1');
    assert.equal(web.sent[0].result.success, true);

    // Resolving again (e.g. a duplicate/late result) is a no-op — request was cleared.
    bus.resolveRequest('dev-1', 'r1', { success: true });
    assert.equal(web.sent.length, 1);

    // And the pending timeout must NOT fire now (already resolved).
    await wait(60);
    assert.equal(web.sent.length, 1);
  });
});

describe('per-request timeout', () => {
  test('fires server:commandError when no result arrives within the timeout', async () => {
    const bus = new CommandBus(50); // 50ms timeout
    const agent = new MockWebSocket();
    const web = new MockWebSocket();
    bus.registerAgent('dev-1', agent);
    bus.registerWeb(web, 'admin');

    bus.forwardToAgent('dev-1', clickCmd('r-timeout'), web);
    assert.equal(web.sent.length, 0);

    await wait(120); // past the 50ms timeout

    assert.equal(web.sent.length, 1);
    assert.equal(web.sent[0].type, 'server:commandError');
    assert.equal(web.sent[0].requestId, 'r-timeout');
    assert.match(web.sent[0].error, /timeout/i);
  });
});

describe('agent disconnect', () => {
  test('rejects ALL pending requests for that device with server:commandError', () => {
    const bus = new CommandBus(10000);
    const agent = new MockWebSocket();
    const web = new MockWebSocket();
    bus.registerAgent('dev-1', agent);
    bus.registerWeb(web, 'admin');

    bus.forwardToAgent('dev-1', clickCmd('a'), web);
    bus.forwardToAgent('dev-1', clickCmd('b'), web);
    bus.forwardToAgent('dev-1', clickCmd('c'), web);
    assert.equal(web.sent.length, 0);

    // Agent drops the connection.
    agent.close();

    assert.equal(web.sent.length, 3);
    const ids = web.sent.map((m) => m.requestId).sort();
    assert.deepEqual(ids, ['a', 'b', 'c']);
    for (const m of web.sent) {
      assert.equal(m.type, 'server:commandError');
      assert.match(m.error, /disconnect/i);
    }
  });
});
