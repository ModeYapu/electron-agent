/**
 * Auth tests — channel separation + role-based command authorization.
 *
 * Covers two P0/P2 security guarantees:
 *   1. An AGENT token can NEVER open the web channel, and an ADMIN token can
 *      NEVER open the agent channel (no cross-channel token reuse).
 *   2. A VIEWER cannot send write/mutating commands (click/type/eval/cookie/
 *      storage writes, capture control) — only a read-only allow-list.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { AuthService } from '../apps/relay-server/src/auth';

function makeAuth(): AuthService {
  return new AuthService({
    agentTokens: new Set(['agent-secret-token']),
    adminTokens: new Set(['admin-secret-token']),
  });
}

describe('channel separation (legacy static tokens)', () => {
  test('agent token is rejected on the WEB channel', () => {
    const auth = makeAuth();
    assert.equal(auth.verifyWebConnection('agent-secret-token'), null);
  });

  test('admin token is rejected on the AGENT channel', () => {
    const auth = makeAuth();
    assert.equal(auth.verifyAgentConnection('admin-secret-token', 'dev-1'), null);
  });

  test('agent token works on the AGENT channel and returns the deviceId', () => {
    const auth = makeAuth();
    assert.deepEqual(auth.verifyAgentConnection('agent-secret-token', 'dev-1'), { deviceId: 'dev-1' });
  });

  test('admin token works on the WEB channel as admin role', () => {
    const auth = makeAuth();
    assert.equal(auth.verifyWebConnection('admin-secret-token'), 'admin');
  });

  test('garbage token is rejected on both channels', () => {
    const auth = makeAuth();
    assert.equal(auth.verifyAgentConnection('nope', 'dev-1'), null);
    assert.equal(auth.verifyWebConnection('nope'), null);
  });
});

describe('channel separation (JWT tokens)', () => {
  test('an agent JWT is valid on the agent channel but NOT the web channel', () => {
    const auth = makeAuth();
    const agentJwt = auth.generateAgentToken('dev-2');

    assert.deepEqual(auth.verifyAgentConnection(agentJwt, ''), { deviceId: 'dev-2' });
    assert.equal(auth.verifyWebConnection(agentJwt), null);
  });

  test('an admin JWT is valid on the web channel but NOT the agent channel', () => {
    const auth = makeAuth();
    const adminJwt = auth.generateAdminToken('alice', 'admin');

    assert.equal(auth.verifyWebConnection(adminJwt), 'admin');
    assert.equal(auth.verifyAgentConnection(adminJwt, ''), null);
  });

  test('a viewer JWT resolves to the viewer role on the web channel', () => {
    const auth = makeAuth();
    const viewerJwt = auth.generateAdminToken('bob', 'viewer');
    assert.equal(auth.verifyWebConnection(viewerJwt), 'viewer');
  });
});

describe('command authorization by role', () => {
  const writeCommands = [
    'cmd:click',
    'cmd:type',
    'cmd:key',
    'cmd:navigate',
    'cmd:eval',
    'cmd:scroll',
    'cmd:setCookie',
    'cmd:deleteCookie',
    'cmd:setStorage',
    'cmd:clearStorage',
    'cmd:startCapture',
    'cmd:stopCapture',
  ];

  const readOnlyCommands = [
    'cmd:screenshot',
    'cmd:getInfo',
    'cmd:getDOM',
    'cmd:getCookies',
    'cmd:getStorage',
    'cmd:subscribeNetwork',
    'cmd:subscribeConsole',
  ];

  test('viewer CANNOT send any write command', () => {
    const auth = makeAuth();
    for (const cmd of writeCommands) {
      assert.equal(auth.authorizeCommand('viewer', cmd), false, `viewer should be denied ${cmd}`);
    }
  });

  test('viewer CAN send read-only commands', () => {
    const auth = makeAuth();
    for (const cmd of readOnlyCommands) {
      assert.equal(auth.authorizeCommand('viewer', cmd), true, `viewer should be allowed ${cmd}`);
    }
  });

  test('admin can send every command (write + read-only)', () => {
    const auth = makeAuth();
    for (const cmd of [...writeCommands, ...readOnlyCommands]) {
      assert.equal(auth.authorizeCommand('admin', cmd), true, `admin should be allowed ${cmd}`);
    }
  });
});
