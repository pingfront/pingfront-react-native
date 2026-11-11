import { useEffect, useRef, useSyncExternalStore } from 'react';
import { getSnapshot, subscribeEvents, subscribeSnapshot } from './store';
import type {
  Person,
  PingfrontLook,
  PingfrontEvent,
  PingfrontEventType,
  PingfrontSnapshot,
} from './types';

/** The whole native state the hooks below read. Re-renders when any field changes. */
export function usePingfrontSnapshot(): PingfrontSnapshot {
  return useSyncExternalStore(subscribeSnapshot, getSnapshot, getSnapshot);
}

function useSelected<T>(select: (snapshot: PingfrontSnapshot) => T): T {
  const read = () => select(getSnapshot());
  return useSyncExternalStore(subscribeSnapshot, read, read);
}

const selectUnread = (s: PingfrontSnapshot) => s.unreadCount;
const selectPerson = (s: PingfrontSnapshot) => s.person;
const selectChatVisible = (s: PingfrontSnapshot) => s.isChatVisible;
const selectLanguage = (s: PingfrontSnapshot) => s.language;
const selectLook = (s: PingfrontSnapshot) => s.look;

/** Unread team messages, for a badge. Updates on push, on foreground and while the chat is open. */
export function usePingfrontUnread(): number {
  return useSelected(selectUnread);
}

/** The person this install belongs to, once a session exists; null before and after logout. */
export function usePingfrontPerson(): Person | null {
  return useSelected(selectPerson);
}

/** True while the native chat is on screen. */
export function usePingfrontChatVisible(): boolean {
  return useSelected(selectChatVisible);
}

/** The language override from `setLanguage` (or `configure`), or null when the chat follows the app and system. */
export function usePingfrontLanguage(): string | null {
  return useSelected(selectLanguage);
}

/**
 * The resolved chat look (dashboard > code > host app > defaults): colors as `#RRGGBB` pairs, shape and the
 * topic ids, so your own screens around the chat can match it. Null before `configure`.
 */
export function usePingfrontLook(): PingfrontLook | null {
  return useSelected(selectLook);
}

/**
 * Calls `listener` for native events while the component is mounted. Pass `types` to filter. The
 * latest `listener` is always used, so it can close over state without re-subscribing.
 */
export function usePingfrontEvents(
  listener: (event: PingfrontEvent) => void,
  types?: readonly PingfrontEventType[]
): void {
  const latest = useRef(listener);
  latest.current = listener;
  const key = types ? [...types].sort().join(',') : '*';
  useEffect(() => {
    const wanted = key === '*' ? null : new Set(key.split(','));
    return subscribeEvents((event) => {
      if (!wanted || wanted.has(event.type)) latest.current(event);
    });
  }, [key]);
}

/** The same as `usePingfrontEvents`, under the name the native SDK docs use for chat events. */
export const useChatEvents = usePingfrontEvents;
