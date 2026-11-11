import Pingfront, {
  addListener,
  configure,
  getUnreadCount,
  handlePush,
  handleUrl,
  identify,
  isPingFrontPush,
  moment,
  nativeOptions,
  openChat,
  parseSelfCheck,
  PingfrontError,
  exportMyData,
  prepare,
  selfCheck,
  setOffers,
  subscribeUnreadCount,
  type PingfrontEvent,
} from '../index';
import { flush, native, resetAll } from './helpers';

beforeEach(resetAll);

describe('configure', () => {
  it('passes the key and the mapped options, and sends nothing else', () => {
    configure('pk_test_abcdefghijklmnopqrstuvvd', {
      baseUrl: 'http://localhost:8899/v1',
      logLevel: 'debug',
      topics: [
        'billing',
        {
          id: 'sync',
          label: 'Sync is stuck',
          symbol: 'bug',
          prefill: 'Sync stopped: ',
        },
      ],
      look: {
        accent: '#3550E6',
        corners: 'soft',
        replyExpectation: 'Usually replies in a few hours',
      },
      modules: {
        push: true,
        storeKit: { products: ['pro_yearly'] },
        reports: { logTail: false },
      },
    });
    expect(native.configure).toHaveBeenCalledTimes(1);
    const [key, options] = native.configure.mock.calls[0];
    expect(key).toBe('pk_test_abcdefghijklmnopqrstuvvd');
    expect(options).toMatchObject({
      baseUrl: 'http://localhost:8899/v1',
      logLevel: 'debug',
      topics: [
        { id: 'billing' },
        {
          id: 'sync',
          label: { default: 'Sync is stuck' },
          symbol: 'bug',
          prefill: { default: 'Sync stopped: ' },
        },
      ],
      look: { accent: { light: '#3550E6', dark: '#3550E6' }, corners: 'soft' },
      modules: {
        push: true,
        storeKit: { products: ['pro_yearly'] },
        reports: { shakeToReport: true, logTail: false },
        vendors: [],
      },
      wrapper: { name: 'react-native' },
    });
    expect(native.prepare).not.toHaveBeenCalled();
    expect(native.moment).not.toHaveBeenCalled();
  });

  it('turns modules off unless they are asked for', () => {
    expect(nativeOptions({}).modules).toEqual({
      push: false,
      storeKit: undefined,
      billing: undefined,
      reports: undefined,
      vendors: [],
    });
    expect(nativeOptions({ modules: { billing: true } }).modules).toMatchObject(
      {
        billing: { products: [] },
      }
    );
  });

  it('accepts null to read the key from Info.plist or the manifest', () => {
    configure(null);
    expect(native.configure).toHaveBeenCalledWith(null, expect.any(Object));
  });
});

describe('identity', () => {
  it('a string is a verified identity token', () => {
    identify('eyJhbGciOiJIUzI1NiJ9.e30.sig');
    expect(native.identifyWithToken).toHaveBeenCalledWith(
      'eyJhbGciOiJIUzI1NiJ9.e30.sig'
    );
    expect(native.identify).not.toHaveBeenCalled();
  });

  it('an object names the person', () => {
    identify({ userId: 'u_1', name: 'Riley' });
    expect(native.identify).toHaveBeenCalledWith('u_1', 'Riley', null);
  });

  it('prepare rejects with a PingfrontError carrying the native code', async () => {
    native.prepare.mockRejectedValueOnce(
      Object.assign(new Error('The server does not know this app key.'), {
        code: 'server',
        userInfo: { serverCode: 'invalid_app_key' },
      })
    );
    const error = await prepare().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(PingfrontError);
    expect(error).toMatchObject({
      code: 'server',
      serverCode: 'invalid_app_key',
    });
  });
});

describe('exportMyData', () => {
  it('resolves with the JSON text from the native SDK', async () => {
    const json = await exportMyData();
    expect(native.exportMyData).toHaveBeenCalledTimes(1);
    expect(JSON.parse(json)).toEqual({ person: { id: 'per_1' } });
  });

  it('rejects with a PingfrontError carrying the native code', async () => {
    native.exportMyData.mockRejectedValueOnce(
      Object.assign(new Error('Not signed in.'), { code: 'session' })
    );
    const error = await exportMyData().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(PingfrontError);
  });
});

describe('chat and moments', () => {
  it('opens the chat with a preset or custom topic', () => {
    openChat();
    openChat({ topic: 'bug' });
    expect(native.openChat.mock.calls).toEqual([[null], [{ id: 'bug' }]]);
  });

  it('moment never throws and decodes the result', async () => {
    native.moment.mockResolvedValueOnce({
      type: 'openRequested',
      presented: true,
    });
    await expect(
      moment('paywall_closed', { seconds: 42, plan: 'pro' })
    ).resolves.toEqual({
      type: 'openRequested',
      presented: true,
    });
    expect(native.moment).toHaveBeenCalledWith('paywall_closed', {
      seconds: 42,
      plan: 'pro',
    });

    native.moment.mockRejectedValueOnce(
      Object.assign(new Error('offline'), { code: 'network' })
    );
    await expect(moment('paywall_closed')).resolves.toEqual({
      type: 'failed',
      error: { code: 'network', message: 'offline' },
    });
  });

  it('fills offer slot defaults in wire format', () => {
    setOffers([{ id: 'yearly_winback', title: 'Pro yearly', kind: 'winback' }]);
    expect(native.setOffers).toHaveBeenCalledWith([
      {
        id: 'yearly_winback',
        title: 'Pro yearly',
        kind: 'winback',
        available: true,
        products: [],
      },
    ]);
  });
});

