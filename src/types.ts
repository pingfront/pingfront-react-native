/**
 * Public types. Shapes that cross the wire follow pingfront's API (https://pingfront.sh/openapi.yaml:
 * camelCase, ISO-8601 timestamps), so a value here means the same thing it means on the server and in the
 * native SDKs. Enums the server or vendors can extend are open: an unknown value comes through as a
 * plain string instead of failing.
 */

/** A string union that still accepts values a newer server or SDK sends. */
export type Open<T extends string> = T | (string & {});

// Configuration

/** `#RRGGBB`, or a light and a dark value. */
export type Color = string | { light: string; dark: string };

/** Topic presets, with labels the native SDKs translate. */
export type TopicPreset =
  | 'billing'
  | 'bug'
  | 'idea'
  | 'question'
  | 'account'
  | 'feedback'
  | 'restore'
  | 'gift'
  | 'privacy';

export type TopicSymbol = TopicPreset | 'other';

/** A topic chip on the welcome screen: a preset id, or your own. */
export type ChatTopic =
  | TopicPreset
  | {
      /** `[a-z0-9_-]{1,32}` */
      id: string;
      /** The label, or labels by language tag with a `default`. */
      label: string | Record<string, string>;
      symbol?: TopicSymbol;
      /** With a prefill, tapping the chip fills the composer; without, it starts the thread on the topic. */
      prefill?: string | Record<string, string>;
    };

/** Look values set in code. The look published in the dashboard wins, field by field. */
export interface ChatLook {
  accent?: Color;
  background?: Color;
  teamBubble?: Color;
  scheme?: 'auto' | 'light' | 'dark';
  font?: 'system' | 'rounded' | 'serif';
  corners?: 'round' | 'soft' | 'square';
  density?: 'comfortable' | 'compact';
  headerStyle?: 'person' | 'team' | 'app';
  headerMemberId?: string;
  headerTitle?: string;
  replyExpectation?: string;
  showsReplyExpectation?: boolean;
  showsLocalTime?: boolean;
  welcomeTitle?: string;
  welcomeBody?: string;
  showsWelcomeFaces?: boolean;
  composerPlaceholder?: string;
  allowsPhotos?: boolean;
  allowsReports?: boolean;
  showsNames?: boolean;
  showsAvatars?: boolean;
  timestamps?: 'grouped' | 'always';
  aiName?: string;
  /** Android 12+: Material You colors. Off by default. Ignored on iOS. */
  useDynamicColor?: boolean;
}

/** Optional native modules. Each one is off until you turn it on here. */
export interface ModulesOptions {
  /**
   * Push. iOS: notification presentation and tap routing (installs a notification delegate only when
   * the app has none). Android: FCM through `pingfront-push` (needs Firebase in the app).
   */
  push?: boolean;
  /** iOS StoreKit 2: entitlements, offer cards, review prompt. `products` become offer slots. */
  storeKit?: boolean | { products: string[] };
  /** Android Google Play Billing: entitlements, offer cards, In-App Review. */
  billing?: boolean | { products: string[] };
  /** Bug reports: shake to report, screenshot markup, log tail. */
  reports?: boolean | { shakeToReport?: boolean; logTail?: boolean };
  /**
   * Vendor adapters (`revenuecat`, `superwall`, `adapty`) registered in native code, by id. The
   * adapters wrap vendor SDKs, so they are opt-in native dependencies; see the README.
   */
  vendors?: string[];
}

export type LogLevel = 'off' | 'error' | 'info' | 'debug';

/** One native SDK log line, as the native log handler gives it: already redacted, safe to store or upload. */
export interface LogEntry {
  /** `error`, `info` or `debug`. A level a newer SDK adds comes through as its name. */
  level: Open<Exclude<LogLevel, 'off'>>;
  /** The redacted line: ids, names, emails, URLs, tokens, server text and user input appear as `<private>`. */
  message: string;
  /** The SDK area the line comes from (`session`, `network`, `live`, ...). */
  category?: string;
}

export interface ConfigureOptions {
  /** API base URL. Default: production. Local development: `http://localhost:<port>/v1`. */
  baseUrl?: string;
  /** Native log level. Default `info`. `debug` logs request paths and statuses, never bodies or tokens. */
  logLevel?: LogLevel;
  /**
   * Routes the native SDK's log lines (at or above `logLevel`) to your logger, in addition to unified logging
   * or Logcat. Lines arrive already redacted. Keep it fast, and keep it to logging: lines arrive asynchronously, so a
   * handler that calls the pingfront API (which logs) would feed itself. A handler that throws is reported once.
   */
  logHandler?: (entry: LogEntry) => void;
  /**
   * The chat's language, for apps with their own language picker: a BCP 47 tag such as `de` or `pt-BR`.
   * Default: follow the app's and the system's language. Change it later with `setLanguage`.
   */
  language?: string;
  /** Present the chat when the server answers a moment with `open`. Default true. */
  presentsChatForMoments?: boolean;
  /** Up to six topic chips. */
  topics?: ChatTopic[];
  look?: ChatLook;
  modules?: ModulesOptions;
  /** iOS: the APNs environment of push tokens. Default: sandbox in debug builds, production otherwise. */
  pushEnvironment?: 'sandbox' | 'production';
}

