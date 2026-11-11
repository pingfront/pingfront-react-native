import type { EventSubscription } from 'react-native';
import {
  decodeEvent,
  decodeLogEntry,
  emptySnapshot,
  mergeSnapshot,
} from './decode';
import { nativeModule } from './native';
import type { LogEntry, PingfrontEvent, PingfrontSnapshot } from './types';
import { LOG_PREFIX } from './constants';
import { describeError } from './errors';

/**
 * One JavaScript-side owner of the native state the hooks read (unread count, person, chat
 * visibility, ...) and of the event fan-out. It attaches to the native emitters once, on first use,
 * so importing the package costs nothing and sends nothing.
 */

type SnapshotListener = (snapshot: PingfrontSnapshot) => void;
type EventListener = (event: PingfrontEvent) => void;

let snapshot: PingfrontSnapshot = emptySnapshot;
const snapshotListeners = new Set<SnapshotListener>();
const eventListeners = new Set<EventListener>();
let subscriptions: EventSubscription[] = [];
let attached = false;
let refreshing: Promise<void> | null = null;
let logHandler: ((entry: LogEntry) => void) | null = null;

/** The `logHandler` from `configure`; native lines arrive on `onLog` only while one is set there. */
export function setLogHandler(handler: ((entry: LogEntry) => void) | null) {
  logHandler = handler;
}

let reportedThrow = false;

function log(raw: unknown) {
  const entry = decodeLogEntry(raw);
  if (!entry || !logHandler) return;
  try {
    logHandler(entry);
  } catch (error) {
    // Reported once: a handler that throws on every line must not turn each line into a console warning (which a
    // console-forwarding logger could feed back).
    if (!reportedThrow) {
      reportedThrow = true;
      console.warn(
        `${LOG_PREFIX} The log handler threw; later failures are not reported.`,
        describeError(error)
      );
    }
  }
}

function setSnapshot(next: PingfrontSnapshot) {
  if (next === snapshot) return;
  snapshot = next;
  for (const listener of [...snapshotListeners]) listener(snapshot);
}

function dispatch(event: PingfrontEvent) {
  // State that events carry is applied first, so a listener reading the snapshot sees it.
  if (event.type === 'unreadChanged') {
    setSnapshot(mergeSnapshot(snapshot, { unreadCount: event.count }));
  } else if (event.type === 'chatOpened' || event.type === 'chatClosed') {
    setSnapshot(
      mergeSnapshot(snapshot, { isChatVisible: event.type === 'chatOpened' })
    );
  } else if (event.type === 'sessionStarted') {
    setSnapshot(mergeSnapshot(snapshot, { person: event.person }));
  }
  for (const listener of [...eventListeners]) {
    try {
      listener(event);
    } catch (error) {
      console.error(`${LOG_PREFIX} An event listener threw.`, error);
    }
  }
}

/** Attaches to the native emitters (once) and loads the current snapshot. */
export function attach(): void {
  if (attached) return;
  const native = nativeModule();
  if (!native) return;
  attached = true;
  subscriptions = [
    native.onEvent((raw) => dispatch(decodeEvent(raw))),
    native.onState((raw) => setSnapshot(mergeSnapshot(snapshot, raw))),
    native.onLog(log),
  ];
  refresh();
}

/** Reloads the whole snapshot from native (after configure, logout and erase). */
export function refresh(): Promise<void> {
  const native = nativeModule();
  if (!native) return Promise.resolve();
  if (refreshing) return refreshing;
  refreshing = native
    .getSnapshot()
    .then((raw) => setSnapshot(mergeSnapshot(snapshot, raw)))
    .catch((error: unknown) => {
      console.warn(`${LOG_PREFIX} Could not read the native state.`, error);
    })
    .finally(() => {
      refreshing = null;
    });
  return refreshing;
}

/** A new snapshot request that starts after the one in flight (if any), so it reflects calls made since. */
export function refreshAfterInFlight(): Promise<void> {
  const pending = refreshing;
  if (!pending) return refresh();
  return pending.then(() => refresh());
}

export function getSnapshot(): PingfrontSnapshot {
  return snapshot;
}

export function subscribeSnapshot(listener: SnapshotListener): () => void {
  attach();
  snapshotListeners.add(listener);
  return () => {
    snapshotListeners.delete(listener);
  };
}

export function subscribeEvents(listener: EventListener): () => void {
  attach();
  eventListeners.add(listener);
  return () => {
    eventListeners.delete(listener);
  };
}

/** Tests only: forgets every listener and the native subscriptions. */
export function resetStoreForTests(): void {
  for (const subscription of subscriptions) subscription.remove();
  subscriptions = [];
  attached = false;
  refreshing = null;
  snapshot = emptySnapshot;
  logHandler = null;
  reportedThrow = false;
  snapshotListeners.clear();
  eventListeners.clear();
}
