import type { EventSubscription } from 'react-native';
import type { Spec } from '../specs/NativePingfront';

type Emitter =
  | 'onEvent'
  | 'onState'
  | 'onOfferRequest'
  | 'onLinkRequest'
  | 'onScreenRequest'
  | 'onLog'
  | 'onTeamAction'
  | 'onConversation';
type Listener = (value: object) => void;

/**
 * A mock of the native module, typed against the Codegen spec: every method of `Spec` must be here
 * with the spec's signature (tsc fails otherwise), so the tests always exercise the real contract.
 */
export type MockNative = { [K in keyof Spec]: Spec[K] } & {
  [K in Exclude<keyof Spec, Emitter>]: jest.Mock;
} & {
  emit(emitter: Emitter, value: object): void;
  listenerCount(emitter: Emitter): number;
  reset(): void;
};

export function createMockNative(): MockNative {
  const listeners: Record<Emitter, Set<Listener>> = {
    onEvent: new Set(),
    onState: new Set(),
    onOfferRequest: new Set(),
    onLinkRequest: new Set(),
    onScreenRequest: new Set(),
    onLog: new Set(),
    onTeamAction: new Set(),
    onConversation: new Set(),
  };
  const emitter =
    (name: Emitter) =>
    (listener: Listener): EventSubscription => {
      listeners[name].add(listener);
      return { remove: () => listeners[name].delete(listener) };
    };

  // Typed as the spec's methods: a missing method or a wrong signature fails tsc.
  const methods = (): Omit<Spec, Emitter | 'getConstants'> => ({
    configure: jest.fn(),
    identify: jest.fn(),
    identifyWithToken: jest.fn(),
    setTraits: jest.fn(),
    setEntitlement: jest.fn(),
    logout: jest.fn(),
    eraseMyData: jest.fn(async () => {}),
    exportMyData: jest.fn(async () => '{"person":{"id":"per_1"}}'),
    prepare: jest.fn(async () => {}),
    openChat: jest.fn(),
    closeChat: jest.fn(async () => {}),
    openReport: jest.fn(),
    handleUrl: jest.fn(async () => true),
    reportBug: jest.fn(async () => {}),
    moment: jest.fn(async () => ({ type: 'notListened' })),
    setOffers: jest.fn(),
    setOfferHandlerEnabled: jest.fn(),
    setLinkHandlerEnabled: jest.fn(),
    answerLink: jest.fn(),
    registerScreens: jest.fn(),
    setScreenHandlerEnabled: jest.fn(),
    answerScreen: jest.fn(),
    setPushToken: jest.fn(),
    handlePush: jest.fn(async () => true),
    isPingFrontPush: jest.fn(async () => true),
    requestPushAuthorization: jest.fn(async () => true),
    handleBackgroundPush: jest.fn(async () => 'newData'),
    setLanguage: jest.fn(),
    usesAppBadge: jest.fn(async () => true),
    setTeamActionsEnabled: jest.fn(),
    completeTeamAction: jest.fn(async () => {}),
    failTeamAction: jest.fn(async () => {}),
    setConversationObserved: jest.fn(),
    conversationSend: jest.fn(),
    conversationRetry: jest.fn(),
    conversationDiscard: jest.fn(),
    conversationLoadOlder: jest.fn(),
    conversationReload: jest.fn(async () => {}),
    conversationMarkRead: jest.fn(),
    conversationSetTyping: jest.fn(),
    conversationOpenCard: jest.fn(),
    conversationChoose: jest.fn(),
    conversationRate: jest.fn(),
    getSnapshot: jest.fn(async () => ({
      isConfigured: true,
      unreadCount: 0,
      person: null,
      isChatVisible: false,
      isTestDevice: false,
      configurationProblem: null,
      storeAccountToken: null,
      language: null,
      look: null,
    })),
    selfCheck: jest.fn(async () => 'PingFront self-check: PASS'),
  });

  const spec: Spec = {
    ...methods(),
    onEvent: emitter('onEvent'),
    onState: emitter('onState'),
    onOfferRequest: emitter('onOfferRequest'),
    onLinkRequest: emitter('onLinkRequest'),
    onScreenRequest: emitter('onScreenRequest'),
    onLog: emitter('onLog'),
    onTeamAction: emitter('onTeamAction'),
    onConversation: emitter('onConversation'),
  };
  const mock = Object.assign(spec, {
    emit(name: Emitter, value: object) {
      for (const listener of [...listeners[name]]) listener(value);
    },
    listenerCount(name: Emitter) {
      return listeners[name].size;
    },
    reset() {
      Object.assign(mock, methods());
      for (const set of Object.values(listeners)) set.clear();
    },
  });
  return mock as unknown as MockNative;
}
