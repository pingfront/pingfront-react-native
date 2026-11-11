import { PermissionsAndroid, Platform } from 'react-native';
import {
  APNS_PAYLOAD_KEY,
  FCM_VERSION_KEY,
  LOG_PREFIX,
  SDK_VERSION,
} from './constants';
import { forgetConversation } from './conversation';
import { decodeError, decodeMomentResult } from './decode';
import { requireNative } from './native';
import {
  attach,
  getSnapshot,
  refresh,
  refreshAfterInFlight,
  setLogHandler,
  subscribeEvents,
  subscribeSnapshot,
} from './store';
import type {
  BackgroundPushResult,
  ChatLook,
  ChatTopic,
  Color,
  ConfigureOptions,
  Entitlement,
  MomentProps,
  MomentResult,
  OfferSlot,
  PingfrontErrorInfo,
  PingfrontEvent,
  PingfrontEventType,
  PushPayload,
} from './types';

/** An error from the native SDK. `code` is stable; `message` is for developers, not people. */
export class PingfrontError extends Error implements PingfrontErrorInfo {
  readonly code: string;
  readonly serverCode?: string;

  constructor(info: PingfrontErrorInfo) {
    super(info.message || info.code);
    this.name = 'PingfrontError';
    this.code = info.code;
    if (info.serverCode) this.serverCode = info.serverCode;
  }
}

/** Native promise rejections carry `code` and `userInfo`; map them to `PingfrontError`. */
function wrap(error: unknown): PingfrontError {
  if (error instanceof PingfrontError) return error;
  const e = (error ?? {}) as {
    code?: unknown;
    message?: unknown;
    userInfo?: unknown;
  };
  const user = (e.userInfo ?? {}) as { serverCode?: unknown };
  return new PingfrontError(
    decodeError({
      code: typeof e.code === 'string' ? e.code : 'unexpected',
      message: typeof e.message === 'string' ? e.message : String(error),
      serverCode: user.serverCode,
    })
  );
}

async function call<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    throw wrap(error);
  }
}

function notConfiguredNative(): never {
  throw new PingfrontError({
    code: 'not_linked',
    message: `${LOG_PREFIX} The native module is missing from this build.`,
  });
}

// Configuration

function color(
  value: Color | undefined
): { light: string; dark: string } | undefined {
  if (value === undefined) return undefined;
  return typeof value === 'string' ? { light: value, dark: value } : value;
}

function text(value: string | Record<string, string> | undefined) {
  if (value === undefined) return undefined;
  return typeof value === 'string' ? { default: value } : value;
}

/** The topic in the shape the native side reads: `{ id }` or `{ id, label, symbol, prefill }`. */
export function nativeTopic(topic: ChatTopic): Record<string, unknown> {
  if (typeof topic === 'string') return { id: topic };
  return {
    id: topic.id,
    label: text(topic.label),
    symbol: topic.symbol ?? 'other',
    prefill: text(topic.prefill),
  };
}

function nativeLook(
  look: ChatLook | undefined
): Record<string, unknown> | undefined {
  if (!look) return undefined;
  return {
    ...look,
    accent: color(look.accent),
    background: color(look.background),
    teamBubble: color(look.teamBubble),
  };
}

function nativeModules(
  options: ConfigureOptions['modules']
): Record<string, unknown> {
  const modules = options ?? {};
  const products = (value: boolean | { products: string[] } | undefined) =>
    value === undefined || value === false
      ? undefined
      : { products: value === true ? [] : value.products };
  const reports =
    modules.reports === undefined || modules.reports === false
      ? undefined
      : modules.reports === true
        ? { shakeToReport: true, logTail: true }
        : {
            shakeToReport: modules.reports.shakeToReport ?? true,
            logTail: modules.reports.logTail ?? true,
          };
  return {
    push: modules.push === true,
    storeKit: products(modules.storeKit),
    billing: products(modules.billing),
    reports,
    vendors: modules.vendors ?? [],
  };
}

