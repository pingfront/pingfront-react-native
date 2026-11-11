import type { EventSubscription } from 'react-native';
import { useSyncExternalStore } from 'react';
import { decodeConversation, emptyConversation } from './decode';
import { requireNative } from './native';
import type { ConversationState } from './types';

/**
 * The thread as state plus the actions a chat UI needs, for apps that build their own chat UI instead of
 * `openChat()` or `<PingfrontChatView />`. It mirrors `PingFront.shared.conversation` (iOS) and
 * `PingFront.conversation` (Android): the native SDK owns the thread, the outbox and the live channel; the bridge
 * sends its state to JavaScript only while something subscribes.
 *
 * Cost: each change crosses the bridge. Messages and pending sends are serialized only when they changed (typing,
 * phase and read updates leave them out), but a changed thread is sent whole (at most the 500 messages the native
 * SDK keeps in memory).
 *
 * Call `reload()` when your screen appears: it creates the session if needed and loads the latest page. Call
 * `markRead()` while your screen shows the thread, so the team sees Read and the unread count drops to 0 (the native
 * chat does both by itself).
 */

type Listener = (state: ConversationState) => void;

let state: ConversationState = emptyConversation;
const listeners = new Set<Listener>();
let subscription: EventSubscription | null = null;

function receive(raw: unknown) {
  // The native side leaves `messages` and `pending` out when they did not change (a typing or phase update).
  state = decodeConversation(raw, state);
  for (const listener of [...listeners]) listener(state);
}

function subscribe(listener: Listener): () => void {
  const native = requireNative();
  if (!native) return () => {};
  listeners.add(listener);
  if (!subscription) {
    // The native side answers with the current state as soon as it observes.
    subscription = native.onConversation(receive);
    native.setConversationObserved(true);
  } else {
    // Already observed: the state is current, so a new subscriber gets it now.
    listener(state);
  }
  return () => {
    if (!listeners.delete(listener) || listeners.size > 0) return;
    subscription?.remove();
    subscription = null;
    native.setConversationObserved(false);
    // Nobody reads it now, and it may be stale (or another person's) by the next subscribe.
    state = emptyConversation;
  };
}

/** Logout and erase: the previous person's thread must never be returned. */
export function forgetConversation(): void {
  state = emptyConversation;
  for (const listener of [...listeners]) listener(state);
}

const getState = (): ConversationState => state;

/** The protocol's `RatingCard.scale` maximum. */
const MAX_RATING = 5;

export const conversation = {
  /** Calls `listener` with the whole state whenever it changes (the current state first). Returns an unsubscribe. */
  subscribe,
  /** The last state the native side sent (empty until something subscribes). */
  getState,
  /**
   * Sends text. Returns at once: the message shows in `pending` and the native outbox delivers it, also after
   * a relaunch. Blank text is ignored.
   */
  send(text: string): void {
    requireNative()?.conversationSend(text);
  },
  /** Sends a failed message again with the same idempotency key (the native chat's Try again). */
  retry(clientId: string): void {
    requireNative()?.conversationRetry(clientId);
  },
  /**
   * Removes a message from the queue unsent: a failed one, one a closed policy holds (`heldFor`), or one queued behind
   * it. Deleting the first held message lets the ones behind it go.
   */
  discard(clientId: string): void {
    requireNative()?.conversationDiscard(clientId);
  },
  /** Loads the previous page (call when the top of your list appears). */
  loadOlder(): void {
    requireNative()?.conversationLoadOlder();
  },
  /**
   * Loads the thread (and starts the session if needed). Call it when your screen appears, or from pull to refresh.
   * Resolves when the reload has finished: the thread is loaded, or the load failed. On failure `phase` is `failed`
   * only when there is nothing to show; a thread already on screen stays. It never rejects.
   */
  async reload(): Promise<void> {
    await requireNative()?.conversationReload();
  },
  /**
   * For a chat UI of your own: marks the messages on screen as read, so the team sees Read and the unread count drops
   * to 0. Call it when your screen shows the thread and when new messages arrive while it does. Nothing is sent when
   * there is nothing to mark, or while the app is paused. The native chat does this by itself.
   */
  markRead(): void {
    requireNative()?.conversationMarkRead();
  },
  /** Tells the team the person is typing (throttled natively). */
  setTyping(typing: boolean): void {
    requireNative()?.conversationSetTyping(typing);
  },
  /** Opens a card's action (offer, review, link, report, store action): what a tap on it does in the native chat. */
  openCard(messageId: string, cardId: string): void {
    requireNative()?.conversationOpenCard(messageId, cardId);
  },
  /** Picks an option on a choices card. */
  choose(messageId: string, cardId: string, optionId: string): void {
    requireNative()?.conversationChoose(messageId, cardId, optionId);
  },
  /** Rates on a rating card: rounded and clamped to 1...5 (the native SDK clamps to the card's scale). */
  rate(messageId: string, cardId: string, rating: number): void {
    if (typeof rating !== 'number' || !Number.isFinite(rating)) return;
    const value = Math.min(MAX_RATING, Math.max(1, Math.round(rating)));
    requireNative()?.conversationRate(messageId, cardId, value);
  },
};

/** The conversation state, re-rendering on every change while the component is mounted. */
export function usePingfrontConversation(): ConversationState {
  return useSyncExternalStore(subscribe, getState, getState);
}

/** Tests only. */
export function resetConversationForTests(): void {
  listeners.clear();
  subscription?.remove();
  subscription = null;
  state = emptyConversation;
}
