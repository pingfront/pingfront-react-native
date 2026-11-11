import type {
  ColorPair,
  ConfigurationProblem,
  ConversationMessage,
  ConversationState,
  LogEntry,
  MessageAuthor,
  MessagePart,
  MomentResult,
  OpenedCard,
  PendingMessage,
  PingfrontLook,
  SentMessage,
  TeamAction,
  WireCard,
  OfferOutcome,
  OfferRequest,
  Person,
  PingfrontErrorInfo,
  PingfrontEvent,
  PingfrontSnapshot,
  ReceivedMessage,
} from './types';

/**
 * Maps what the native side sends into the public types. The native side is trusted to send the
 * shapes in `specs/NativePingfront.ts`, but a newer native SDK may add event types or fields, so
 * every decoder tolerates extra fields and turns anything it cannot read into an `unknown` case
 * instead of throwing.
 */

type Raw = Record<string, unknown>;

function isRecord(value: unknown): value is Raw {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function str(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function bool(value: unknown): boolean {
  return value === true;
}

function num(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value)
    ? value
    : undefined;
}

function decodePerson(value: unknown): Person | null {
  if (!isRecord(value)) return null;
  const id = str(value.id);
  const level = str(value.level);
  if (!id || !level) return null;
  const person: Person = { id, level };
  const name = str(value.name);
  if (name !== undefined) person.name = name;
  if (isRecord(value.entitlement) && str(value.entitlement.state)) {
    person.entitlement = value.entitlement as unknown as Person['entitlement'];
  }
  return person;
}

export function decodeOfferRequest(value: unknown): OfferRequest | null {
  if (!isRecord(value)) return null;
  const offerId = str(value.offerId);
  const cardId = str(value.cardId);
  const messageId = str(value.messageId);
  if (!offerId || !cardId || !messageId) return null;
  const request: OfferRequest = { offerId, cardId, messageId };
  if (isRecord(value.slot) && str(value.slot.id)) {
    request.slot = value.slot as unknown as OfferRequest['slot'];
  }
  if (isRecord(value.storeOffer) && str(value.storeOffer.kind)) {
    request.storeOffer =
      value.storeOffer as unknown as OfferRequest['storeOffer'];
  }
  return request;
}

const outcomes = new Set(['purchased', 'pending', 'cancelled', 'unavailable']);

function decodeOfferOutcome(value: unknown): OfferOutcome {
  const type = isRecord(value) ? str(value.type) : undefined;
  if (type && outcomes.has(type)) return { type } as OfferOutcome;
  if (type === 'failed' && isRecord(value)) {
    return { type: 'failed', reason: str(value.reason) ?? 'store_error' };
  }
  return { type: 'unknown', name: type ?? 'missing' };
}

function decodeMessage(value: unknown): ReceivedMessage | null {
  if (!isRecord(value)) return null;
  const id = str(value.id);
  if (!id) return null;
  const message: ReceivedMessage = {
    id,
    preview: str(value.preview) ?? '',
    isPing: bool(value.isPing),
    isAI: bool(value.isAI),
  };
  const authorName = str(value.authorName);
  if (authorName !== undefined) message.authorName = authorName;
  return message;
}

function decodeSentMessage(value: unknown): SentMessage | null {
  if (!isRecord(value)) return null;
  const id = str(value.id);
  if (!id) return null;
  return {
    id,
    textLength: num(value.textLength) ?? 0,
    photoCount: num(value.photoCount) ?? 0,
    repliesToPing: bool(value.repliesToPing),
  };
}

function decodeOpenedCard(value: unknown): OpenedCard | null {
  if (!isRecord(value)) return null;
  const kind = str(value.kind);
  const cardId = str(value.cardId);
  const messageId = str(value.messageId);
  if (!kind || !cardId || !messageId) return null;
  return { kind, cardId, messageId };
}

function decodeProblem(value: unknown): ConfigurationProblem | null {
  if (!isRecord(value)) return null;
  const kind = str(value.kind);
  const message = str(value.message);
  if (!kind || message === undefined) return null;
  return { kind, message, disablesSDK: bool(value.disablesSDK) };
}

function unknownEvent(name: string, raw: Raw): PingfrontEvent {
  return { type: 'unknown', name, raw };
}

/** One native event. Never throws. */
export function decodeEvent(value: unknown): PingfrontEvent {
  if (!isRecord(value)) return unknownEvent('malformed', {});
  const type = str(value.type) ?? 'missing';
  switch (type) {
    case 'chatOpened':
    case 'chatClosed':
    case 'sessionRevoked':
    case 'reportSent':
      return { type };
    case 'messageReceived': {
      const message = decodeMessage(value.message);
      return message ? { type, message } : unknownEvent(type, value);
    }
    case 'messageSent': {
      const message = decodeSentMessage(value.message);
      return message ? { type, message } : unknownEvent(type, value);
    }
    case 'cardOpened': {
      const card = decodeOpenedCard(value.card);
      return card ? { type, card } : unknownEvent(type, value);
    }
    case 'unreadChanged': {
      const count = num(value.count);
      return count !== undefined ? { type, count } : unknownEvent(type, value);
    }
    case 'sessionStarted': {
      const person = decodePerson(value.person);
      return person ? { type, person } : unknownEvent(type, value);
    }
    case 'identityProblem':
      return { type, problem: str(value.problem) ?? 'unknown' };
    case 'offerRequested': {
      const request = decodeOfferRequest(value.request);
      return request ? { type, request } : unknownEvent(type, value);
    }
    case 'offerCompleted': {
      const request = decodeOfferRequest(value.request);
      return request
        ? { type, request, outcome: decodeOfferOutcome(value.outcome) }
        : unknownEvent(type, value);
    }
    case 'lookChanged': {
      const revision = num(value.revision);
      return revision !== undefined
        ? { type, revision, draft: bool(value.draft) }
        : unknownEvent(type, value);
    }
    case 'configurationProblem': {
      const problem = decodeProblem(value.problem);
      return problem ? { type, problem } : unknownEvent(type, value);
    }
    case 'unknown':
      return unknownEvent(str(value.name) ?? 'unknown', value);
    default:
      return unknownEvent(type, value);
  }
}

export function decodeError(value: unknown): PingfrontErrorInfo {
  if (!isRecord(value)) return { code: 'unexpected', message: String(value) };
  const info: PingfrontErrorInfo = {
    code: str(value.code) ?? 'unexpected',
    message: str(value.message) ?? '',
  };
  const serverCode = str(value.serverCode);
  if (serverCode) info.serverCode = serverCode;
  return info;
}

const simpleMoments = new Set([
  'notListened',
  'ignored',
  'scheduled',
  'delivered',
  'heldOut',
  'invalidName',
]);

export function decodeMomentResult(value: unknown): MomentResult {
  const type = isRecord(value) ? str(value.type) : undefined;
  if (type && simpleMoments.has(type)) return { type } as MomentResult;
  if (type === 'openRequested' && isRecord(value)) {
    return { type, presented: bool(value.presented) };
  }
  if (type === 'failed' && isRecord(value)) {
    return { type, error: decodeError(value.error) };
  }
  return { type: 'unknown', name: type ?? 'missing' };
}

/** One native log line, or null when it is not one. Never throws. */
export function decodeLogEntry(value: unknown): LogEntry | null {
  if (!isRecord(value)) return null;
  const level = str(value.level);
  const message = str(value.message);
  if (!level || message === undefined) return null;
  const entry: LogEntry = { level, message };
  const category = str(value.category);
  if (category) entry.category = category;
  return entry;
}

/** The fields of a team action; `complete` and `fail` are added by the caller. Never throws. */
export function decodeTeamAction(
  value: unknown
): Omit<TeamAction, 'complete' | 'fail'> | null {
  if (!isRecord(value)) return null;
  const id = str(value.id);
  const actionId = str(value.actionId);
  const createdAt = str(value.createdAt);
  const expiresAt = str(value.expiresAt);
  if (!id || !actionId || !createdAt || !expiresAt) return null;
  const fields: Record<string, string> = {};
  if (isRecord(value.fields)) {
    for (const [key, field] of Object.entries(value.fields)) {
      if (typeof field === 'string') fields[key] = field;
    }
  }
  const action: Omit<TeamAction, 'complete' | 'fail'> = {
    id,
    actionId,
    name: str(value.name) ?? actionId,
    fields,
    ackRequired: bool(value.ackRequired),
    createdAt,
    expiresAt,
  };
  const days = num(value.days);
  if (days !== undefined) action.days = days;
  const until = str(value.until);
  if (until) action.until = until;
  return action;
}

const hex = /^#[0-9A-Fa-f]{6}$/;

function decodeColor(value: unknown): ColorPair | null {
  if (!isRecord(value)) return null;
  const light = str(value.light);
  const dark = str(value.dark);
  if (!light || !dark || !hex.test(light) || !hex.test(dark)) return null;
  return { light: light.toUpperCase(), dark: dark.toUpperCase() };
}

/** The resolved look, or null when it is missing or malformed. Unknown enum values pass through. */
export function decodeLook(value: unknown): PingfrontLook | null {
  if (!isRecord(value)) return null;
  const colors = {
    accent: decodeColor(value.accent),
    onAccent: decodeColor(value.onAccent),
    background: decodeColor(value.background),
    teamBubble: decodeColor(value.teamBubble),
    text: decodeColor(value.text),
    muted: decodeColor(value.muted),
  };
  for (const color of Object.values(colors)) if (!color) return null;
  const topics = Array.isArray(value.topics)
    ? value.topics.filter((id): id is string => typeof id === 'string')
    : [];
  return {
    appName: str(value.appName) ?? '',
    accent: colors.accent!,
    onAccent: colors.onAccent!,
    background: colors.background!,
    teamBubble: colors.teamBubble!,
    text: colors.text!,
    muted: colors.muted!,
    scheme: str(value.scheme) ?? 'auto',
    font: str(value.font) ?? 'system',
    corners: str(value.corners) ?? 'round',
    density: str(value.density) ?? 'comfortable',
    headerStyle: str(value.headerStyle) ?? 'person',
    topics,
  };
}

function decodeAuthor(value: unknown): MessageAuthor | null {
  if (!isRecord(value)) return null;
  const kind = str(value.kind);
  if (!kind) return null;
  const author: MessageAuthor = { kind };
  for (const key of ['id', 'name', 'avatarUrl'] as const) {
    const field = str(value[key]);
    if (field !== undefined) author[key] = field;
  }
  return author;
}

function decodePart(value: unknown): MessagePart {
  if (!isRecord(value)) return { type: 'unknown', name: 'malformed', raw: {} };
  const type = str(value.type) ?? 'missing';
  switch (type) {
    case 'text': {
      const text = str(value.text);
      if (text !== undefined) return { type, text };
      break;
    }
    case 'image': {
      const attachmentId = str(value.attachmentId);
      const width = num(value.width);
      const height = num(value.height);
      if (attachmentId && width !== undefined && height !== undefined) {
        const part: MessagePart = { type, attachmentId, width, height };
        const url = str(value.url);
        if (url) part.url = url;
        if (value.removed === true) part.removed = true;
        return part;
      }
      break;
    }
    case 'card': {
      const card = value.card;
      if (isRecord(card) && str(card.kind) && str(card.id)) {
        const part: MessagePart = { type, card: card as WireCard };
        const result = decodeCardResult(value.result);
        if (result) part.result = result;
        return part;
      }
      break;
    }
    case 'receipt': {
      const action = str(value.action);
      const text = str(value.text);
      if (action && text !== undefined) return { type, action, text };
      break;
    }
  }
  return { type: 'unknown', name: type, raw: value };
}

function decodeCardResult(
  value: unknown
): { at: string; choiceId?: string; rating?: number } | undefined {
  if (!isRecord(value)) return undefined;
  const at = str(value.at);
  if (!at) return undefined;
  const result: { at: string; choiceId?: string; rating?: number } = { at };
  const choiceId = str(value.choiceId);
  if (choiceId) result.choiceId = choiceId;
  const rating = num(value.rating);
  if (rating !== undefined) result.rating = rating;
  return result;
}

function decodeTranslation(
  value: unknown
): ConversationMessage['translation'] | undefined {
  if (!isRecord(value)) return undefined;
  const language = str(value.language);
  if (!language || !Array.isArray(value.parts)) return undefined;
  const parts = value.parts
    .map((part) => (isRecord(part) ? str(part.text) : undefined))
    .filter((text): text is string => text !== undefined)
    .map((text) => ({ text }));
  const translation: NonNullable<ConversationMessage['translation']> = {
    language,
    parts,
  };
  const from = str(value.from);
  if (from) translation.from = from;
  return translation;
}

function decodeConversationMessage(value: unknown): ConversationMessage | null {
  if (!isRecord(value)) return null;
  const id = str(value.id);
  const seq = num(value.seq);
  const author = decodeAuthor(value.author);
  const createdAt = str(value.createdAt);
  if (!id || seq === undefined || !author || !createdAt) return null;
  const message: ConversationMessage = {
    id,
    seq,
    author,
    parts: Array.isArray(value.parts) ? value.parts.map(decodePart) : [],
    createdAt,
  };
  const clientId = str(value.clientId);
  if (clientId) message.clientId = clientId;
  if (isRecord(value.ping)) message.ping = value.ping;
  const fallback = str(value.fallback);
  if (fallback !== undefined) message.fallback = fallback;
  const translation = decodeTranslation(value.translation);
  if (translation) message.translation = translation;
  return message;
}

function decodePending(value: unknown): PendingMessage | null {
  if (!isRecord(value)) return null;
  const clientId = str(value.clientId);
  if (!clientId) return null;
  const heldFor = str(value.heldFor) || null;
  const pending: PendingMessage = {
    clientId,
    photoCount: num(value.photoCount) ?? 0,
    state: str(value.state) ?? 'queued',
    heldFor,
    isHeld: heldFor !== null,
  };
  const text = str(value.text);
  if (text !== undefined) pending.text = text;
  const failure = str(value.failure);
  if (failure) pending.failure = failure;
  return pending;
}

export const emptyConversation: ConversationState = Object.freeze({
  phase: 'idle',
  messages: [],
  pending: [],
  hasOlder: false,
  isLoadingOlder: false,
  typing: null,
  replyExpectation: null,
  policy: 'open',
  status: 'open',
  teamReadSeq: 0,
  isOffline: false,
  isServerUnreachable: false,
});

/**
 * The conversation state the native side sends. Malformed messages are dropped, never thrown. When `messages` or
 * `pending` are left out (they did not change), the ones from `previous` are kept.
 */
export function decodeConversation(
  value: unknown,
  previous: ConversationState = emptyConversation
): ConversationState {
  if (!isRecord(value)) return emptyConversation;
  const list = <T>(items: unknown, decode: (item: unknown) => T | null) =>
    Array.isArray(items)
      ? items.map(decode).filter((item): item is T => item !== null)
      : [];
  const typing = isRecord(value.typing)
    ? {
        ...(str(value.typing.name) ? { name: str(value.typing.name) } : {}),
        isAI: bool(value.typing.isAI),
      }
    : null;
  return {
    phase: str(value.phase) ?? 'idle',
    messages:
      'messages' in value
        ? list(value.messages, decodeConversationMessage)
        : previous.messages,
    pending:
      'pending' in value
        ? list(value.pending, decodePending)
        : previous.pending,
    hasOlder: bool(value.hasOlder),
    isLoadingOlder: bool(value.isLoadingOlder),
    typing,
    replyExpectation: str(value.replyExpectation) ?? null,
    policy: str(value.policy) ?? 'open',
    status: str(value.status) ?? 'open',
    teamReadSeq: num(value.teamReadSeq) ?? 0,
    isOffline: bool(value.isOffline),
    isServerUnreachable: bool(value.isServerUnreachable),
  };
}

export const emptySnapshot: PingfrontSnapshot = Object.freeze({
  isConfigured: false,
  unreadCount: 0,
  person: null,
  isChatVisible: false,
  isTestDevice: false,
  configurationProblem: null,
  storeAccountToken: null,
  language: null,
  look: null,
});

/** Applies a full or partial native snapshot over `base`. Unknown and malformed fields are ignored. */
export function mergeSnapshot(
  base: PingfrontSnapshot,
  value: unknown
): PingfrontSnapshot {
  if (!isRecord(value)) return base;
  const next: PingfrontSnapshot = { ...base };
  if ('isConfigured' in value) next.isConfigured = bool(value.isConfigured);
  if ('unreadCount' in value) {
    const count = num(value.unreadCount);
    if (count !== undefined) next.unreadCount = Math.max(0, Math.floor(count));
  }
  if ('person' in value) next.person = decodePerson(value.person);
  if ('isChatVisible' in value) next.isChatVisible = bool(value.isChatVisible);
  if ('isTestDevice' in value) next.isTestDevice = bool(value.isTestDevice);
  if ('configurationProblem' in value) {
    next.configurationProblem = decodeProblem(value.configurationProblem);
  }
  if ('storeAccountToken' in value) {
    next.storeAccountToken = str(value.storeAccountToken) ?? null;
  }
  if ('language' in value) next.language = str(value.language) ?? null;
  if ('look' in value) next.look = decodeLook(value.look);
  const changed = (Object.keys(next) as Array<keyof PingfrontSnapshot>).some(
    (key) => !sameValue(next[key], base[key])
  );
  return changed ? next : base;
}

function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (!isRecord(a) || !isRecord(b)) return false;
  return JSON.stringify(a) === JSON.stringify(b);
}

/** An `onScreenRequest`: `{ requestId, id, params }`. Params that aren't strings are left out. */
export function decodeScreenRequest(
  value: unknown
): { requestId: string; screen: import('./types').LinkScreen } | null {
  if (!isRecord(value)) return null;
  const requestId = str(value.requestId);
  const id = str(value.id);
  if (!requestId || !id) return null;
  const params: Record<string, string> = {};
  if (isRecord(value.params)) {
    for (const [key, param] of Object.entries(value.params)) {
      if (typeof param === 'string') params[key] = param;
    }
  }
  return { requestId, screen: { id, params } };
}