/** The options object the native `configure` reads. Exported for tests. */
export function nativeOptions(
  options: ConfigureOptions
): Record<string, unknown> {
  return {
    baseUrl: options.baseUrl,
    logLevel: options.logLevel,
    logHandler: typeof options.logHandler === 'function',
    language: options.language,
    presentsChatForMoments: options.presentsChatForMoments,
    pushEnvironment: options.pushEnvironment,
    topics: options.topics?.map(nativeTopic),
    look: nativeLook(options.look),
    modules: nativeModules(options.modules),
    wrapper: { name: 'react-native', version: SDK_VERSION },
  };
}

/**
 * Starts the SDK. Call it once, early (for example in `index.js` or your root component's module
 * scope). It checks the key offline and sends nothing: a session starts lazily on the first chat
 * open, listened moment, push open, bug report or `prepare()`.
 *
 * @param appKey The public key (`pk_live_…` or `pk_test_…`). Pass `null` to read it from
 *   `PingFrontAppKey` in Info.plist (iOS) or `pingfront.app_key` in the manifest (Android).
 */
export function configure(
  appKey: string | null,
  options: ConfigureOptions = {}
): void {
  const native = requireNative();
  if (!native) return;
  // Set before configure, so the lines configure itself logs reach the handler.
  setLogHandler(
    typeof options.logHandler === 'function' ? options.logHandler : null
  );
  attach();
  native.configure(appKey, nativeOptions(options));
  // A snapshot requested before configure (by attach) predates it: ask again once that one is done.
  refreshAfterInFlight();
}

// Language

/**
 * Sets the chat's language, for apps with their own language picker: a BCP 47 tag such as `de` or `pt-BR`,
 * or null to follow the app's and the system's language again. The chat UI, the SDK's strings, the team's
 * localized texts and the language the server writes in all follow it. Call it again whenever the person
 * picks a language. An invalid tag is ignored and logged natively, and `getLanguage()` keeps the old value.
 */
export function setLanguage(tag: string | null): void {
  requireNative()?.setLanguage(tag);
}

/** The language override, or null when the chat follows the app and the system (`usePingfrontLanguage`). */
export function getLanguage(): string | null {
  return getSnapshot().language;
}

// Identity

export interface NamedPerson {
  userId: string;
  name?: string;
  email?: string;
}

/**
 * Identifies the person.
 *
 * - `identify(token)`: verified, with an HS256 token your backend signs with the app's identity
 *   secret. Verified people get one thread across devices and reinstalls.
 * - `identify({ userId, name, email })`: named (unverified); one thread per install until verified.
 *
 * Returns immediately; changes are coalesced and sent once a session exists.
 */
export function identify(person: string | NamedPerson): void {
  const native = requireNative();
  if (!native) return;
  if (typeof person === 'string') native.identifyWithToken(person);
  else
    native.identify(person.userId, person.name ?? null, person.email ?? null);
}

/** Adds or updates traits (merged; at most 30, keys up to 64 and values up to 512 characters). */
export function setTraits(traits: Record<string, string>): void {
  requireNative()?.setTraits(traits);
}

/** Reports the subscription state (automatic with the StoreKit or Billing module). */
export function setEntitlement(entitlement: Entitlement): void {
  requireNative()?.setEntitlement(entitlement);
}

/**
 * Logs the person out: forgets identity, traits, the thread and the unread count on this device and
 * tells the server (retried until it succeeds). The next session is a new guest.
 */
export function logout(): void {
  requireNative()?.logout();
  forgetConversation();
  refresh();
}

/** Erases every server-side record of the person (`DELETE /me`), then wipes this device. Safe to retry. */
export async function eraseMyData(): Promise<void> {
  const native = requireNative() ?? notConfiguredNative();
  await call(() => native.eraseMyData());
  forgetConversation();
  await refresh();
}

/**
 * Everything the server holds about the person (`GET /me/export`): a JSON document, returned as the
 * string the server sent, so the app can save or share it as is. Rejects with a `PingfrontError`.
 */
export async function exportMyData(): Promise<string> {
  const native = requireNative() ?? notConfiguredNative();
  return call(() => native.exportMyData());
}

/** Creates the session now instead of lazily, for example right after sign-in. */
export async function prepare(): Promise<void> {
  const native = requireNative() ?? notConfiguredNative();
  await call(() => native.prepare());
  await refresh();
}

// Chat

export interface OpenChatOptions {
  /** With a topic, its prefill goes into the composer (or it starts the thread on that topic). */
  topic?: ChatTopic;
}

