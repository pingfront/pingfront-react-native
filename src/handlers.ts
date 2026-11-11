import { describeError } from './errors';
import { type EventSubscription } from 'react-native';
import { decodeOfferRequest } from './decode';
import { requireNative } from './native';
import { LOG_PREFIX } from './constants';
import type { OfferRequest } from './types';

declare const __DEV__: boolean;

/**
 * What happens to the native chat around your handler.
 *
 * - `dismiss` (default): the chat is a native sheet (iOS) or activity (Android) above your React root, so JS UI
 *   opened while it is up shows behind it, or not at all; `dismiss` gets it out of the way. For `onOffer` the chat
 *   closes first and your handler runs once it is off screen (a React Native `<Modal>` paywall is visible). For
 *   `onLink` and `onScreen` your handler runs first and the chat closes only once it answers `true` in time, so a
 *   declined or failed link keeps the person in the chat.
 * - `keep`: the chat stays open. Only for UI that presents itself natively above the top-most screen (RevenueCat's
 *   `presentPaywall`, Superwall), or for work with no UI.
 */
export type ChatBehaviour = 'dismiss' | 'keep';

export interface OfferHandlerOptions {
  chat?: ChatBehaviour;
}

export type OfferHandler = (request: OfferRequest) => void | Promise<void>;

let offer: { handler: OfferHandler; options: OfferHandlerOptions } | null =
  null;
let offerSubscription: EventSubscription | null = null;
const offersInFlight = new Set<string>();

async function runOffer(raw: unknown) {
  const request = decodeOfferRequest(raw);
  const current = offer;
  if (!request || !current) return;
  // A second tap on the same card while the chat is closing is the same request.
  if (offersInFlight.has(request.cardId)) return;
  offersInFlight.add(request.cardId);
  try {
    if ((current.options.chat ?? 'dismiss') === 'dismiss')
      await closeNativeChat();
    await current.handler(request);
  } catch (error) {
    console.error(
      `${LOG_PREFIX} The onOffer handler threw.`,
      describeError(error)
    );
  } finally {
    offersInFlight.delete(request.cardId);
  }
}

async function closeNativeChat() {
  const native = requireNative();
  if (!native) return;
  try {
    await native.closeChat();
  } catch (error) {
    // Closing can only fail when the chat is already gone; the handler still runs.
    if (__DEV__) console.warn(`${LOG_PREFIX} Closing the chat failed.`, error);
  }
}

/**
 * Shows your paywall when the person taps an offer card. One handler at a time: a new call
 * replaces the previous one. While a handler is set it wins over native offer modules (StoreKit,
 * Billing, vendor adapters), exactly like `onOffer` in the native SDKs.
 *
 * By default the chat is dismissed first and your handler runs once it is off screen, so a
 * React Native `<Modal>` paywall is visible. See `ChatBehaviour`.
 *
 * @returns A function that removes the handler (native offer modules handle cards again).
 */
export function onOffer(
  handler: OfferHandler,
  options: OfferHandlerOptions = {}
): () => void {
  const native = requireNative();
  if (!native) return () => {};
  const entry = { handler, options };
  offer = entry;
  if (!offerSubscription) {
    offerSubscription = native.onOfferRequest((raw) => {
      runOffer(raw);
    });
  }
  native.setOfferHandlerEnabled(true);
  return () => {
    if (offer !== entry) return;
    offer = null;
    offerSubscription?.remove();
    offerSubscription = null;
    native.setOfferHandlerEnabled(false);
  };
}

export interface LinkHandlerOptions {
  /**
   * Default `dismiss`: once your handler answers `true`, the chat closes, so the screen you navigated to shows. A
   * declined link (false, a throw, or no answer within 10 seconds) leaves the chat open. `keep` never closes it.
   */
  chat?: ChatBehaviour;
}

/**
 * Handles a link from the chat: return (or resolve) true when your app handled it. False, a throw or a rejection
 * declines it, and the native SDK opens it the way the chat does (web links in the in-app browser, the app's own
 * scheme through the system).
 */
export type LinkHandler = (url: string) => boolean | Promise<boolean>;

let link: { handler: LinkHandler; options: LinkHandlerOptions } | null = null;
let linkSubscription: EventSubscription | null = null;
/** What the native side last got: `closesChat` while its handler is on, null while it is off. */
let linkNative: boolean | null = null;

/**
 * Handles links the person taps in the chat (message text and link cards), with every link the native chat would
 * open. The native SDKs apply the link card URL rule first (https://pingfront.sh/docs/chat-links), so a refused URL never
 * reaches your handler. The tap waits for your answer (a promise is awaited), up to 10 seconds; no answer by then
 * declines it. A declined link opens as usual, natively, so a card's outcome (opened or `cannot_open`) is reported as
 * it really was. One handler at a time: a new call replaces the previous one.
 *
 * ```ts
 * useEffect(() => Pingfront.onLink((url) => {
 *   if (!url.startsWith('myapp://')) return false;
 *   navigation.navigate(routeFor(url));
 *   return true;
 * }), []);
 * ```
 *
 * @returns A function that removes the handler (every link then opens natively again).
 */
export function onLink(
  handler: LinkHandler,
  options: LinkHandlerOptions = {}
): () => void {
  const native = requireNative();
  if (!native) return () => {};
  const entry = { handler, options };
  link = entry;
  if (!linkSubscription) {
    linkSubscription = native.onLinkRequest((raw) => {
      runLink(raw);
    });
  }
  // Only a real change goes native: turning the handler off there declines a tap still waiting for an answer.
  const closesChat = (options.chat ?? 'dismiss') === 'dismiss';
  if (linkNative !== closesChat) {
    linkNative = closesChat;
    native.setLinkHandlerEnabled(true, closesChat);
  }
  return () => {
    if (link !== entry) return;
    link = null;
    // React's effect cleanup runs right before the effect registers again: turn the native handler off only when
    // no handler came back by then, so a tap waiting for an answer survives re-registration.
    Promise.resolve().then(() => {
      if (link !== null || linkNative === null) return;
      linkNative = null;
      linkSubscription?.remove();
      linkSubscription = null;
      native.setLinkHandlerEnabled(false, false);
    });
  };
}

async function runLink(raw: unknown) {
  const native = requireNative();
  const request = isRecord(raw) ? raw : undefined;
  const requestId = request?.requestId;
  const url = request?.url;
  if (!native || typeof requestId !== 'string' || typeof url !== 'string')
    return;
  let handled = false;
  try {
    const current = link;
    // The native side closes the chat once it gets `true` in time; a late answer is ignored there.
    if (current) handled = (await current.handler(url)) === true;
  } catch (error) {
    console.error(
      `${LOG_PREFIX} The onLink handler threw; the link opens as usual.`,
      describeError(error)
    );
  }
  native.answerLink(requestId, handled);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** Tests only. */
export function resetHandlersForTests(): void {
  offer = null;
  link = null;
  linkNative = null;
  offerSubscription?.remove();
  linkSubscription?.remove();
  offerSubscription = null;
  linkSubscription = null;
  offersInFlight.clear();
}
