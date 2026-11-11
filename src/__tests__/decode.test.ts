import {
  decodeEvent,
  decodeMomentResult,
  emptySnapshot,
  mergeSnapshot,
} from '../decode';

const request = { offerId: 'yearly', cardId: 'card_1', messageId: 'msg_1' };

describe('decodeEvent', () => {
  it.each([
    [{ type: 'chatOpened' }, { type: 'chatOpened' }],
    [{ type: 'chatClosed' }, { type: 'chatClosed' }],
    [{ type: 'sessionRevoked' }, { type: 'sessionRevoked' }],
    [{ type: 'reportSent' }, { type: 'reportSent' }],
    [
      { type: 'unreadChanged', count: 3 },
      { type: 'unreadChanged', count: 3 },
    ],
    [
      {
        type: 'messageReceived',
        message: {
          id: 'msg_1',
          preview: 'Hi',
          isPing: true,
          isAI: false,
          authorName: 'Deniz',
        },
      },
      {
        type: 'messageReceived',
        message: {
          id: 'msg_1',
          preview: 'Hi',
          isPing: true,
          isAI: false,
          authorName: 'Deniz',
        },
      },
    ],
    [
      { type: 'sessionStarted', person: { id: 'per_1', level: 'guest' } },
      { type: 'sessionStarted', person: { id: 'per_1', level: 'guest' } },
    ],
    [
      { type: 'identityProblem', problem: 'token_expired' },
      { type: 'identityProblem', problem: 'token_expired' },
    ],
    [
      { type: 'offerRequested', request },
      { type: 'offerRequested', request },
    ],
    [
      { type: 'offerCompleted', request, outcome: { type: 'purchased' } },
      { type: 'offerCompleted', request, outcome: { type: 'purchased' } },
    ],
    [
      {
        type: 'offerCompleted',
        request,
        outcome: { type: 'failed', reason: 'network' },
      },
      {
        type: 'offerCompleted',
        request,
        outcome: { type: 'failed', reason: 'network' },
      },
    ],
    [
      { type: 'lookChanged', revision: 4, draft: true },
      { type: 'lookChanged', revision: 4, draft: true },
    ],
    [
      {
        type: 'configurationProblem',
        problem: { kind: 'invalid_key', message: 'Typo', disablesSDK: true },
      },
      {
        type: 'configurationProblem',
        problem: { kind: 'invalid_key', message: 'Typo', disablesSDK: true },
      },
    ],
  ])('maps %j', (raw, expected) => {
    expect(decodeEvent(raw)).toEqual(expected);
  });

  it('passes an event type it does not know through as unknown', () => {
    const raw = { type: 'threadArchived', threadId: 'thr_1' };
    expect(decodeEvent(raw)).toEqual({
      type: 'unknown',
      name: 'threadArchived',
      raw,
    });
  });

  it('keeps the native name of an event the native SDK could not map', () => {
    const raw = { type: 'unknown', name: 'futureEvent' };
    expect(decodeEvent(raw)).toEqual({
      type: 'unknown',
      name: 'futureEvent',
      raw,
    });
  });

  it('turns malformed payloads into unknown instead of throwing', () => {
    expect(decodeEvent(null)).toEqual({
      type: 'unknown',
      name: 'malformed',
      raw: {},
    });
    expect(decodeEvent({ type: 'unreadChanged', count: 'x' }).type).toBe(
      'unknown'
    );
    expect(decodeEvent({ type: 'offerRequested', request: {} }).type).toBe(
      'unknown'
    );
    expect(decodeEvent({ type: 'sessionStarted' }).type).toBe('unknown');
  });

  it('reads a failure without a reason as store_error, the code both native SDKs use', () => {
    expect(
      decodeEvent({
        type: 'offerCompleted',
        request,
        outcome: { type: 'failed' },
      })
    ).toEqual({
      type: 'offerCompleted',
      request,
      outcome: { type: 'failed', reason: 'store_error' },
    });
  });

  it('keeps an offer outcome it does not know', () => {
    const event = decodeEvent({
      type: 'offerCompleted',
      request,
      outcome: { type: 'deferred' },
    });
    expect(event).toEqual({
      type: 'offerCompleted',
      request,
      outcome: { type: 'unknown', name: 'deferred' },
    });
  });
});

describe('decodeMomentResult', () => {
  it.each([
    'notListened',
    'ignored',
    'scheduled',
    'delivered',
    'heldOut',
    'invalidName',
  ])('%s', (type) => {
    expect(decodeMomentResult({ type })).toEqual({ type });
  });

  it('openRequested carries presented', () => {
    expect(
      decodeMomentResult({ type: 'openRequested', presented: false })
    ).toEqual({
      type: 'openRequested',
      presented: false,
    });
  });

  it('failed carries the error', () => {
    expect(
      decodeMomentResult({
        type: 'failed',
        error: { code: 'network', message: 'offline' },
      })
    ).toEqual({
      type: 'failed',
      error: { code: 'network', message: 'offline' },
    });
  });

  it('unknown results stay readable', () => {
    expect(decodeMomentResult({ type: 'queued' })).toEqual({
      type: 'unknown',
      name: 'queued',
    });
  });
});

describe('mergeSnapshot', () => {
  it('applies known fields and keeps the same object when nothing changed', () => {
    const next = mergeSnapshot(emptySnapshot, { unreadCount: 2, extra: true });
    expect(next.unreadCount).toBe(2);
    expect(mergeSnapshot(next, { unreadCount: 2 })).toBe(next);
  });

  it('clears the person on logout', () => {
    const withPerson = mergeSnapshot(emptySnapshot, {
      person: { id: 'per_1', level: 'named', name: 'Riley' },
    });
    expect(withPerson.person).toEqual({
      id: 'per_1',
      level: 'named',
      name: 'Riley',
    });
    expect(mergeSnapshot(withPerson, { person: null }).person).toBeNull();
  });

  it('never goes below zero unread', () => {
    expect(mergeSnapshot(emptySnapshot, { unreadCount: -4 }).unreadCount).toBe(
      0
    );
  });
});
