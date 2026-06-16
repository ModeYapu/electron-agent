export interface KeyboardEventLike {
  key: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
  isComposing?: boolean;
}

export type RemoteKeyboardAction =
  | { kind: 'type'; text: string }
  | { kind: 'key'; keyCode: number; action: 'press' };

const SPECIAL_KEY_CODES: Record<string, number> = {
  Enter: 13,
  Backspace: 8,
  Tab: 9,
  Escape: 27,
  Delete: 46,
  ArrowLeft: 37,
  ArrowUp: 38,
  ArrowRight: 39,
  ArrowDown: 40,
  Home: 36,
  End: 35,
  PageUp: 33,
  PageDown: 34,
};

export function mapKeyboardEventToRemoteAction(event: KeyboardEventLike): RemoteKeyboardAction | null {
  if (event.isComposing) return null;
  if (event.ctrlKey || event.metaKey || event.altKey) return null;

  if (event.key === ' ') {
    return { kind: 'type', text: ' ' };
  }

  if (event.key.length === 1) {
    return { kind: 'type', text: event.key };
  }

  const keyCode = SPECIAL_KEY_CODES[event.key];
  if (keyCode !== undefined) {
    return { kind: 'key', keyCode, action: 'press' };
  }

  return null;
}
