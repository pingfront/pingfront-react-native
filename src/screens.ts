import type { EventSubscription } from 'react-native';
import { LOG_PREFIX } from './constants';
import { decodeScreenRequest } from './decode';
import { describeError } from './errors';
import { nativeModule, requireNative } from './native';
import type { AppScreen, LinkScreen } from './types';
import type { ChatBehaviour } from './handlers';

declare const __DEV__: boolean;

const SCREEN_ID = /^[A-Za-z0-9][A-Za-z0-9_./:-]{0,99}$/;

/**
 * Registers the screens of your app that the team's saved links can open (https://pingfront.sh/docs/offers#saved-links). Call it at
 * launch, before or after `configure`; a later call replaces the list. Registering sends nothing: the list rides on
 * the session requests the native SDK makes anyway. Ids must match `^[A-Za-z0-9][A-Za-z0-9_./:-]{0,99}$`: in a
 * debug build a bad id throws, in a release build it is dropped. Each id counts once (the first wins), at most 200.
 *
 * ```ts
 * Pingfront.registerScreens([{ id: 'settings.sound', title: 'Sound settings' }, { id: 'plans/yearly' }]);
 * ```
 */
export function registerScreens(screens: AppScreen[]): void {
  const bad = screens.filter((screen) => !SCREEN_ID.test(screen.id));
  if (bad.length > 0 && __DEV__) {
    throw new Error(
      `${LOG_PREFIX} registerScreens: screen ids must match ^[A-Za-z0-9][A-Za-z0-9_./:-]{0,99}$: ${bad
        .map((screen) => JSON.stringify(screen.id))
        .join(', ')}`
    );
  }
  const native = requireNative();
  if (!native) return;
  native.registerScreens(
    screens
      .filter((screen) => SCREEN_ID.test(screen.id))
      .map((screen) =>
        screen.title === undefined
          ? { id: screen.id }
          : { id: screen.id, title: screen.title }
      )
  );
}

/**
 * Opens a screen: return (or resolve) true when your app opened it, false when it can't now. A throw or rejection
 * counts as false.
 */
export type ScreenHandler = (screen: LinkScreen) => boolean | Promise<boolean>;

export interface ScreenHandlerOptions {
  /**
   * Default `dismiss`: once your handler answers `true` (within 10 seconds), the chat closes, so the screen you opened
   * shows. A false answer, a throw or no answer in time leaves the chat open. `keep` never closes it.
   */
  chat?: ChatBehaviour;
}

let handler: { run: ScreenHandler; options: ScreenHandlerOptions } | null =
  null;
let subscription: EventSubscription | null = null;
/** What the native side last got: `closesChat` while its handler is on, null while it is off. */
let enabledNative: boolean | null = null;

async function deliver(raw: unknown) {
  const request = decodeScreenRequest(raw);
  const native = nativeModule();
  if (!request || !native) return;
  let opened = false;
  try {
    const current = handler;
    // The native side closes the chat once it gets `true` in time; a late answer is ignored there.
    if (current) opened = (await current.run(request.screen)) === true;
  } catch (error) {
    console.error(
      `${LOG_PREFIX} The onScreen handler threw.`,
      describeError(error)
    );
  }
  native.answerScreen(request.requestId, opened);
}

/**
 * Handles link cards that open a screen this build registered (`registerScreens`), with the screen's id and params.
 * Navigate there and return true; return false when the app can't, and the team sees the link failed. The tap
 * waits for your answer (a promise is awaited), up to 10 seconds; no answer by then counts as false. By default the chat
 * closes once you answer true (`{ chat: 'keep' }` leaves it). A card for a screen this build didn't register opens its
 * URL instead (through `onLink`, then natively). One
 * handler at a time: a new call replaces the previous one.
 *
 * ```ts
 * useEffect(() => Pingfront.onScreen((screen) => {
 *   navigation.navigate(screen.id, screen.params);
 *   return true;
 * }), []);
 * ```
 *
 * @returns A function that removes the handler (such cards then count as not handled).
 */
export function onScreen(
  next: ScreenHandler,
  options: ScreenHandlerOptions = {}
): () => void {
  const native = requireNative();
  if (!native) return () => {};
  const entry = { run: next, options };
  handler = entry;
  if (!subscription) {
    subscription = native.onScreenRequest((raw) => {
      deliver(raw);
    });
  }
  // Only a real change goes native: turning the handler off there declines a tap still waiting for an answer.
  const closesChat = (options.chat ?? 'dismiss') === 'dismiss';
  if (enabledNative !== closesChat) {
    enabledNative = closesChat;
    native.setScreenHandlerEnabled(true, closesChat);
  }
  return () => {
    if (handler !== entry) return;
    handler = null;
    // React's effect cleanup runs right before the effect registers again: turn the native handler off only when
    // no handler came back by then, so a tap waiting for an answer survives re-registration.
    Promise.resolve().then(() => {
      if (handler !== null || enabledNative === null) return;
      enabledNative = null;
      subscription?.remove();
      subscription = null;
      native.setScreenHandlerEnabled(false, false);
    });
  };
}

/** Tests only. */
export function resetScreensForTests(): void {
  handler = null;
  enabledNative = null;
  subscription?.remove();
  subscription = null;
}
