import type { EventSubscription } from 'react-native';
import { LOG_PREFIX } from './constants';
import { decodeTeamAction } from './decode';
import { describeError } from './errors';
import { nativeModule, requireNative } from './native';
import type { TeamAction } from './types';

/**
 * Team actions ("Fix it for them"): a teammate ran an action from the inbox that the app has to do, such as
 * extending a trial or repairing a sync. The native SDK replays actions not answered yet to each new stream, so
 * one sent while the app was closed still arrives. The bridge collects the stream only while a handler is set.
 */

/** May be async: a rejection fails the action (with a generic reason) unless it was already answered. */
export type TeamActionHandler = (action: TeamAction) => void | Promise<void>;

/** What the team sees when a handler throws or rejects. Never the error itself, which may carry personal data. */
const HANDLER_FAILED = "The app's team action handler failed.";

const handlers = new Set<TeamActionHandler>();
let subscription: EventSubscription | null = null;

function deliver(raw: unknown) {
  const fields = decodeTeamAction(raw);
  const native = nativeModule();
  if (!fields || !native) return;
  // One answer per delivery: with several handlers (or a handler that answers twice) the first answer wins.
  let answered = false;
  const answer = (run: () => Promise<void>): Promise<void> => {
    if (answered) return Promise.resolve();
    answered = true;
    return run().catch((error: unknown) => {
      // Answers are stored and retried natively; a rejection here means the bridge itself failed.
      console.warn(`${LOG_PREFIX} Could not answer a team action.`, error);
    });
  };
  const action: TeamAction = {
    ...fields,
    complete: () => answer(() => native.completeTeamAction(fields.id)),
    fail: (message: string) =>
      answer(() => native.failTeamAction(fields.id, message)),
  };
  const failed = (error: unknown) => {
    console.error(
      `${LOG_PREFIX} A team action handler failed.`,
      describeError(error)
    );
    action.fail(HANDLER_FAILED);
  };
  for (const handler of [...handlers]) {
    try {
      Promise.resolve(handler(action)).catch(failed);
    } catch (error) {
      failed(error);
    }
  }
}

/**
 * Handles team actions. Do the work once per `action.id`, then call `action.complete()` or `action.fail(message)`.
 * The handler may be async: if it throws or rejects before answering, the action fails with a generic reason
 * (never the error, which could carry personal data). With several handlers, each gets every action and the first
 * answer wins; later answers are ignored. Returns a remover; with no handler left, the bridge stops collecting
 * (unanswered actions are replayed to the next handler).
 *
 * ```ts
 * useEffect(() => Pingfront.onTeamAction(async (action) => {
 *   if (action.actionId === 'repair_sync') { await sync.repair(); await action.complete(); }
 *   else await action.fail(`This version of the app can't do ${action.name}.`);
 * }), []);
 * ```
 */
export function onTeamAction(handler: TeamActionHandler): () => void {
  const native = requireNative();
  if (!native) return () => {};
  handlers.add(handler);
  if (!subscription) {
    subscription = native.onTeamAction(deliver);
    native.setTeamActionsEnabled(true);
  }
  return () => {
    if (!handlers.delete(handler) || handlers.size > 0) return;
    subscription?.remove();
    subscription = null;
    native.setTeamActionsEnabled(false);
  };
}

/** Tests only. */
export function resetTeamActionsForTests(): void {
  handlers.clear();
  subscription?.remove();
  subscription = null;
}