// Wire values

export type EntitlementState =
  | 'none'
  | 'trial'
  | 'active'
  | 'grace'
  | 'billing_retry'
  | 'cancelled'
  | 'expired'
  | 'lifetime';

export interface Entitlement {
  state: Open<EntitlementState>;
  productId?: string;
  /** ISO-8601 */
  renewsAt?: string;
  /** ISO-8601 (Android) */
  expiresAt?: string;
  /** ISO-8601 (Android) */
  gracePeriodEndsAt?: string;
  source?: Open<
    | 'storekit'
    | 'play'
    | 'revenuecat'
    | 'superwall'
    | 'adapty'
    | 'stripe'
    | 'app'
  >;
}

export interface Person {
  id: string;
  level: Open<'guest' | 'named' | 'verified'>;
  name?: string;
  entitlement?: Entitlement;
}

export interface OfferProduct {
  id: string;
  /** Localized display price, for example `€4.99`. */
  price: string;
  /** ISO-8601 period, for example `P1M`. */
  period?: string;
  /** ISO-8601 trial period, for example `P1W`. */
  trial?: string;
}

export interface OfferSlot {
  /** `[A-Za-z0-9_.-]{1,64}`, referenced by offer cards. */
  id: string;
  /** At most 60 characters. */
  title: string;
  kind?: Open<'standard' | 'discount' | 'winback'>;
  /** Default true. */
  available?: boolean;
  products?: OfferProduct[];
  source?: Open<
    'app' | 'storekit' | 'play' | 'revenuecat' | 'superwall' | 'adapty'
  >;
}

export interface StoreOffer {
  kind: Open<'promotional' | 'winback' | 'code' | 'intro'>;
  id: string;
  productId?: string;
  /** Google Play only. */
  basePlanId?: string;
  /** Google Play only. */
  offerId?: string;
}

/** An offer card the person tapped. */
export interface OfferRequest {
  /** The `OfferSlot.id` the card names. */
  offerId: string;
  cardId: string;
  messageId: string;
  /** The matching slot from `setOffers` or a module, if any. */
  slot?: OfferSlot;
  /** The store offer the card redeems, so your paywall can show the promo. */
  storeOffer?: StoreOffer;
}

export type OfferOutcome =
  | { type: 'purchased' }
  | { type: 'pending' }
  | { type: 'cancelled' }
  | { type: 'unavailable' }
  /**
   * `reason` is the native SDK's code: `product_not_found` or `store_error` on both platforms; `network`,
   * `not_allowed` or `not_verified` on iOS; `billing_unavailable`, `no_activity` or `in_progress` on Android.
   */
  | { type: 'failed'; reason: string }
  | { type: 'unknown'; name: string };

export interface ReceivedMessage {
  id: string;
  authorName?: string;
  /** The first text, truncated: safe for an in-app banner. */
  preview: string;
  /** The team reached out before the person wrote. */
  isPing: boolean;
  /** Written by the assistant. */
  isAI: boolean;
}

export interface ConfigurationProblem {
  kind: Open<
    | 'missing_key'
    | 'invalid_key'
    | 'unknown_key'
    | 'app_paused'
    | 'keychain'
    | 'offer_handler'
    | 'option'
  >;
  /** The exact problem and what to do. */
  message: string;
  /** The SDK disabled itself. */
  disablesSDK: boolean;
}

export type IdentityProblem = Open<
  'token_invalid' | 'token_expired' | 'user_mismatch' | 'unknown'
>;

/** A summary of a message the person sent, for analytics. It carries no message text. */
export interface SentMessage {
  id: string;
  /** Characters of text (0 for a photo-only message). */
  textLength: number;
  photoCount: number;
  /** The latest team message before it is a ping: the person is answering a ping. */
  repliesToPing: boolean;
}

export type CardKind =
  | 'offer'
  | 'review'
  | 'link'
  | 'choices'
  | 'rating'
  | 'report'
  | 'store_action';

/** A card the person tapped or answered. */
export interface OpenedCard {
  /** The wire name; kinds a newer server adds keep their name. */
  kind: Open<CardKind>;
  cardId: string;
  messageId: string;
}

// Events

