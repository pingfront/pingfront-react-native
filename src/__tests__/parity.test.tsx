import { Text } from 'react-native';
import { act, render, screen } from '@testing-library/react-native';
import Pingfront, {
  configure,
  conversation,
  getLanguage,
  handleBackgroundPush,
  nativeOptions,
  onTeamAction,
  PingfrontChatView,
  setLanguage,
  usePingfrontConversation,
  usePingfrontLanguage,
  usePingfrontLook,
  usesAppBadge,
  type LogEntry,
  type PingfrontEvent,
  type TeamAction,
} from '../index';
import { decodeConversation, decodeEvent, decodeLook } from '../decode';
import { flush, native, resetAll } from './helpers';

beforeEach(resetAll);

const look = {
  appName: 'Clockwise',
  accent: { light: '#3550e6', dark: '#7f8cff' },
  onAccent: { light: '#FFFFFF', dark: '#000000' },
  background: { light: '#FFFFFF', dark: '#000000' },
  teamBubble: { light: '#E9E9EB', dark: '#262628' },
  text: { light: '#000000', dark: '#FFFFFF' },
  muted: { light: '#8E8E93', dark: '#8E8E93' },
  scheme: 'auto',
  font: 'system',
  corners: 'soft',
  density: 'comfortable',
  headerStyle: 'team',
  topics: ['billing', 'bug'],
};

describe('language', () => {
  it('is a configure option and a runtime override the snapshot reflects', async () => {
    expect(nativeOptions({ language: 'de' }).language).toBe('de');
    configure('pk_test_abcdefghijklmnopqrstuvvd', { language: 'de' });
    expect(native.configure.mock.calls[0]?.[1]).toMatchObject({
      language: 'de',
    });

    setLanguage('pt-BR');
    expect(native.setLanguage).toHaveBeenCalledWith('pt-BR');
    setLanguage(null);
    expect(native.setLanguage).toHaveBeenLastCalledWith(null);

    await act(flush);
    expect(getLanguage()).toBeNull();
    await act(async () => native.emit('onState', { language: 'pt-BR' }));
    expect(getLanguage()).toBe('pt-BR');
    await act(async () => native.emit('onState', { language: null }));
    expect(getLanguage()).toBeNull();
  });

  it('usePingfrontLanguage re-renders with the native value', async () => {
    function Label() {
      return <Text>{`language ${usePingfrontLanguage() ?? 'system'}`}</Text>;
    }
    await render(<Label />);
    await act(flush);
    expect(screen.getByText('language system')).toBeTruthy();
    await act(async () => native.emit('onState', { language: 'de' }));
    expect(screen.getByText('language de')).toBeTruthy();
  });
});

