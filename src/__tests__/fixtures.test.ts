import fs from 'node:fs';
import path from 'node:path';
import {
  decodeConversation,
  decodeEvent,
  decodeOfferRequest,
  decodeTeamAction,
} from '../decode';

// The protocol's conformance fixtures, the wire shapes every pingfront SDK is checked against. The bridge passes
// these shapes through from the native SDKs: messages and cards in the conversation state, the store offer on an
// offer request, team actions, and the native events. Every valid case decodes, and every value the bridge does not
// know decodes to an unknown case instead of throwing.

const root = path.join(__dirname, 'fixtures');

type Case = { name: string; value: unknown };
type Fixture = {
  schema: string;
  valid: Case[];
  invalid?: Case[];
  unknown?: Case[];
};

function fixture(file: string): Fixture {
  return JSON.parse(fs.readFileSync(path.join(root, file), 'utf8')) as Fixture;
}

function record(value: unknown): Record<string, unknown> {
  return value as Record<string, unknown>;
}

/** A conversation state carrying `messages`, as the native side sends it. */
function conversationWith(messages: unknown[]) {
  return decodeConversation({ phase: 'ready', messages, pending: [] });
}

/** A message holding one card part, as the native conversation state carries a card. */
function messageWithCard(card: unknown, result?: unknown) {
  return {
    id: 'msg_1',
    seq: 1,
    author: { kind: 'team' },
    createdAt: '2026-11-01T10:00:00Z',
    parts: [
      { type: 'card', card, ...(result === undefined ? {} : { result }) },
    ],
  };
}

const KNOWN_PARTS = new Set(['text', 'image', 'card', 'receipt', 'unknown']);