/** Events from the native SDK. Types this version does not know arrive as `{ type: 'unknown' }`. */
export type PingfrontEvent =
  | { type: 'chatOpened' }
  | { type: 'chatClosed' }
  | { type: 'messageReceived'; message: ReceivedMessage }
  /** The server accepted a message the person wrote (after any queueing and photo uploads). */
  | { type: 'messageSent'; message: SentMessage }
  /** The person tapped a card (offer, review, link, report, store action) or answered one (choices, rating). */
  | { type: 'cardOpened'; card: OpenedCard }
  | { type: 'unreadChanged'; count: number }
  | { type: 'sessionStarted'; person: Person }
  /**
   * The server revoked this install (a logout or erase elsewhere): the SDK starts over as a guest. Messages still queued
   * in the outbox are dropped by design, so text never goes out under a different guest.
   */
  | { type: 'sessionRevoked' }
  | { type: 'identityProblem'; problem: IdentityProblem }
  | { type: 'offerRequested'; request: OfferRequest }
  | { type: 'offerCompleted'; request: OfferRequest; outcome: OfferOutcome }
  | { type: 'lookChanged'; revision: number; draft: boolean }
  | { type: 'configurationProblem'; problem: ConfigurationProblem }
  | { type: 'reportSent' }
  | {
      type: 'unknown';
      /** The native name of the event, for logging. */
      name: string;
      /** Whatever the native side sent with it. */
      raw: Record<string, unknown>;
    };

export type PingfrontEventType = PingfrontEvent['type'];

// Results

export type MomentProps = Record<string, string | number | boolean>;

export type MomentResult =
  /** No play listens to the moment, so nothing was sent. */
  | { type: 'notListened' }
  /** Sent; no play reacted. */
  | { type: 'ignored' }
  | { type: 'scheduled' }
  | { type: 'delivered' }
  | { type: 'heldOut' }
  /** The server asked to open the chat; `presented` is false when `presentsChatForMoments` is off. */
  | { type: 'openRequested'; presented: boolean }
  | { type: 'invalidName' }
  | { type: 'failed'; error: PingfrontErrorInfo }
  | { type: 'unknown'; name: string };

export interface PingfrontErrorInfo {
  /** `not_configured`, `invalid_key`, `network`, `cooling_down`, `invalid_input`, `server`, ... */
  code: string;
  /** The server's error code (`invalid_app_key`, `app_paused`, ...) for `server` errors. */
  serverCode?: string;
  message: string;
}

/** A color as `#RRGGBB` for light and dark mode. */
export interface ColorPair {
  light: string;
  dark: string;
}

/** The resolved chat look (dashboard > code > host app > defaults), for matching your own screens to the chat. */
export interface PingfrontLook {
  appName: string;
  accent: ColorPair;
  onAccent: ColorPair;
  background: ColorPair;
  teamBubble: ColorPair;
  text: ColorPair;
  muted: ColorPair;
  scheme: Open<'auto' | 'light' | 'dark'>;
  font: Open<'system' | 'rounded' | 'serif'>;
  corners: Open<'round' | 'soft' | 'square'>;
  density: Open<'comfortable' | 'compact'>;
  headerStyle: Open<'person' | 'team' | 'app'>;
  /** The topic ids on the welcome screen, in order. */
  topics: string[];
}

/** The state hooks read. */
export interface PingfrontSnapshot {
  isConfigured: boolean;
  unreadCount: number;
  person: Person | null;
  isChatVisible: boolean;
  isTestDevice: boolean;
  configurationProblem: ConfigurationProblem | null;
  /**
   * The person's store account token, once a session exists. iOS: pass it as `appAccountToken` in your own
   * StoreKit purchases. Android: Play's `obfuscatedAccountId`. Either way store notifications match the person.
   */
  storeAccountToken: string | null;
  /** The language override (`setLanguage`), or null when the chat follows the app and the system. */
  language: string | null;
  /** The resolved chat look; null before `configure`. */
  look: PingfrontLook | null;
}

/** What a silent pingfront push did (iOS `handleBackgroundPush`), for the system's background-fetch result. */
export type BackgroundPushResult = 'newData' | 'noData' | 'failed';

// Saved links (https://pingfront.sh/docs/offers#saved-links)

/** A screen of your app that the team's saved links can open: `registerScreens([...])`. */
export interface AppScreen {
  /** Your own route id, such as `settings.sound` or `plans/yearly`: `^[A-Za-z0-9][A-Za-z0-9_./:-]{0,99}$`. */
  id: string;
  /** What the team sees in the dashboard ("Sound settings"), at most 60 characters. Never shown to the person. */
  title?: string;
}

/** A link card's screen, handed to the `onScreen` handler. Only for screens this build registered. */
export interface LinkScreen {
  /** The screen's id, one you registered (`AppScreen.id`). */
  id: string;
  /** String parameters for the screen (`{ tab: 'yearly' }`), as the team set them. */
  params: Record<string, string>;
}

// Team actions