/** Presents the native chat: a sheet on iOS (iMessage-style), a bottom sheet on Android (Google Messages-style). */
export function openChat(options: OpenChatOptions = {}): void {
  requireNative()?.openChat(options.topic ? nativeTopic(options.topic) : null);
}

/** Closes the SDK-presented chat. Resolves once it is off screen. */
export async function closeChat(): Promise<void> {
  const native = requireNative();
  if (!native) return;
  await call(() => native.closeChat());
}

/** Opens the bug report flow (screenshot and markup with the reports module, a text form otherwise). */
export function openReport(prefill?: string): void {
  requireNative()?.openReport(prefill ?? null);
}

/**
 * Opens the chat, or the bug report, from a chat link your app received: a URL whose query has
 * `pingfront=chat` or `pingfront=report`, on your own universal link or App Link domain or custom scheme
 * (`myapp://support?pingfront=chat&topic=billing`). The SDK claims no domain or scheme of its own.
 *
 * Resolves true only when it was a chat link (the native SDK opened the chat or the report); false for any
 * other URL, so route those yourself. `topic` applies only when it is one of the chat's topics; other
 * parameters are ignored and a link never puts text in the composer. It sends nothing itself: the chat
 * starts the session as `openChat()` does. Before `configure`, the native SDK keeps the link and opens it
 * right after.
 *
 * ```ts
 * const initialUrl = await Linking.getInitialURL();
 * if (initialUrl) await Pingfront.handleUrl(initialUrl);
 * Linking.addEventListener('url', ({ url }) => void Pingfront.handleUrl(url));
 * ```
 */
export async function handleUrl(url: string): Promise<boolean> {
  if (
    typeof url !== 'string' ||
    url.length === 0 ||
    url.length > MAX_LINK_LENGTH
  )
    return false;
  const native = requireNative();
  if (!native) return false;
  return call(() => native.handleUrl(url));
}

/** The longest URL a chat link can be (https://pingfront.sh/docs/chat-links); longer ones never reach the bridge. */
const MAX_LINK_LENGTH = 2048;

/** Sends a bug report. `screenshotBase64` is PNG or JPEG data, base64-encoded. */
export async function reportBug(
  textValue: string,
  options: { screenshotBase64?: string } = {}
): Promise<void> {
  const native = requireNative() ?? notConfiguredNative();
  await call(() =>
    native.reportBug(textValue, options.screenshotBase64 ?? null)
  );
}

// Moments and offers

/**
 * Reports an app moment (`paywall_closed`, `trial_cancelled`, ...). Only moments a play listens to
 * are sent; the list is cached for five minutes. Never throws: failures come back as `failed`.
 */
export async function moment(
  name: string,
  props: MomentProps = {}
): Promise<MomentResult> {
  const native = requireNative();
  if (!native)
    return { type: 'failed', error: { code: 'not_linked', message: '' } };
  try {
    return decodeMomentResult(await native.moment(name, props));
  } catch (error) {
    const wrapped = wrap(error);
    return {
      type: 'failed',
      error: { code: wrapped.code, message: wrapped.message },
    };
  }
}

/**
 * Reports the offers your app can show, so the team can send offer cards for them. Replaces the
 * app's earlier slots; slots reported by native modules (StoreKit, Billing, adapters) stay.
 */
export function setOffers(offers: OfferSlot[]): void {
  requireNative()?.setOffers(
    offers.map((slot) => ({
      ...slot,
      kind: slot.kind ?? 'standard',
      available: slot.available ?? true,
      products: slot.products ?? [],
    }))
  );
}

// Push

/**
 * Forwards the device push token: the APNs token as hex on iOS (for example from
 * `getDevicePushTokenAsync()` in expo-notifications or `getAPNSToken()` in React Native Firebase),
 * the FCM registration token on Android. Pass `null` to unregister.
 */
export function setPushToken(token: string | null): void {
  requireNative()?.setPushToken(token);
}

/**
 * Hands a notification to the SDK. With `opened: true` (the person tapped it) a pingfront
 * notification opens the chat; otherwise it only updates the unread count.
 *
 * @returns true when it was a pingfront notification.
 */
export async function handlePush(
  payload: PushPayload,
  options: { opened?: boolean } = {}
): Promise<boolean> {
  const native = requireNative();
  if (!native) return false;
  return call(() => native.handlePush(payload, options.opened === true));
}

