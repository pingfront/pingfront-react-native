import type { CodegenTypes, TurboModule } from 'react-native';
import { TurboModuleRegistry } from 'react-native';

/**
 * The Codegen spec of the native module: the whole surface between JavaScript and the native SDKs.
 *
 * It is deliberately thin. Every value crosses as plain JSON-shaped objects in the wire format of pingfront's
 * API (https://pingfront.sh/openapi.yaml: camelCase, ISO-8601 dates), and the typed public API in
 * `src/index.ts` maps them. Events arrive through the emitters; `decodeEvent` maps them and turns
 * anything it does not know into `{ type: 'unknown' }`.
 */
export interface Spec extends TurboModule {
  /** Starts the native SDK. `appKey` null reads it from Info.plist / the manifest. Sends nothing. */
  configure(appKey: string | null, options: CodegenTypes.UnsafeObject): void;

  identify(userId: string, name: string | null, email: string | null): void;
  identifyWithToken(token: string): void;
  setTraits(traits: CodegenTypes.UnsafeObject): void;
  /** An `Entitlement` in wire format. */
  setEntitlement(entitlement: CodegenTypes.UnsafeObject): void;
  logout(): void;
  eraseMyData(): Promise<void>;
  /** Everything the server holds about the person (`GET /me/export`), as JSON text. */
  exportMyData(): Promise<string>;
  prepare(): Promise<void>;

  /** `topic` is `{ id }` for a preset or `{ id, label, symbol?, prefill? }` for a custom topic. */
  openChat(topic: CodegenTypes.UnsafeObject | null): void;
  /** Resolves once the SDK-presented chat is off screen, so something else can be presented. */
  closeChat(): Promise<void>;
  openReport(prefill: string | null): void;
  /**
   * A chat link (`pingfront=chat` or `pingfront=report` in the query, https://pingfront.sh/docs/chat-links): resolves true
   * when the native SDK opened the chat or the report, or kept the link for `configure`.
   */
  handleUrl(url: string): Promise<boolean>;
  reportBug(text: string, screenshotBase64: string | null): Promise<void>;

  /** Resolves with `{ type, presented?, error? }`. */
  moment(
    name: string,
    props: CodegenTypes.UnsafeObject
  ): Promise<CodegenTypes.UnsafeObject>;

  /** `OfferSlot`s in wire format. */
  setOffers(offers: Array<CodegenTypes.UnsafeObject>): void;
  /** While enabled, offer card taps go to `onOfferRequest` instead of a native offer module. */
  setOfferHandlerEnabled(enabled: boolean): void;
  /**
   * While enabled, every link the chat would open (after the link card URL rule) arrives on `onLinkRequest`, answered
   * with `answerLink`. The native SDK's async `onLink` waits up to 10 seconds; a declined or late one opens natively.
   * `closesChat`: the presented chat closes after a timely `true`.
   */
  setLinkHandlerEnabled(enabled: boolean, closesChat: boolean): void;
  /** Answers an `onLinkRequest` by its `requestId`: whether the app handled the link. Unknown or late ids do nothing. */
  answerLink(requestId: string, handled: boolean): void;

  /**
   * The app's screens for saved links, `{ id, title? }` each (https://pingfront.sh/docs/offers#saved-links). Checked natively: a bad id
   * throws in a debug build and is dropped in a release build.
   */
  registerScreens(screens: Array<CodegenTypes.UnsafeObject>): void;
  /**
   * While enabled, a link card for a registered screen arrives on `onScreenRequest`, answered with `answerScreen` (the
   * native SDK waits up to 10 seconds). `closesChat`: the presented chat closes after a timely `true`.
   */
  setScreenHandlerEnabled(enabled: boolean, closesChat: boolean): void;
  /** Answers an `onScreenRequest` by its `requestId`: whether the app opened the screen. Unknown or late ids do nothing. */
  answerScreen(requestId: string, opened: boolean): void;