describe('protocol fixtures through the bridge decoders', () => {
  it('finds the fixtures', () => {
    expect(fs.existsSync(path.join(root, 'sdk', 'Message.json'))).toBe(true);
  });

  describe('sdk/Message.json', () => {
    const { valid } = fixture('sdk/Message.json');

    it.each(valid.map((c) => [c.name, c.value]))('%s', (_name, value) => {
      const state = conversationWith([value]);
      expect(state.messages).toHaveLength(1);
      const message = state.messages[0]!;
      const raw = record(value);
      expect(message.id).toBe(raw.id);
      expect(message.seq).toBe(raw.seq);
      expect(message.author.kind).toBe(record(raw.author).kind);
      const parts = raw.parts as unknown[];
      expect(message.parts).toHaveLength(parts.length);
      message.parts.forEach((part, index) => {
        expect(KNOWN_PARTS.has(part.type)).toBe(true);
        const wire = record(parts[index]);
        // A part type the bridge knows keeps it; anything else is unknown with its name.
        if (part.type === 'unknown') expect(part.name).toBe(wire.type);
        else expect(part.type).toBe(wire.type);
      });
    });

    it('drops a malformed message and keeps the rest', () => {
      const good = valid[0]!.value;
      const state = conversationWith([{ id: 'x' }, 7, null, good]);
      expect(state.messages.map((m) => m.id)).toEqual([record(good).id]);
    });

    it('decodes an unknown part type, author kind and receipt action without throwing', () => {
      const base = record(valid[0]!.value);
      const state = conversationWith([
        {
          ...base,
          author: { kind: 'robot_from_the_future' },
          parts: [
            { type: 'hologram', depth: 3 },
            { type: 'receipt', action: 'teleported', text: 'Moved' },
            'not an object',
          ],
        },
      ]);
      const message = state.messages[0]!;
      expect(message.author.kind).toBe('robot_from_the_future');
      expect(message.parts[0]).toMatchObject({
        type: 'unknown',
        name: 'hologram',
      });
      expect(message.parts[1]).toEqual({
        type: 'receipt',
        action: 'teleported',
        text: 'Moved',
      });
      expect(message.parts[2]).toMatchObject({
        type: 'unknown',
        name: 'malformed',
      });
    });
  });

  describe('sdk/ThreadResponse.json', () => {
    it.each(
      fixture('sdk/ThreadResponse.json').valid.map((c) => [c.name, c.value])
    )('%s', (_name, value) => {
      const messages = (record(value).messages as unknown[]) ?? [];
      expect(conversationWith(messages).messages).toHaveLength(messages.length);
    });
  });

  describe.each(['sdk/LinkCard.json', 'sdk/StoreActionCard.json'])(
    '%s',
    (file) => {
      it.each(fixture(file).valid.map((c) => [c.name, c.value]))(
        '%s',
        (_name, card) => {
          const part = conversationWith([messageWithCard(card)]).messages[0]!
            .parts[0]!;
          expect(part.type).toBe('card');
          if (part.type !== 'card') return;
          expect(part.card.kind).toBe(record(card).kind);
          expect(part.card.id).toBe(record(card).id);
        }
      );
    }
  );

  it('passes a card kind it does not know through as a card with its kind, never a crash', () => {
    const part = conversationWith([
      messageWithCard({ kind: 'poll', id: 'card_9', question: 'Which?' }),
    ]).messages[0]!.parts[0]!;
    expect(part).toMatchObject({
      type: 'card',
      card: { kind: 'poll', id: 'card_9' },
    });
  });

  describe('sdk/CardResult.json', () => {
    const { valid, unknown = [] } = fixture('sdk/CardResult.json');
    it.each([...valid, ...unknown].map((c) => [c.name, c.value]))(
      '%s',
      (_name, result) => {
        const card = { kind: 'choices', id: 'c1', question: 'q', options: [] };
        const part = conversationWith([messageWithCard(card, result)])
          .messages[0]!.parts[0]!;
        expect(part.type).toBe('card');
        if (part.type !== 'card') return;
        expect(part.result?.at).toBe(record(result).at);
      }
    );
  });

  describe('sdk/StoreOffer.json on an offer request', () => {
    it.each(fixture('sdk/StoreOffer.json').valid.map((c) => [c.name, c.value]))(
      '%s',
      (_name, storeOffer) => {
        const request = decodeOfferRequest({
          offerId: 'yearly',
          cardId: 'card_1',
          messageId: 'msg_1',
          storeOffer,
        });
        expect(request?.storeOffer?.kind).toBe(record(storeOffer).kind);
      }
    );

    it('keeps a store offer kind it does not know as its raw string', () => {
      const request = decodeOfferRequest({
        offerId: 'yearly',
        cardId: 'card_1',
        messageId: 'msg_1',
        storeOffer: { kind: 'lifetime_upgrade', id: 'x' },
      });
      expect(request?.storeOffer?.kind).toBe('lifetime_upgrade');
    });
  });

  describe('sdk/TeamActionPayload.json', () => {
    it.each(
      fixture('sdk/TeamActionPayload.json').valid.map((c) => [c.name, c.value])
    )('%s', (_name, value) => {
      const action = decodeTeamAction(value);
      expect(action?.id).toBe(record(value).id);
      expect(action?.actionId).toBe(record(value).actionId);
    });
  });

  describe('live/ServerEvent.json', () => {
    const { valid, invalid = [] } = fixture('live/ServerEvent.json');

    it.each(valid.map((c) => [c.name, c.value]))('%s', (_name, value) => {
      const event = record(value);
      // The native SDK turns live events into its own; the bridge never sees wire names it knows, so a wire event
      // reaching `decodeEvent` is unknown, never a crash.
      expect(decodeEvent(value).type).toBeDefined();
      // The message a live event carries is the one the conversation state passes through.
      if (event.type === 'message') {
        expect(conversationWith([event.message]).messages).toHaveLength(1);
      }
      if (event.type === 'team_action') {
        expect(decodeTeamAction(event.action)).not.toBeNull();
      }
    });

    it.each(invalid.map((c) => [c.name, c.value]))(
      'never throws on: %s',
      (_name, value) => {
        expect(() => decodeEvent(value)).not.toThrow();
        expect(() =>
          conversationWith([record(value ?? {}).message])
        ).not.toThrow();
      }
    );

    it('decodes an event type it does not know to unknown', () => {
      expect(decodeEvent({ type: 'aurora', at: 1 })).toMatchObject({
        type: 'unknown',
      });
      expect(decodeEvent(null)).toMatchObject({ type: 'unknown' });
    });
  });
});