/** True when the payload looks like a pingfront notification (a quick check, no native call). */
export function isPingFrontPush(
  payload: PushPayload | null | undefined
): boolean {
  if (!payload) return false;
  return APNS_PAYLOAD_KEY in payload || FCM_VERSION_KEY in payload;
}

/**
 * iOS: hands a silent pingfront push (`content-available: 1`, no alert, for example a new chat look) to the
 * SDK from your background notification handler, and resolves what it did for the system's fetch result.
 * It shows nothing and never starts a session. Resolves null for payloads that aren't pingfront's.
 *
 * Android has no separate background path: FCM data messages go to `handlePush` (or the
 * `pingfront-push` module), so this resolves `noData` for a pingfront payload after handling it the same way,
 * and null otherwise.
 */
export async function handleBackgroundPush(
  payload: PushPayload
): Promise<BackgroundPushResult | null> {
  const native = requireNative();
  if (!native) return null;
  const result = await call(() => native.handleBackgroundPush(payload));
  return result === 'newData' || result === 'noData' || result === 'failed'
    ? result
    : null;
}

/**
 * True when the dashboard turned on the app icon badge (`features.appBadge`). Off by default: the badge
 * belongs to your app, so set it to the unread count only when this is true.
 */
export async function usesAppBadge(): Promise<boolean> {
  const native = requireNative();
  if (!native) return false;
  return call(() => native.usesAppBadge());
}

/**
 * Asks for notification permission. iOS: alert, badge and sound, then registers for remote
 * notifications (needs `modules.push`). Android 13+: `POST_NOTIFICATIONS`; earlier: true.
 */
export async function requestPushAuthorization(): Promise<boolean> {
  if (Platform.OS === 'android') {
    if (typeof Platform.Version === 'number' && Platform.Version < 33)
      return true;
    const result = await PermissionsAndroid.request(
      PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS
    );
    return result === PermissionsAndroid.RESULTS.GRANTED;
  }
  const native = requireNative();
  if (!native) return false;
  return call(() => native.requestPushAuthorization());
}

// State and events

/** The current unread count (team messages the person has not seen). */
export function getUnreadCount(): number {
  return getSnapshot().unreadCount;
}

/** Calls `listener` with the unread count whenever it changes. Returns an unsubscribe function. */
export function subscribeUnreadCount(
  listener: (count: number) => void
): () => void {
  let last = getSnapshot().unreadCount;
  return subscribeSnapshot((next) => {
    if (next.unreadCount === last) return;
    last = next.unreadCount;
    listener(last);
  });
}

export interface Subscription {
  remove(): void;
}

/**
 * Listens to native events. Pass a type to get only those, or `'*'` for all of them. Event types
 * this version does not know arrive as `{ type: 'unknown', name }`.
 */
export function addListener<T extends PingfrontEventType>(
  type: T | '*',
  listener: (event: Extract<PingfrontEvent, { type: T }>) => void
): Subscription {
  const remove = subscribeEvents((event) => {
    if (type === '*' || event.type === type) {
      listener(event as Extract<PingfrontEvent, { type: T }>);
    }
  });
  return { remove };
}

// Self-check

export interface SelfCheckResult {
  passed: boolean;
  /** `key_invalid`, `key_unknown`, `network`, `app_paused`, `timeout`, ... when it failed. */
  code?: string;
  /** The one line, as the native self-check prints it. */
  line: string;
}

/**
 * The native SDK's setup check: the key, the network, the server, the Keychain/Keystore and the
 * identity the app set. It creates a session if needed and sends "Setup check from <app>" to your
 * inbox, so use it in development.
 */
export async function selfCheck(): Promise<SelfCheckResult> {
  const native = requireNative() ?? notConfiguredNative();
  const line = await call(() => native.selfCheck());
  return parseSelfCheck(line);
}

export function parseSelfCheck(line: string): SelfCheckResult {
  if (/self-check: PASS\b/.test(line)) return { passed: true, line };
  const match = /self-check: FAIL ([a-z0-9_]+)/.exec(line);
  return { passed: false, code: match?.[1] ?? 'unexpected', line };
}

/** The version of this package. */
export const version = SDK_VERSION;