describe('push', () => {
  it('recognises APNs and FCM payloads without a native call', () => {
    expect(
      isPingFrontPush({ pingfront: { v: 1, kind: 'message' }, aps: {} })
    ).toBe(true);
    expect(isPingFrontPush({ pf_v: '1', pf_kind: 'message' })).toBe(true);
    expect(isPingFrontPush({ aps: { alert: 'Other app' } })).toBe(false);
    expect(isPingFrontPush(undefined)).toBe(false);
  });

  it('passes opened through', async () => {
    await handlePush({ pf_v: '1' }, { opened: true });
    expect(native.handlePush).toHaveBeenCalledWith({ pf_v: '1' }, true);
  });
});

describe('chat links', () => {
  it('hands the URL to the native SDK and resolves its answer', async () => {
    native.handleUrl.mockResolvedValueOnce(true);
    await expect(
      handleUrl('myapp://support?pingfront=chat&topic=billing')
    ).resolves.toBe(true);
    expect(native.handleUrl).toHaveBeenCalledWith(
      'myapp://support?pingfront=chat&topic=billing'
    );
    native.handleUrl.mockResolvedValueOnce(false);
    await expect(handleUrl('https://example.com/settings')).resolves.toBe(
      false
    );
  });

  it('works before configure: the native SDK keeps the link', async () => {
    native.configure.mockClear();
    await expect(handleUrl('myapp://support?pingfront=chat')).resolves.toBe(
      true
    );
    expect(native.configure).not.toHaveBeenCalled();
  });

  it('never sends empty, oversized or non-string values over the bridge', async () => {
    native.handleUrl.mockClear();
    await expect(handleUrl('')).resolves.toBe(false);
    await expect(
      handleUrl('https://example.com/?pingfront=chat&pad=' + 'a'.repeat(2048))
    ).resolves.toBe(false);
    await expect(handleUrl(undefined as unknown as string)).resolves.toBe(
      false
    );
    expect(native.handleUrl).not.toHaveBeenCalled();
  });
});

describe('unread and events', () => {
  it('subscribeUnreadCount fires on changes only', async () => {
    const counts: number[] = [];
    const unsubscribe = subscribeUnreadCount((count) => counts.push(count));
    await flush();
    native.emit('onEvent', { type: 'unreadChanged', count: 2 });
    native.emit('onState', { unreadCount: 2 });
    native.emit('onState', { unreadCount: 0 });
    unsubscribe();
    native.emit('onEvent', { type: 'unreadChanged', count: 5 });
    expect(counts).toEqual([2, 0]);
    expect(getUnreadCount()).toBe(5);
  });

  it('addListener filters by type, and * gets unknown events too', () => {
    const received: string[] = [];
    const all: PingfrontEvent[] = [];
    const one = addListener('messageReceived', (event) =>
      received.push(event.message.preview)
    );
    const every = addListener('*', (event) => all.push(event));
    native.emit('onEvent', {
      type: 'messageReceived',
      message: {
        id: 'm1',
        preview: 'We fixed sync',
        isPing: false,
        isAI: false,
      },
    });
    native.emit('onEvent', { type: 'somethingNew' });
    one.remove();
    every.remove();
    native.emit('onEvent', { type: 'chatOpened' });
    expect(received).toEqual(['We fixed sync']);
    expect(all.map((e) => e.type)).toEqual(['messageReceived', 'unknown']);
  });

  it('a throwing listener does not stop the others', () => {
    const error = jest.spyOn(console, 'error').mockImplementation(() => {});
    const seen: string[] = [];
    addListener('*', () => {
      throw new Error('boom');
    });
    addListener('*', (event) => seen.push(event.type));
    native.emit('onEvent', { type: 'chatOpened' });
    expect(seen).toEqual(['chatOpened']);
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });
});

describe('selfCheck', () => {
  it('parses PASS and FAIL lines', async () => {
    await expect(selfCheck()).resolves.toEqual({
      passed: true,
      line: 'PingFront self-check: PASS',
    });
    expect(
      parseSelfCheck('PingFront self-check: FAIL key_unknown: Copy it again.')
    ).toEqual({
      passed: false,
      code: 'key_unknown',
      line: 'PingFront self-check: FAIL key_unknown: Copy it again.',
    });
  });
});

describe('default export', () => {
  it('mirrors the named functions', () => {
    expect(Pingfront.configure).toBe(configure);
    expect(Pingfront.openChat).toBe(openChat);
    expect(typeof Pingfront.onOffer).toBe('function');
  });
});
