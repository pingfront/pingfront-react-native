import NativePingfront from '../specs/NativePingfront';
import { resetHandlersForTests } from '../handlers';
import { resetStoreForTests } from '../store';
import { resetTeamActionsForTests } from '../teamActions';
import { resetConversationForTests } from '../conversation';
import { resetChatViewForTests } from '../PingfrontChatView';
import { resetScreensForTests } from '../screens';
import type { MockNative } from './mockNative';

/** The mocked native module installed by jest.setup.ts. */
export const native = NativePingfront as unknown as MockNative;

export function resetAll(): void {
  resetHandlersForTests();
  resetStoreForTests();
  resetTeamActionsForTests();
  resetConversationForTests();
  resetChatViewForTests();
  resetScreensForTests();
  native.reset();
}

/** Lets pending promise callbacks run. */
export async function flush(): Promise<void> {
  for (let i = 0; i < 5; i++) await Promise.resolve();
}