describe('logHandler', () => {
  it('asks native for log lines only with a handler, and routes them to it', () => {
    expect(nativeOptions({}).logHandler).toBe(false);
    const lines: LogEntry[] = [];
    configure('pk_test_abcdefghijklmnopqrstuvvd', {
      logHandler: (entry) => lines.push(entry),
    });
    expect(native.configure.mock.calls[0]?.[1]).toMatchObject({
      logHandler: true,
    });
    native.emit('onLog', {
      level: 'debug',
      message: 'GET /v1/thread -> 200',
      category: 'network',
    });
    native.emit('onLog', { level: 'error', message: 'Keystore unavailable' });
    expect(lines).toEqual([
      {
        level: 'debug',
        message: 'GET /v1/thread -> 200',
        category: 'network',
      },
      { level: 'error', message: 'Keystore unavailable' },
    ]);
  });

  it('reports a handler that throws on every line once', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const seen: string[] = [];
    configure('pk_test_abcdefghijklmnopqrstuvvd', {
      logHandler: (entry) => {
        seen.push(entry.message);
        throw new Error('boom');
      },
    });
    native.emit('onLog', { level: 'info', message: 'one' });
    native.emit('onLog', { level: 'info', message: 'two' });
    expect(seen).toEqual(['one', 'two']);
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it('drops malformed lines and survives a handler that throws', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const handler = jest.fn(() => {
      throw new Error('boom');
    });
    configure('pk_test_abcdefghijklmnopqrstuvvd', { logHandler: handler });
    native.emit('onLog', { level: 'info' });
    native.emit('onLog', ['not', 'a', 'line']);
    expect(handler).not.toHaveBeenCalled();
    native.emit('onLog', { level: 'trace', message: 'a newer level' });
    expect(handler).toHaveBeenCalledWith({
      level: 'trace',
      message: 'a newer level',
    });
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('stops routing after configure without a handler', () => {
    const handler = jest.fn();
    configure('pk_test_abcdefghijklmnopqrstuvvd', { logHandler: handler });
    configure('pk_test_abcdefghijklmnopqrstuvvd', {});
    native.emit('onLog', { level: 'info', message: 'x' });
    expect(handler).not.toHaveBeenCalled();
  });
});

describe('messageSent and cardOpened', () => {
  it('decode into typed events', () => {
    expect(
      decodeEvent({
        type: 'messageSent',
        message: {
          id: 'msg_1',
          textLength: 12,
          photoCount: 1,
          repliesToPing: true,
        },
      })
    ).toEqual({
      type: 'messageSent',
      message: {
        id: 'msg_1',
        textLength: 12,
        photoCount: 1,
        repliesToPing: true,
      },
    });
    expect(
      decodeEvent({
        type: 'cardOpened',
        card: { kind: 'store_action', cardId: 'crd_1', messageId: 'msg_2' },
      })
    ).toEqual({
      type: 'cardOpened',
      card: { kind: 'store_action', cardId: 'crd_1', messageId: 'msg_2' },
    });
  });

  it('keep a card kind a newer server adds, and turn malformed ones into unknown', () => {
    expect(
      decodeEvent({
        type: 'cardOpened',
        card: { kind: 'poll', cardId: 'crd_1', messageId: 'msg_1' },
      })
    ).toMatchObject({ type: 'cardOpened', card: { kind: 'poll' } });
    expect(
      decodeEvent({ type: 'cardOpened', card: { kind: 'offer' } })
    ).toEqual(expect.objectContaining({ type: 'unknown', name: 'cardOpened' }));
    expect(decodeEvent({ type: 'messageSent', message: null })).toEqual(
      expect.objectContaining({ type: 'unknown', name: 'messageSent' })
    );
  });

  it('reach listeners', async () => {
    const seen: PingfrontEvent[] = [];
    const subscription = Pingfront.addListener('messageSent', (event) =>
      seen.push(event)
    );
    native.emit('onEvent', {
      type: 'messageSent',
      message: {
        id: 'msg_1',
        textLength: 3,
        photoCount: 0,
        repliesToPing: false,
      },
    });
    expect(seen).toHaveLength(1);
    subscription.remove();
  });
});

describe('look', () => {
  it('decodes the resolved look into #RRGGBB pairs and keeps unknown enum values', () => {
    expect(decodeLook(look)).toEqual({
      ...look,
      accent: { light: '#3550E6', dark: '#7F8CFF' },
    });
    expect(decodeLook({ ...look, corners: 'squircle' })?.corners).toBe(
      'squircle'
    );
  });

  it('is null when a color is missing or not hex', () => {
    expect(
      decodeLook({ ...look, accent: { light: 'blue', dark: '#000000' } })
    ).toBeNull();
    expect(decodeLook({ ...look, muted: undefined })).toBeNull();
    expect(decodeLook('look')).toBeNull();
  });

  it('usePingfrontLook follows the native state', async () => {
    function Accent() {
      return (
        <Text>{`accent ${usePingfrontLook()?.accent.light ?? 'none'}`}</Text>
      );
    }
    await render(<Accent />);
    await act(flush);
    expect(screen.getByText('accent none')).toBeTruthy();
    await act(async () => native.emit('onState', { look }));
    expect(screen.getByText('accent #3550E6')).toBeTruthy();
  });
});

describe('storeAccountToken', () => {
  it('comes from the native state on both platforms', async () => {
    configure('pk_test_abcdefghijklmnopqrstuvvd');
    await act(flush);
    await act(async () =>
      native.emit('onState', {
        storeAccountToken: '7c0e6c1e-4f0e-4b5e-9d3a-1f2e3d4c5b6a',
      })
    );
    expect(Pingfront.getSnapshot().storeAccountToken).toBe(
      '7c0e6c1e-4f0e-4b5e-9d3a-1f2e3d4c5b6a'
    );
  });
});

describe('usesAppBadge and handleBackgroundPush', () => {
  it('resolve the native values', async () => {
    await expect(usesAppBadge()).resolves.toBe(true);
    native.usesAppBadge.mockResolvedValueOnce(false);
    await expect(usesAppBadge()).resolves.toBe(false);

    await expect(handleBackgroundPush({ pingfront: { v: 1 } })).resolves.toBe(
      'newData'
    );
    native.handleBackgroundPush.mockResolvedValueOnce(null);
    await expect(handleBackgroundPush({ other: 1 })).resolves.toBeNull();
  });

  it('map a result a newer SDK adds to null instead of passing it through', async () => {
    native.handleBackgroundPush.mockResolvedValueOnce('deferred');
    await expect(handleBackgroundPush({ pingfront: {} })).resolves.toBeNull();
  });
});

describe('team actions', () => {
  const raw = {
    id: 'tar_1',
    actionId: 'extend_trial',
    name: 'Extend trial',
    fields: { reason: 'sync bug', bad: 3 },
    days: 7,
    until: '2026-11-13T00:00:00Z',
    ackRequired: true,
    createdAt: '2026-11-06T00:00:00Z',
    expiresAt: '2026-11-13T00:00:00Z',
  };

  it('collect natively only while a handler is set', () => {
    const remove = onTeamAction(() => {});
    const removeSecond = onTeamAction(() => {});
    expect(native.setTeamActionsEnabled).toHaveBeenCalledTimes(1);
    expect(native.setTeamActionsEnabled).toHaveBeenLastCalledWith(true);
    remove();
    expect(native.setTeamActionsEnabled).toHaveBeenCalledTimes(1);
    removeSecond();
    expect(native.setTeamActionsEnabled).toHaveBeenLastCalledWith(false);
    expect(native.listenerCount('onTeamAction')).toBe(0);
  });

  it('decode, and answer through the native action by id', async () => {
    const actions: TeamAction[] = [];
    onTeamAction((action) => {
      actions.push(action);
    });
    native.emit('onTeamAction', raw);
    expect(actions).toHaveLength(1);
    const action = actions[0]!;
    expect(action).toMatchObject({
      id: 'tar_1',
      actionId: 'extend_trial',
      fields: { reason: 'sync bug' },
      days: 7,
      ackRequired: true,
    });
    await action.complete();
    expect(native.completeTeamAction).toHaveBeenCalledWith('tar_1');
    // The first answer wins: a later fail for the same delivery is ignored.
    await action.fail('No sync here');
    expect(native.failTeamAction).not.toHaveBeenCalled();
  });

  it('ignore malformed actions', () => {
    const handler = jest.fn();
    onTeamAction(handler);
    native.emit('onTeamAction', { id: 'tar_1' });
    native.emit('onTeamAction', { ...raw, createdAt: 5 });
    expect(handler).not.toHaveBeenCalled();
  });
});

describe('conversation', () => {
  const state = {
    phase: 'ready',
    messages: [
      {
        id: 'msg_1',
        seq: 1,
        author: { kind: 'team', id: 'mem_1', name: 'Deniz' },
        parts: [
          { type: 'text', text: 'Hi Riley' },
          {
            type: 'card',
            card: { kind: 'rating', id: 'crd_1', question: 'How did we do?' },
          },
          { type: 'poll', question: 'from a newer server' },
          { type: 'image', attachmentId: 'att_1' },
        ],
        createdAt: '2026-11-06T00:00:00Z',
        fallback: 'Hi Riley',
      },
      { id: 'msg_bad' },
    ],
    pending: [
      { clientId: 'c1', text: 'Thanks', photoCount: 0, state: 'failed' },
      { text: 'no id' },
    ],
    hasOlder: true,
    isLoadingOlder: false,
    typing: { name: 'Deniz', isAI: false },
    replyExpectation: 'Usually replies within a few hours',
    policy: 'open',
    status: 'open',
    teamReadSeq: 1,
    isOffline: false,
  };

  it('decodes messages in wire format, with unknown parts kept as unknown', () => {
    const decoded = decodeConversation(state);
    expect(decoded.messages).toHaveLength(1);
    const parts = decoded.messages[0]!.parts;
    expect(parts[0]).toEqual({ type: 'text', text: 'Hi Riley' });
    expect(parts[1]).toMatchObject({
      type: 'card',
      card: { kind: 'rating', id: 'crd_1' },
    });
    expect(parts[2]).toMatchObject({ type: 'unknown', name: 'poll' });
    expect(parts[3]).toMatchObject({ type: 'unknown', name: 'image' });
    expect(decoded.pending).toEqual([
      {
        clientId: 'c1',
        text: 'Thanks',
        photoCount: 0,
        state: 'failed',
        heldFor: null,
        isHeld: false,
      },
    ]);
    expect(decoded.isServerUnreachable).toBe(false);
    expect(decoded.typing).toEqual({ name: 'Deniz', isAI: false });
    expect(decodeConversation(null).phase).toBe('idle');
  });

  it('observes natively only while subscribed, and forwards every action', () => {
    const seen: string[] = [];
    const unsubscribe = conversation.subscribe((s) => seen.push(s.phase));
    expect(native.setConversationObserved).toHaveBeenLastCalledWith(true);
    native.emit('onConversation', state);
    expect(seen).toEqual(['ready']);
    expect(conversation.getState().hasOlder).toBe(true);

    conversation.send('Hello');
    conversation.retry('c1');
    conversation.discard('c1');
    conversation.loadOlder();
    conversation.reload().catch(() => {});
    conversation.markRead();
    conversation.setTyping(true);
    conversation.openCard('msg_1', 'crd_9');
    conversation.choose('msg_1', 'crd_2', 'opt_1');
    conversation.rate('msg_1', 'crd_1', 5);
    expect(native.conversationSend).toHaveBeenCalledWith('Hello');
    expect(native.conversationRetry).toHaveBeenCalledWith('c1');
    expect(native.conversationDiscard).toHaveBeenCalledWith('c1');
    expect(native.conversationLoadOlder).toHaveBeenCalled();
    expect(native.conversationReload).toHaveBeenCalled();
    expect(native.conversationMarkRead).toHaveBeenCalled();
    expect(native.conversationSetTyping).toHaveBeenCalledWith(true);
    expect(native.conversationOpenCard).toHaveBeenCalledWith('msg_1', 'crd_9');
    expect(native.conversationChoose).toHaveBeenCalledWith(
      'msg_1',
      'crd_2',
      'opt_1'
    );
    expect(native.conversationRate).toHaveBeenCalledWith('msg_1', 'crd_1', 5);

    unsubscribe();
    expect(native.setConversationObserved).toHaveBeenLastCalledWith(false);
  });

  it('resolves reload only when the native reload has finished', async () => {
    let finish: () => void = () => {};
    native.conversationReload.mockImplementationOnce(
      () => new Promise<void>((resolve) => (finish = resolve))
    );
    let done = false;
    const reloading = conversation.reload().then(() => (done = true));
    await Promise.resolve();
    expect(done).toBe(false);
    finish();
    await reloading;
    expect(done).toBe(true);
  });

  it('passes the hold reason and server reachability through', () => {
    const decoded = decodeConversation({
      ...state,
      pending: [
        {
          clientId: 'c2',
          text: 'Still there?',
          photoCount: 0,
          state: 'failed',
          failure: 'The app is paused',
          heldFor: 'app_paused',
        },
        { clientId: 'c3', photoCount: 0, state: 'queued', heldFor: '' },
      ],
      isOffline: true,
      isServerUnreachable: true,
    });
    expect(decoded.pending.map((p) => p.heldFor)).toEqual(['app_paused', null]);
    expect(decoded.pending.map((p) => p.isHeld)).toEqual([true, false]);
    expect(decoded.isOffline).toBe(true);
    expect(decoded.isServerUnreachable).toBe(true);
  });

  it('usePingfrontConversation re-renders with the state', async () => {
    function Thread() {
      const s = usePingfrontConversation();
      return <Text>{`${s.phase} ${s.messages.length}`}</Text>;
    }
    await render(<Thread />);
    expect(screen.getByText('idle 0')).toBeTruthy();
    await act(async () => native.emit('onConversation', state));
    expect(screen.getByText('ready 1')).toBeTruthy();
  });
});

describe('PingfrontChatView', () => {
  it('renders the native component with the topic as JSON', async () => {
    await render(<PingfrontChatView testID="chat" topic="billing" />);
    const view = screen.getByTestId('chat');
    expect(view.props.topic).toBe('{"id":"billing"}');
  });

  it('sends a custom topic in the openChat shape, and no topic as empty', async () => {
    await render(
      <PingfrontChatView
        testID="chat"
        topic={{ id: 'sync', label: 'Sync is stuck', prefill: 'Sync: ' }}
      />
    );
    expect(JSON.parse(screen.getByTestId('chat').props.topic)).toEqual({
      id: 'sync',
      label: { default: 'Sync is stuck' },
      symbol: 'other',
      prefill: { default: 'Sync: ' },
    });
  });

  it('shows one chat at a time: a second one stays empty until the first unmounts', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    function Two({ first }: { first: boolean }) {
      return (
        <>
          {first ? <PingfrontChatView testID="first" /> : null}
          <PingfrontChatView testID="second" />
        </>
      );
    }
    const view = await render(<Two first />);
    await act(flush);
    expect(screen.getByTestId('first').props.topic).toBe('');
    expect(screen.getByTestId('second').props.topic).toBeUndefined();
    expect(warn).toHaveBeenCalled();
    await view.rerender(<Two first={false} />);
    await act(flush);
    expect(screen.getByTestId('second').props.topic).toBe('');
    warn.mockRestore();
  });
});