/** An action a teammate ran from the inbox that your app has to do ("Fix it for them"). */
export interface TeamAction {
  /** This run's id. Do the work once per id. */
  id: string;
  /** `extend_trial`, `grant_access`, or the id of one of your own actions. */
  actionId: string;
  /** The action's name, as your team sees it. */
  name: string;
  /** The values the teammate filled in, by field key. */
  fields: Record<string, string>;
  /** Days, for `extend_trial` and `grant_access`. */
  days?: number;
  /** ISO-8601: the new end of access, for `extend_trial` and `grant_access`. */
  until?: string;
  /** The receipt line in the thread waits for `complete()`. */
  ackRequired: boolean;
  /** ISO-8601 */
  createdAt: string;
  /** ISO-8601: after this the action expires and nothing is posted. */
  expiresAt: string;
  /**
   * Tells the team it is done; the receipt line posts in the thread. Stored and retried natively. The first
   * answer wins: later `complete()` or `fail()` calls for this delivery do nothing.
   */
  complete(): Promise<void>;
  /**
   * Tells the team it could not be done. `message` is shown to the team, never to the person (200 characters).
   * The first answer wins.
   */
  fail(message: string): Promise<void>;
}

// Conversation (build your own UI)

export interface MessageAuthor {
  kind: Open<'person' | 'team' | 'ai' | 'system'>;
  id?: string;
  name?: string;
  avatarUrl?: string;
}

/** A card in wire format (`Card` in the protocol): `kind`, `id` and the kind's own fields. */
export type WireCard = { kind: Open<CardKind>; id: string } & Record<
  string,
  unknown
>;

export type MessagePart =
  | { type: 'text'; text: string }
  | {
      type: 'image';
      attachmentId: string;
      width: number;
      height: number;
      url?: string;
      removed?: boolean;
    }
  | {
      type: 'card';
      card: WireCard;
      result?: { at: string; choiceId?: string; rating?: number };
    }
  | { type: 'receipt'; action: string; text: string }
  /** A part type this version does not know: show the message's `fallback`. */
  | { type: 'unknown'; name: string; raw: Record<string, unknown> };

/** A message in the thread, in wire format (`Message` in the protocol). */
export interface ConversationMessage {
  id: string;
  seq: number;
  clientId?: string;
  author: MessageAuthor;
  parts: MessagePart[];
  /** ISO-8601 */
  createdAt: string;
  /** Set when the team reached out before the person wrote. */
  ping?: Record<string, unknown>;
  /** Plain text of the whole message, for parts or cards this version does not know. */
  fallback?: string;
  translation?: {
    language: string;
    /** The language the message was written in, when the server knows it. */
    from?: string;
    parts: Array<{ text: string }>;
  };
}

/** A message the person sent that the server has not acknowledged yet. */
export interface PendingMessage {
  clientId: string;
  text?: string;
  photoCount: number;
  state: Open<'queued' | 'sending' | 'failed'>;
  /** Why it failed, in plain words, once it failed. */
  failure?: string;
  /**
   * Why a closed policy holds it (`app_paused`, `verification_required`), or `null`. A held message is `failed` but
   * needs nothing from the person: the native outbox sends it again by itself, first, when sending reopens, and the
   * messages behind it wait for it. Show it as waiting, not as an error with Try again. A blocked person's message is
   * never held.
   */
  heldFor: Open<'app_paused' | 'verification_required'> | null;
  /** True when a closed policy holds it (`heldFor` is set), as `isHeld` on iOS and Android. */
  isHeld: boolean;
}

export interface ConversationState {
  phase: Open<'idle' | 'loading' | 'ready' | 'failed'>;
  /** Messages in sequence order. */
  messages: ConversationMessage[];
  pending: PendingMessage[];
  hasOlder: boolean;
  isLoadingOlder: boolean;
  /** Who is typing right now. */
  typing: { name?: string; isAI: boolean } | null;
  /** The server's reply expectation, already localized. */
  replyExpectation: string | null;
  /**
   * `open`, or why sending is off (`SendPolicy.reason`). A reason a newer server adds keeps its code on Android; the iOS
   * SDK reads it as `unknown`.
   */
  policy: Open<'open' | 'blocked' | 'app_paused' | 'verification_required'>;
  /** The thread's status. A status this SDK doesn't know arrives as `open` on both platforms. */
  status: Open<'open' | 'resolved'>;
  /** The highest sequence number the team has read. */
  teamReadSeq: number;
  /** The chat can't reach the service: no network, or the last request could not get through. */
  isOffline: boolean;
  /**
   * Of `isOffline`: the device has a network, but the last request could not reach the service (its name did not
   * resolve, or the connection was refused). Say the chat can't be reached instead of "offline". Cleared by the next
   * request that gets through.
   */
  isServerUnreachable: boolean;
}

/** A push payload: APNs `userInfo` or FCM `data`. */
export type PushPayload = Record<string, unknown>;
