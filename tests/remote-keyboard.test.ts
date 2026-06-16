import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { mapKeyboardEventToRemoteAction } from '../apps/web-console/src/utils/remoteKeyboard';

describe('mapKeyboardEventToRemoteAction', () => {
  test('maps printable characters to cmd:type text', () => {
    assert.deepEqual(
      mapKeyboardEventToRemoteAction({ key: 'a' }),
      { kind: 'type', text: 'a' },
    );
    assert.deepEqual(
      mapKeyboardEventToRemoteAction({ key: 'A' }),
      { kind: 'type', text: 'A' },
    );
    assert.deepEqual(
      mapKeyboardEventToRemoteAction({ key: ' ' }),
      { kind: 'type', text: ' ' },
    );
  });

  test('maps navigation and editing keys to cmd:key presses', () => {
    assert.deepEqual(
      mapKeyboardEventToRemoteAction({ key: 'Enter' }),
      { kind: 'key', keyCode: 13, action: 'press' },
    );
    assert.deepEqual(
      mapKeyboardEventToRemoteAction({ key: 'Backspace' }),
      { kind: 'key', keyCode: 8, action: 'press' },
    );
    assert.deepEqual(
      mapKeyboardEventToRemoteAction({ key: 'ArrowLeft' }),
      { kind: 'key', keyCode: 37, action: 'press' },
    );
    assert.deepEqual(
      mapKeyboardEventToRemoteAction({ key: 'Delete' }),
      { kind: 'key', keyCode: 46, action: 'press' },
    );
  });

  test('ignores modifier combos and composing input', () => {
    assert.equal(mapKeyboardEventToRemoteAction({ key: 'v', ctrlKey: true }), null);
    assert.equal(mapKeyboardEventToRemoteAction({ key: 'c', metaKey: true }), null);
    assert.equal(mapKeyboardEventToRemoteAction({ key: 'a', altKey: true }), null);
    assert.equal(mapKeyboardEventToRemoteAction({ key: '你', isComposing: true }), null);
  });
});