  /** APNs device token as hex (iOS) or the FCM registration token (Android). Null unregisters. */
  setPushToken(token: string | null): void;
  /** `opened` is true for a notification tap. Resolves true for pingfront payloads. */
  handlePush(
    payload: CodegenTypes.UnsafeObject,
    opened: boolean
  ): Promise<boolean>;
  isPingFrontPush(payload: CodegenTypes.UnsafeObject): Promise<boolean>;
  requestPushAuthorization(): Promise<boolean>;

  /** iOS: `handleBackgroundPush(userInfo:)`, resolves `newData`, `noData`, `failed`, or null when not pingfront's. */
  handleBackgroundPush(
    payload: CodegenTypes.UnsafeObject
  ): Promise<string | null>;

  /** The chat's language (a BCP 47 tag), or null to follow the app and the system. Invalid tags are ignored natively. */
  setLanguage(tag: string | null): void;
  /** True when the dashboard turned on the app icon badge (`features.appBadge`). */
  usesAppBadge(): Promise<boolean>;

  /** While enabled, `PingFront.teamActions` is collected and each action arrives on `onTeamAction`. */
  setTeamActionsEnabled(enabled: boolean): void;
  /** Answers a team action delivered on `onTeamAction`, by its `id`. Unknown ids resolve and do nothing. */
  completeTeamAction(actionRunId: string): Promise<void>;
  failTeamAction(actionRunId: string, message: string): Promise<void>;

  /** While enabled, the conversation's state is sent on `onConversation` whenever it changes. */
  setConversationObserved(enabled: boolean): void;
  conversationSend(text: string): void;
  conversationRetry(clientId: string): void;
  conversationDiscard(clientId: string): void;
  conversationLoadOlder(): void;
  /** Resolves when the reload has finished (loaded or failed); never rejects. */
  conversationReload(): Promise<void>;
  conversationMarkRead(): void;
  conversationSetTyping(typing: boolean): void;
  /** Opens a card's action (offer, review, link, report, store action), found by message and card id. */
  conversationOpenCard(messageId: string, cardId: string): void;
  /** Picks an option on a choices card. */
  conversationChoose(messageId: string, cardId: string, optionId: string): void;
  /** Rates on a rating card (clamped natively to the card's scale). */
  conversationRate(messageId: string, cardId: string, rating: number): void;

  /**
   * `{ isConfigured, unreadCount, person, isChatVisible, isTestDevice, configurationProblem, storeAccountToken,
   * language, look }`.
   */
  getSnapshot(): Promise<CodegenTypes.UnsafeObject>;
  /** Runs the self-check and resolves with its one line (`... PASS` or `... FAIL <code>: <advice>`). */
  selfCheck(): Promise<string>;

  /** Every native `PingFrontEvent`, as `{ type, ... }`. */
  readonly onEvent: CodegenTypes.EventEmitter<CodegenTypes.UnsafeObject>;
  /** A changed snapshot field: `{ unreadCount }`, `{ person }`, `{ isChatVisible }`, ... */
  readonly onState: CodegenTypes.EventEmitter<CodegenTypes.UnsafeObject>;
  /** An offer card tap, while the offer handler is enabled: an `OfferRequest`. */
  readonly onOfferRequest: CodegenTypes.EventEmitter<CodegenTypes.UnsafeObject>;
  /** A tapped link, while the link handler is enabled: `{ requestId, url }`. */
  readonly onLinkRequest: CodegenTypes.EventEmitter<CodegenTypes.UnsafeObject>;
  /** A link card for a registered screen, while the screen handler is enabled: `{ requestId, id, params }`. */
  readonly onScreenRequest: CodegenTypes.EventEmitter<CodegenTypes.UnsafeObject>;
  /** A native SDK log line, while `configure` had `logHandler`: `{ level, message, category? }` (already redacted). */
  readonly onLog: CodegenTypes.EventEmitter<CodegenTypes.UnsafeObject>;
  /** A team action ("Fix it for them"), while team actions are enabled. */
  readonly onTeamAction: CodegenTypes.EventEmitter<CodegenTypes.UnsafeObject>;
  /** The conversation's state, while it is observed. */
  readonly onConversation: CodegenTypes.EventEmitter<CodegenTypes.UnsafeObject>;
}

export default TurboModuleRegistry.get<Spec>('Pingfront');
