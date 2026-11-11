import { act, render } from '@testing-library/react-native';
import Pingfront, {
  configure,
  conversation,
  logout,
  onTeamAction,
  PingfrontChatView,
} from '../index';
import { decodeConversation } from '../decode';
import { flush, native, resetAll } from './helpers';

// Counts native chat views mounted at the same time (a layout effect runs in the commit that first renders it).
const mounted = { now: 0, max: 0 };
jest.mock('../specs/PingfrontChatViewNativeComponent', () => {
  const { useLayoutEffect } = jest.requireActual('react');
  return {
    __esModule: true,
    default: function NativeChat() {
      useLayoutEffect(() => {
        mounted.now += 1;
        mounted.max = Math.max(mounted.max, mounted.now);
        return () => {
          mounted.now -= 1;
        };
      }, []);
      return null;
    },
  };
});

beforeEach(resetAll);

const action = {
  id: 'tar_1',
  actionId: 'extend_trial',
  name: 'Extend trial',
  fields: {},
  ackRequired: true,
  createdAt: '2026-11-06T00:00:00Z',
  expiresAt: '2026-11-13T00:00:00Z',
};

describe('conversation.rate input', () => {
  it('drops NaN and infinities and clamps to 1...5', () => {
    conversation.rate('m', 'c', Number.NaN);
    conversation.rate('m', 'c', Number.POSITIVE_INFINITY);
    conversation.rate('m', 'c', Number.NEGATIVE_INFINITY);
    expect(native.conversationRate).not.toHaveBeenCalled();
    conversation.rate('m', 'c', 1e308);
    conversation.rate('m', 'c', -4);
    conversation.rate('m', 'c', 3.6);
    expect(native.conversationRate.mock.calls.map((c) => c[2])).toEqual([
      5, 1, 4,
    ]);
  });
});

describe('team action handlers', () => {
  it('fail the action without details when an async handler rejects', async () => {
    const warn = jest.spyOn(console, 'error').mockImplementation(() => {});
    onTeamAction(async () => {
      throw new Error('user riley@example.com not found');
    });
    native.emit('onTeamAction', action);
    await act(flush);
    expect(native.failTeamAction).toHaveBeenCalledWith(
      'tar_1',
      "The app's team action handler failed."
    );
    warn.mockRestore();
  });

  it('do not fail an action the handler already answered', async () => {
    const warn = jest.spyOn(console, 'error').mockImplementation(() => {});
    onTeamAction(async (a) => {
      await a.complete();
      throw new Error('after');
    });
    native.emit('onTeamAction', action);
    await act(flush);
    expect(native.completeTeamAction).toHaveBeenCalledWith('tar_1');
    expect(native.failTeamAction).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it('with several handlers, the first answer wins', async () => {
    onTeamAction(async (a) => {
      await a.fail('first');
    });
    onTeamAction(async (a) => {
      await a.complete();
    });
    native.emit('onTeamAction', action);
    await act(flush);
    expect(native.failTeamAction).toHaveBeenCalledTimes(1);
    expect(native.failTeamAction).toHaveBeenCalledWith('tar_1', 'first');
    expect(native.completeTeamAction).not.toHaveBeenCalled();
  });
});

describe('PingfrontChatView ownership', () => {
  it('never mounts two native chats, even when two views mount in one commit', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    mounted.now = 0;
    mounted.max = 0;
    const view = await render(
      <>
        <PingfrontChatView />
        <PingfrontChatView />
      </>
    );
    await act(flush);
    expect(mounted.now).toBe(1);
    expect(mounted.max).toBe(1);
    await view.unmount();
    expect(mounted.now).toBe(0);
    warn.mockRestore();
  });
});

describe('configure snapshot', () => {
  it('reads a fresh snapshot after native configure, not the one already in flight', async () => {
    let release: (v: object) => void = () => {};
    native.getSnapshot.mockImplementationOnce(
      () => new Promise((resolve) => (release = resolve))
    );
    Pingfront.subscribeUnreadCount(() => {}); // attaches: one request in flight
    configure('pk_test_abcdefghijklmnopqrstuvvd');
    release({ unreadCount: 0 });
    await act(flush);
    expect(native.getSnapshot).toHaveBeenCalledTimes(2);
    const configured = native.configure.mock.invocationCallOrder[0] ?? 0;
    const fresh = native.getSnapshot.mock.invocationCallOrder[1] ?? 0;
    expect(configured).toBeLessThan(fresh);
  });
});

describe('conversation cache', () => {
  const state = {
    phase: 'ready',
    messages: [
      { id: 'm1', seq: 1, author: { kind: 'team' }, parts: [], createdAt: 'x' },
    ],
    pending: [],
  };

  it('forgets the thread on the last unsubscribe and on logout', () => {
    const off = conversation.subscribe(() => {});
    native.emit('onConversation', state);
    expect(conversation.getState().messages).toHaveLength(1);
    off();
    expect(conversation.getState().messages).toHaveLength(0);

    conversation.subscribe(() => {});
    native.emit('onConversation', state);
    logout();
    expect(conversation.getState().messages).toHaveLength(0);
  });

  it('gives a second subscriber the current state at once', () => {
    conversation.subscribe(() => {});
    native.emit('onConversation', state);
    const second: number[] = [];
    conversation.subscribe((s) => second.push(s.messages.length));
    expect(second).toEqual([1]);
    expect(native.setConversationObserved).toHaveBeenCalledTimes(1);
  });

  it('keeps messages and pending when a partial update leaves them out', () => {
    const full = decodeConversation(state);
    const next = decodeConversation(
      { phase: 'ready', typing: { name: 'Deniz', isAI: false } },
      full
    );
    expect(next.messages).toBe(full.messages);
    expect(next.typing).toEqual({ name: 'Deniz', isAI: false });
  });
});

describe('decoding card results and translations', () => {
  it('drops a malformed result or translation instead of casting it', () => {
    const decoded = decodeConversation({
      messages: [
        {
          id: 'm1',
          seq: 1,
          author: { kind: 'team' },
          createdAt: 'x',
          parts: [
            {
              type: 'card',
              card: { kind: 'rating', id: 'c1' },
              result: { at: '2026', rating: 'five', choiceId: 3 },
            },
          ],
          translation: {
            language: 'de',
            parts: [{ text: 'Hallo' }, { nope: 1 }],
          },
        },
      ],
    });
    const message = decoded.messages[0]!;
    expect(message.parts[0]).toEqual({
      type: 'card',
      card: { kind: 'rating', id: 'c1' },
      result: { at: '2026' },
    });
    expect(message.translation).toEqual({
      language: 'de',
      parts: [{ text: 'Hallo' }],
    });
  });
});

describe('errors from app code', () => {
  it('are logged whole in debug builds and only by name in release builds', () => {
    const { describeError } = jest.requireActual(
      '../errors'
    ) as typeof import('../errors');
    const error = new TypeError('riley@example.com not found');
    expect(describeError(error)).toBe(error);
    const globals = globalThis as { __DEV__?: boolean };
    const dev = globals.__DEV__;
    globals.__DEV__ = false;
    try {
      expect(describeError(error)).toBe('TypeError');
      expect(describeError('text')).toBe('string');
    } finally {
      globals.__DEV__ = dev;
    }
  });
});
