/**
 * Protocol tests — message-type encoding/decoding for the unified BATCH model.
 *
 * Verifies the type guards classify messages by channel prefix and that the
 * batch messages round-trip through JSON (the wire format) without losing the
 * `type` discriminator or the `batch` payload.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  isAgentUpstreamMessage,
  isServerDownstreamMessage,
  isServerBroadcastMessage,
} from '@electron-agent/shared';
import type {
  AgentNetworkBatchMessage,
  AgentConsoleBatchMessage,
  ServerNetworkBatchBroadcast,
  ServerConsoleBatchBroadcast,
  AgentUpstreamMessage,
  ServerBroadcastMessage,
} from '@electron-agent/shared';

describe('type guards classify by channel prefix', () => {
  test('agent:* messages are upstream', () => {
    assert.equal(isAgentUpstreamMessage({ type: 'agent:register' }), true);
    assert.equal(isAgentUpstreamMessage({ type: 'agent:networkBatch' }), true);
    assert.equal(isAgentUpstreamMessage({ type: 'agent:consoleBatch' }), true);
  });

  test('cmd:* messages are downstream (commands)', () => {
    assert.equal(isServerDownstreamMessage({ type: 'cmd:click' }), true);
    assert.equal(isServerDownstreamMessage({ type: 'cmd:getDOM' }), true);
  });

  test('server:* messages are broadcasts', () => {
    assert.equal(isServerBroadcastMessage({ type: 'server:devices' }), true);
    assert.equal(isServerBroadcastMessage({ type: 'server:networkBatch' }), true);
    assert.equal(isServerBroadcastMessage({ type: 'server:result' }), true);
  });

  test('cross-prefix classification is exclusive', () => {
    // An agent message is NOT a command or broadcast.
    assert.equal(isServerDownstreamMessage({ type: 'agent:register' }), false);
    assert.equal(isServerBroadcastMessage({ type: 'agent:register' }), false);
    // A command is NOT upstream or broadcast.
    assert.equal(isAgentUpstreamMessage({ type: 'cmd:click' }), false);
    assert.equal(isServerBroadcastMessage({ type: 'cmd:click' }), false);
    // A broadcast is NOT upstream or a command.
    assert.equal(isAgentUpstreamMessage({ type: 'server:devices' }), false);
    assert.equal(isServerDownstreamMessage({ type: 'server:devices' }), false);
  });

  test('non-objects and missing type are rejected', () => {
    for (const bad of [null, undefined, 'agent:register', 42, {}, { type: 7 }]) {
      assert.equal(isAgentUpstreamMessage(bad), false);
      assert.equal(isServerDownstreamMessage(bad), false);
      assert.equal(isServerBroadcastMessage(bad), false);
    }
  });
});

describe('batch message JSON round-trip (wire encoding/decoding)', () => {
  test('agent:networkBatch survives stringify → parse', () => {
    const original: AgentNetworkBatchMessage = {
      type: 'agent:networkBatch',
      deviceId: 'dev-1',
      batch: [
        { method: 'GET', url: 'https://a', status: 200, mimeType: 'application/json', timing: 12, timestamp: 1 },
        { method: 'POST', url: 'https://b', status: 404, mimeType: 'text/html', timing: 34, timestamp: 2 },
      ],
    };

    const wire = JSON.parse(JSON.stringify(original)) as AgentNetworkBatchMessage;

    assert.equal(wire.type, 'agent:networkBatch');
    assert.equal(wire.deviceId, 'dev-1');
    assert.equal(Array.isArray(wire.batch), true);
    assert.equal(wire.batch.length, 2);
    assert.equal(wire.batch[0].method, 'GET');
    assert.equal(wire.batch[1].status, 404);
    // Re-validated through the upstream guard after decode.
    assert.equal(isAgentUpstreamMessage(wire), true);
  });

  test('agent:consoleBatch survives stringify → parse', () => {
    const original: AgentConsoleBatchMessage = {
      type: 'agent:consoleBatch',
      deviceId: 'dev-1',
      batch: [
        { level: 'log', args: ['hello'], timestamp: 1 },
        { level: 'error', args: ['boom'], timestamp: 2 },
      ],
    };

    const wire = JSON.parse(JSON.stringify(original)) as AgentConsoleBatchMessage;
    assert.equal(wire.type, 'agent:consoleBatch');
    assert.equal(wire.batch.length, 2);
    assert.equal(wire.batch[1].level, 'error');
    assert.equal(isAgentUpstreamMessage(wire), true);
  });

  test('empty batch round-trips as an empty array (not dropped)', () => {
    const original: AgentNetworkBatchMessage = {
      type: 'agent:networkBatch',
      deviceId: 'dev-2',
      batch: [],
    };
    const wire = JSON.parse(JSON.stringify(original)) as AgentNetworkBatchMessage;
    assert.equal(Array.isArray(wire.batch), true);
    assert.equal(wire.batch.length, 0);
  });
});

describe('relay re-wrap: agent batch → server broadcast', () => {
  test('server:networkBatch is a valid broadcast carrying the same batch', () => {
    const rewrapped: ServerNetworkBatchBroadcast = {
      type: 'server:networkBatch',
      deviceId: 'dev-1',
      batch: [{ method: 'GET', url: 'https://a', status: 200, mimeType: '', timing: 5, timestamp: 1 }],
    };
    assert.equal(isServerBroadcastMessage(rewrapped), true);
    assert.equal(rewrapped.batch.length, 1);
  });

  test('server:consoleBatch is a valid broadcast carrying the same batch', () => {
    const rewrapped: ServerConsoleBatchBroadcast = {
      type: 'server:consoleBatch',
      deviceId: 'dev-1',
      batch: [{ level: 'warn', args: ['careful'], timestamp: 1 }],
    };
    assert.equal(isServerBroadcastMessage(rewrapped), true);
    assert.equal(rewrapped.batch.length, 1);
  });
});

describe('union membership', () => {
  test('batch messages are members of their respective unions', () => {
    // Compile-time assertion: these assignments type-check only if the batch
    // types belong to the unions. Runtime guards then double-confirm.
    const up: AgentUpstreamMessage = {
      type: 'agent:networkBatch',
      deviceId: 'dev-1',
      batch: [],
    };
    const bc: ServerBroadcastMessage = {
      type: 'server:networkBatch',
      deviceId: 'dev-1',
      batch: [],
    };
    assert.equal(isAgentUpstreamMessage(up), true);
    assert.equal(isServerBroadcastMessage(bc), true);
  });
});
