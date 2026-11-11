# pingfront for React Native

In-app support chat and proactive messages ("pings") for React Native and Expo apps on iOS and Android.

This package is a thin, typed bridge over the native SDKs ([pingfront for iOS](https://github.com/pingfront/pingfront-ios#readme) and
[pingfront for Android](https://github.com/pingfront/pingfront-android#readme)). Networking, sessions, the Keychain and Keystore, the offline outbox and
the chat itself are the native SDKs' own, so behaviour and security match the native apps exactly, and the chat
is native: iMessage-style on iOS, Google Messages-style on Android. Nothing here re-implements them in JavaScript.

- [Quickstart](#quickstart)
- [Install](#install)
- [Expo](#expo)
- [Configure](#configure)
- [API](#api)
- [The chat in a screen](#the-chat-in-a-screen)
- [Build your own UI](#build-your-own-ui)
- [Team actions](#team-actions)
- [Offers and the modal paywall](#offers-and-the-modal-paywall)
- [Push](#push)
- [Hooks and events](#hooks-and-events)
- [Parity with the native SDKs](#parity-with-the-native-sdks)
- [Architecture](#architecture)
- [Development](#development)

## Quickstart

```tsx
import Pingfront, { usePingfrontUnread } from '@pingfront/react-native';

Pingfront.configure('pk_live_…');                     // once, at startup; sends nothing
const unread = usePingfrontUnread();                 // in a component: the badge count
<Button title={`Help (${unread})`} onPress={() => Pingfront.openChat()} />
```

## Install

Requirements: React Native 0.80 or later with the New Architecture (the default), and:

| | Minimum | Notes |
| --- | --- | --- |
| iOS | 17 | Set the Podfile platform to `'17.0'`. |
| Android `minSdk` | 26 (Android 8.0) | The React Native and Expo templates start at 24: raise it (the Expo config plugin does). |
| Android `compileSdk` | 36 | React Native 0.88 and Expo 58 templates already use 37. |
| Kotlin (your app's compiler) | 2.2.0 | The Android SDK is compiled for Kotlin 2.2, the version React Native 0.88 and Expo 58 apps ship with: nothing to change. |
| Android Gradle Plugin | 9.1 | React Native 0.88 and Expo 58 use 9.2.1. |

Checked on 6 Nov 2026 by building debug APKs of a fresh React Native 0.88.1 app (only `minSdkVersion = 26` changed)
and a fresh Expo SDK 58 app after `expo prebuild` (only this package's config plugin added), both with this package
and no Kotlin setting; the Android SDK's own [requirements](https://github.com/pingfront/pingfront-android#requirements) list the same.

```sh
npm install @pingfront/react-native
cd ios && pod install
```

- **iOS:** the pod depends on the pingfront Swift package through React Native's `spm_dependency`. Add
  `pingfront_post_install(installer)` after `react_native_post_install` in your Podfile to keep the link clean
  (it removes two library search paths that do not exist; see [scripts/cocoapods.rb](scripts/cocoapods.rb)). Set the Podfile platform
  to `'17.0'`.
- **Android:** set `minSdkVersion = 26`. There is no Kotlin setting to change: the SDK targets the Kotlin version
  React Native 0.88 and Expo SDK 58 apps already use, so keep your template's Kotlin Gradle plugin. The SDK artifacts
  come from Maven Central (`sh.pingfront:pingfront`). `<PingfrontChatView />` is the SDK's own `PingFrontChatView`,
  an Android View that owns its Compose composition, so the bridge needs no Compose compiler plugin and no Compose
  setting in your app.

## Expo

Use a development build (`npx expo prebuild` or EAS Build). Expo Go has no native module, and every call throws
in debug builds with what to do.

```json
{
  "expo": {
    "plugins": [
      ["@pingfront/react-native", {
        "appKey": "pk_live_…",
        "push": { "iosEnvironment": "production" },
        "billing": true,
        "storeKitConfigFile": "./Products.storekit"
      }],
      ["expo-build-properties", {
        "ios": { "deploymentTarget": "17.0" }
      }]
    ]
  }
}
```

Expo has no top-level `ios.deploymentTarget`; the iOS version goes through `expo-build-properties`
(`npx expo install expo-build-properties`). On Android the config plugin raises `android.minSdkVersion` to 26 itself
(the property `expo-build-properties` writes; a higher value stays). Leave `android.kotlinVersion` unset: Expo's own
modules are built for the Kotlin version Expo ships, and the pingfront SDK reads it.

| Option | What the plugin does |
| --- | --- |
| `appKey` | Writes `PingFrontAppKey` (Info.plist) and `pingfront.app_key` (manifest), so `configure(null)` reads it. Rejects anything that is not a public key at prebuild time. |
| `push` | iOS: the `aps-environment` entitlement (`development` unless you say `production`) and the `remote-notification` background mode. Android: `POST_NOTIFICATIONS` and the `pingfront-push` FCM module. With `{ "androidModule": false }` it leaves FCM to expo-notifications or React Native Firebase; forward tokens and payloads from JavaScript then. |
| `billing` | Android: adds `pingfront-billing` (Google Play Billing, In-App Review). |
| (always) | Android: raises `android.minSdkVersion` to 26 in `gradle.properties`, which the Expo template reads; a higher value stays. |
| `storeKitConfigFile` | iOS: copies a `.storekit` file into the project and selects it in the scheme for local StoreKit testing. StoreKit needs no entitlement. |

## Configure

```ts
Pingfront.configure('pk_live_…', {
  topics: ['billing', 'bug', { id: 'sync', label: 'Sync is stuck', symbol: 'bug', prefill: 'Sync stopped: ' }],
  look: { accent: '#3550E6', corners: 'soft', headerStyle: 'team', replyExpectation: 'Usually replies within a few hours' },
  modules: { push: true, storeKit: { products: ['pro_yearly'] }, billing: { products: ['pro_yearly'] }, reports: true },
  logLevel: 'debug',                     // request paths and statuses, never bodies or tokens
  logHandler: (entry) => myLogger.info(`[pingfront] ${entry.message}`), // native lines, already redacted
  language: 'de',                        // only with your own language picker; default follows the app
});
```

`logHandler` gets every native SDK line at or above `logLevel` as `{ level, message, category? }`, in addition to
unified logging or Logcat. Lines are redacted natively (ids, names, emails, URLs, tokens, server text and user input
appear as `<private>`), so they are safe to store or upload. `category` names the SDK area (`session`, `network`, `live`, ...),
with the same names on both platforms.
`language` is a BCP 47 tag; change it later with `setLanguage(tag)` (null follows the app and the system again) and
read it with `getLanguage()` or `usePingfrontLanguage()`. An invalid tag is ignored and logged natively.

Keep the handler to logging: don't call the pingfront API from it. Lines reach JavaScript asynchronously, so a handler
that triggers SDK work that logs would feed itself. A handler that throws is reported once.

The look published in the dashboard wins over `look`, field by field, exactly as in the native SDKs. Modules are
off until you turn them on: `storeKit` is iOS-only, `billing` Android-only, and both are ignored on the other
platform. Vendor adapters (RevenueCat, Superwall, Adapty) wrap vendor SDKs, so you add them natively and register
them before JavaScript configures:

```swift
// iOS, AppDelegate: add the PingFrontRevenueCat package (github.com/pingfront/pingfront-ios-revenuecat) to the app.
PingfrontReactNative.register(.revenueCat)
```

```kotlin
// Android, Application.onCreate: implementation("sh.pingfront:pingfront-revenuecat:1.0.0")
PingfrontReactNative.register(dev.pingfront.revenuecat.RevenueCat)
```

Then `modules: { vendors: ['revenuecat'] }`. An id that was never registered is logged as an error.

## API

Everything is a named export and also on the default `Pingfront` object.

| Call | What it does |
| --- | --- |
| `configure(appKey, options?)` | Starts the SDK. Checks the key offline; sends nothing. `null` reads the key from Info.plist or the manifest. |
| `identify(token)` | Verified identity: an HS256 token your backend signs. One thread across devices. |
| `identify({ userId, name?, email? })` | Named, unverified identity. |
| `setTraits(traits)`, `setEntitlement(entitlement)` | Profile and subscription state (wire format, ISO-8601 dates). |
| `logout()` | Forgets the person on this device and tells the server. |
| `eraseMyData(): Promise<void>` | Erases every server-side record of the person, then this device. Safe to retry. |
| `exportMyData(): Promise<string>` | Everything the server holds about the person, as the JSON text it sent. Save or share it as is, or `JSON.parse` it. |
| `prepare(): Promise<void>` | Creates the session now instead of lazily. |
| `openChat({ topic? })`, `closeChat(): Promise<void>` | The native chat. `closeChat` closes the presented chat and resolves once it is off screen, at once when none is; an embedded `<PingfrontChatView />` stays. |
| `<PingfrontChatView topic? />` | The same chat, embedded in your layout (a tab, a screen). See [The chat in a screen](#the-chat-in-a-screen). |
| `setLanguage(tag)`, `getLanguage()` | The chat's language override (BCP 47), or null to follow the app and the system. |
| `openReport(prefill?)`, `reportBug(text, { screenshotBase64? })` | Bug reports. |
| `handleUrl(url): Promise<boolean>` | Opens the chat, or the bug report, from a chat link (`?pingfront=chat`). See [Links into the chat](#links-into-the-chat). |
| `moment(name, props?): Promise<MomentResult>` | Reports an app moment. Never throws; failures come back as `{ type: 'failed' }`. |
| `setOffers(slots)` | Offers your app can show (`OfferSlot` in wire format). |
| `onOffer(handler, { chat? })` | Your paywall for offer cards. See below. Returns a remover. |
| `onLink(handler, { chat? })` | Links tapped in the chat: the handler returns (or resolves) `true` when your app handled one; a declined link opens natively. Returns a remover. See [Links from the chat](#links-from-the-chat). |
| `registerScreens(screens)`, `onScreen(handler, { chat? })` | Screens of your app the team's saved links can open. See [Saved links into your screens](#saved-links-into-your-screens). |
| `setPushToken(token)`, `handlePush(payload, { opened? })` | Push. |
| `handleBackgroundPush(payload)` | A silent pingfront push (iOS `content-available`): resolves `newData`, `noData`, `failed`, or null when it isn't pingfront's. Android handles it as a received push and resolves `noData`. |
| `isPingFrontPush(payload)`, `requestPushAuthorization()` | Push helpers. |
| `usesAppBadge(): Promise<boolean>` | True when the dashboard turned on the app icon badge. |
| `onTeamAction(handler)` | "Fix it for them" actions your app does. See [Team actions](#team-actions). Returns a remover. |
| `conversation`, `usePingfrontConversation()` | The thread as state and actions, for your own chat UI. See [Build your own UI](#build-your-own-ui). |
| `getUnreadCount()`, `subscribeUnreadCount(listener)` | The unread count without React. |
| `addListener(type \| '*', listener)` | Native events. Returns `{ remove() }`. |
| `selfCheck(): Promise<{ passed, code?, line }>` | The native SDK's setup check: sends "Setup check from <app>" to your inbox and reports the key, network, server, secure storage or identity problem. |

Errors from promises are `PingfrontError` with a stable `code` (`network`, `key_unknown`, `app_paused`,
`cooling_down`, `server` with `serverCode`, …). Messages are for developers, never for people.

## The chat in a screen

`<PingfrontChatView />` is the native chat inside your layout instead of a sheet: SwiftUI's `PingFrontChatView` in a
child `UIHostingController` on iOS, the Android SDK's `PingFrontChatView` (a View that hosts the `PingFrontChat`
composable) on Android, as a Fabric view.

```tsx
import { PingfrontChatView } from '@pingfront/react-native';

function HelpScreen() {
  return <PingfrontChatView style={{ flex: 1 }} topic="billing" />;
}
```

- Give it a size (usually `flex: 1`). It pads for the keyboard, the home indicator and the navigation bar itself, so
  don't wrap it in a `KeyboardAvoidingView`. Your own header can sit above it and a tab bar below it: the chat pads only
  for the part of the status bar, navigation bar or keyboard that overlaps it (iOS through the safe area, Android
  through `PingFrontChatView`'s default `Insets.SafeDrawing`, which leaves out the space your layout leaves around the view).
- While it is on screen the native SDK counts the chat as visible: live updates, read receipts, the unread count
  cleared as the person reads, `chatOpened` and `chatClosed` events. Each chat on screen counts once, so a sheet that
  closes over an embedded chat leaves `isChatVisible` true and sends no `chatClosed`. On iOS it follows the view's window (a hidden tab
  or a popped screen is not visible). On Android it follows the activity's lifecycle and the view's visibility (a
  hidden view or ancestor is not visible; a visible view scrolled off screen, such as a pager page, still is).
- One at a time: a second `<PingfrontChatView />` mounted while one is up stays empty (with a warning in debug builds)
  until the first unmounts, so two copies of the thread never share the composer and draft. Every view renders empty
  for its first frame, while it claims the chat.
- Inside a React Native `<Modal>` it works on both platforms (on iOS it becomes a child of the modal's view controller).
- While it is on screen, `openChat()` focuses it instead of presenting a second chat over it, as the native SDKs do:
  the composer takes the cursor (and the topic's prefill). Chat links, notification taps and moments that open the chat
  do the same. `topic` takes the same values as `openChat({ topic })`.

## Build your own UI

`conversation` is the native SDKs' `conversation` (iOS `PingFront.shared.conversation`, Android
`PingFront.conversation`): the thread as state and the actions a chat UI needs, while the native SDK keeps the
session, the outbox and the live channel.

```tsx
function Thread() {
  const { messages, pending, phase, hasOlder } = usePingfrontConversation();
  const [refreshing, setRefreshing] = useState(false);
  useEffect(() => {
    Pingfront.conversation.reload(); // loads the thread, starting the session if needed
  }, []);
  // The person sees the thread: the team sees Read and the unread count drops to 0.
  useEffect(() => Pingfront.conversation.markRead(), [messages]);
  const refresh = async () => {
    setRefreshing(true);
    await Pingfront.conversation.reload(); // resolves when the reload has finished
    setRefreshing(false);
  };
  // render messages (wire format: author, parts, createdAt) and pending sends, with
  // <RefreshControl refreshing={refreshing} onRefresh={refresh} />
  return <Composer onSend={(text) => Pingfront.conversation.send(text)} />;
}
```

Actions: `send(text)`, `retry(clientId)`, `discard(clientId)`, `loadOlder()`, `reload()`, `markRead()`, `setTyping(on)`,
`openCard(messageId, cardId)`, `choose(messageId, cardId, optionId)` and `rate(messageId, cardId, rating)`. State:
`phase`, `messages` (the protocol's `Message`; a part type this version doesn't know arrives as
`{ type: 'unknown' }`, so show the message's `fallback`), `pending`, `hasOlder`, `isLoadingOlder`, `typing`,
`replyExpectation`, `policy`, `status`, `teamReadSeq`, `isOffline` and `isServerUnreachable` (the device is online,
but the service could not be reached: say the chat can't be reached rather than "offline"). The bridge sends the state only while something
subscribes (`usePingfrontConversation` or `conversation.subscribe`), forgets it when the last subscriber leaves and on
`logout()` or `eraseMyData()`, and sends messages and pending sends only when they changed (a changed thread crosses
whole: at most the 500 messages the native SDK keeps). `rate` rounds and clamps to 1...5 and ignores NaN and
infinities. Photos are not sent through this API yet.

`reload()` returns a promise that resolves when the reload has finished (the thread loaded, or the load failed; on
failure `phase` is `failed` only when there is nothing to show) and never rejects. `markRead()` marks the messages on
screen as read; call it while your screen shows the thread and when new messages arrive. It sends nothing when there
is nothing to mark or while the app is paused. The native chat does both by itself. Your own screen does not count as
a visible chat (`isChatVisible`), so it gets no live updates.

Card actions (`openCard`, `choose`, `rate`) go through the native SDK, which keeps each report with its own
`clientId` and resends it until the server records it (offline, timeouts, 429 and 5xx), so a pick shows at once and
is recorded once. The native SDKs never open a `javascript:`, `data:`, `vbscript:`, `file:`, `blob:`, `about:`, `content:` or `intent:` link, and never hand one to your link handler.
The bridge opens no link itself: every link goes to your `onLink` handler, and the native SDK, whose `onLink` is
async, waits for the answer and opens one it declines (or doesn't answer within 10 seconds) with the shared
link-scheme rule. A link card is reported as it really went: opened, or failed with `cannot_open`.

The native outbox decides what is sent and when; draw `pending` as it says, and don't add a retry state of your own. A
message with `state: 'failed'` and a `heldFor` (`app_paused`, `verification_required`) is held (`isHeld` is true): it goes again by
itself, first, when sending reopens, and the messages behind it wait for it, so show it as waiting rather than with
Try again. `discard(clientId)` removes any of them, held or not. A blocked person's messages are never held: they fail
plainly.

When the team resets the conversation from the dashboard, the native SDK drops the thread, its messages and the
unread count and keeps the draft and the outbox (the next message starts a new thread). The native chat empties in place
(the live `thread_reset`); a screen of your own sees the empty thread on its next load.

## Team actions

A teammate can run an action from the inbox that your app has to do ("Fix it for them"): `extend_trial`,
`grant_access` or one of your own. Do the work once per `action.id`, then answer:

```ts
useEffect(() => Pingfront.onTeamAction(async (action) => {
  if (action.actionId === 'repair_sync') {
    await sync.repair();
    await action.complete();          // the receipt line posts in the thread
  } else {
    await action.fail(`This version of the app can't do ${action.name}.`); // shown to the team only
  }
}), []);
```

Actions not answered yet are replayed natively to each new handler, so one sent while the app was closed still
arrives. The bridge collects them only while a handler is set. The handler may be async: if it throws or rejects
before answering, the action fails with a generic reason (never the error, which could carry personal data). With
several handlers, each gets every action and the first answer wins.

## Offers and the modal paywall

The chat is a native sheet on iOS and its own activity on Android, above your React root. A React Native
`<Modal>` paywall opened while it is up never shows: on iOS the root view controller is already presenting the
chat, and on Android the modal attaches to the activity behind the chat.

`onOffer` handles it. By default it closes the chat, waits until it is off screen, and only then calls your
handler, so your modal opens on top:

```tsx
const [offer, setOffer] = useState<OfferRequest | null>(null);
useEffect(() => Pingfront.onOffer((request) => setOffer(request)), []);

<Modal visible={offer !== null} onRequestClose={() => setOffer(null)}>
  <Paywall offerId={offer?.offerId} storeOffer={offer?.storeOffer} />
</Modal>
```

Pass `{ chat: 'keep' }` only when the paywall presents itself natively above the top-most screen (RevenueCat's
`presentPaywall`, Superwall); then the person comes back to the chat after it. While a handler is set it wins over
the native StoreKit, Billing and vendor-adapter handlers, as `onOffer` does in the native SDKs. Remove it (the
function `onOffer` returns) to hand cards back to them.

## Links from the chat

Every link the person taps in the chat (message text and link cards) comes to your handler first. Return or resolve
`true` when your app handled it; return `false` to let the native SDK open it the way the chat does (web links in the
in-app browser, your own scheme through the system):

```tsx
useEffect(
  () =>
    Pingfront.onLink((url) => {
      if (!url.startsWith('myapp://')) return false;
      navigation.navigate(routeFor(url));
      return true;
    }),
  []
);
```

- The native SDKs apply the link card URL rule first, so a `javascript:`, `file:` or other refused link never reaches
  your handler.
- The tap waits for your answer (a promise is awaited), up to 10 seconds. A throw, a rejection or no answer in time
  counts as `false`: the link opens natively.
- The chat closes only after your handler answers `true` (`{ chat: 'keep' }` leaves it open); a declined link keeps
  the person in the chat.
- A link card your handler declines and that then can't be opened is reported to the team as `cannot_open`, as it
  really went.
- Registering again (an effect whose dependencies changed) replaces the handler without dropping a tap that is still
  waiting: its answer still counts. The same holds for `onScreen`.

## Saved links into your screens

The team can send link cards that open a screen of your app. Register the screens this build can open, and open
them when such a card is tapped:

```tsx
Pingfront.registerScreens([
  { id: 'settings.sound', title: 'Sound settings' }, // the title is for the team's dashboard only
  { id: 'plans/yearly' },
]);

useEffect(
  () =>
    Pingfront.onScreen(async (screen) => {
      navigation.navigate(screen.id, screen.params); // params: Record<string, string>
      return true; // false: the app can't open it now
    }),
  []
);
```

- Ids match `^[A-Za-z0-9][A-Za-z0-9_./:-]{0,99}$`: a bad id throws in a debug build and is dropped in a release
  build. Each id counts once, at most 200. Registering sends nothing; the native SDK sends the list with the
  sessions it starts anyway.
- Your handler runs with the chat still up, and the chat closes once it answers `true` (`{ chat: 'keep' }` leaves
  it). Return or resolve `true` when the screen opened. A throw, a rejection or `false` counts as not handled, the
  chat stays open, and the team sees the link failed.
- The tap waits for your answer, up to 10 seconds; no answer in time counts as not handled, and a later answer is
  ignored (it neither counts nor closes the chat).
- A card for a screen this build didn't register opens its URL instead (through `onLink`, then the browser).

## Links into the chat

A link can open the chat: an email from your team, a "Message us" QR code, a "Chat with us in the app" button on your
website, or a push you send through your own provider. Add `pingfront=chat` (or `pingfront=report`) to a URL your app
already opens, on your universal link or App Link domain or your custom scheme, and hand incoming URLs over:

```ts
import { Linking } from 'react-native';

const initialUrl = await Linking.getInitialURL();
if (initialUrl) await Pingfront.handleUrl(initialUrl);
Linking.addEventListener('url', async ({ url }) => {
  if (await Pingfront.handleUrl(url)) return;
  // your own routing
});
```

`handleUrl` resolves `true` when the URL was a chat link (the native SDK opened the chat or the report) and `false`
for anything else. The SDK claims no domain or scheme: your `scheme` in `app.json`, associated domains and intent
filters stay yours. `topic` applies only when it is one of the chat's topics; other parameters are ignored and a link
never puts text in the composer. It sends nothing itself, and before `configure` the native SDK keeps the link and
opens it right after. With Expo Router or React Navigation linking, call `handleUrl` first and let your router handle
the URLs it declines. The rules are in [Chat links](https://pingfront.sh/docs/chat-links).
`example/` opens `pingfrontexample://help?pingfront=chat` this way.

## Push

```ts
// iOS: the APNs token as hex. Android: the FCM registration token. null unregisters this install, on both.
Pingfront.setPushToken(token);

// A notification arrived (foreground) or was tapped (opened: true opens the chat).
await Pingfront.handlePush(payload, { opened: true });
```

With `modules: { push: true }`, iOS installs a notification delegate only when the app has none, and Android
handles FCM itself through `pingfront-push`. If expo-notifications or React Native Firebase already owns
notifications, keep their setup, turn the Android module off (`push: { androidModule: false }` in the Expo
plugin, `pingfront.push=false` otherwise) and forward tokens and payloads with the two calls above. The same goes for OneSignal, Braze or any other push SDK: pass
pingfront's raw APNs or FCM token to `setPushToken` (not the provider's own id), and hand every received or tapped
payload to `handlePush` first; it resolves `false` for payloads that aren't pingfront's. A push you send
through that provider can open the chat too, with a chat link as its deep link ([Links into the chat](#links-into-the-chat)).

## Hooks and events

```tsx
const unread = usePingfrontUnread();        // number
const person = usePingfrontPerson();        // Person | null
const visible = usePingfrontChatVisible();  // boolean
usePingfrontEvents((event) => {
  if (event.type === 'messageReceived') showBanner(event.message.preview);
}, ['messageReceived']);                    // useChatEvents is the same hook
```

```tsx
const language = usePingfrontLanguage();    // string | null
const look = usePingfrontLook();            // the resolved chat look: colors as #RRGGBB pairs, shape, topics
```

Events: `chatOpened`, `chatClosed`, `messageReceived`, `messageSent` (`{ id, textLength, photoCount, repliesToPing }`,
never the text), `cardOpened` (`{ kind, cardId, messageId }`; a kind a newer server adds keeps its name),
`unreadChanged`, `sessionStarted`, `sessionRevoked` (the server revoked this install, for example after a logout or an
erase on another device: the SDK starts over as a guest, and messages still in the outbox (queued, held or failed)
are wiped by design,
so text never goes out under a different guest), `identityProblem`, `offerRequested`, `offerCompleted`,
`lookChanged`, `configurationProblem`, `reportSent`. A
type a newer native SDK adds arrives as `{ type: 'unknown', name, raw }`, never as a crash; so do unknown offer
outcomes and moment results. Open wire enums (entitlement states, sources, store offer kinds) are typed as their
known values plus `string`.

## Parity with the native SDKs

| Native | React Native | Notes |
| --- | --- | --- |
| `configure` with options and modules | `configure(appKey, options)` | Same defaults and look merge. |
| `logHandler` | `configure(…, { logHandler })` | Lines as the native handler gives them, with `category` on both platforms. |
| `language` (configure and runtime) | `configure(…, { language })`, `setLanguage`, `getLanguage`, `usePingfrontLanguage` | |
| `identify`, `setTraits`, `setEntitlement`, `logout`, `eraseMyData`, `exportMyData`, `prepare` | same names | |
| `openChat(topic:)`, `closeChat()` | `openChat({ topic })`, `closeChat()` | `closeChat` closes the SDK-presented chat and resolves once it is off screen, at once when none is; an embedded `<PingfrontChatView />` stays and is not waited for. |
| `moment` | `moment` | Results as a tagged union. |
| `setOffers`, `onOffer` | `setOffers`, `onOffer` | `onOffer` dismisses the chat first by default (see above). |
| `onLink` | `onLink` | Async, like the native SDKs': the native SDK waits for JavaScript (up to 10 seconds) and opens a declined link itself. |
| `registerScreens`, `onScreen` | `registerScreens`, `onScreen` | The native SDKs wait for the handler's answer (up to 10 seconds). |
| `unreadCount`, `person`, `isChatVisible`, `events` | hooks, `subscribeUnreadCount`, `addListener` | Every native event, `messageSent` and `cardOpened` included. |
| `look` | `usePingfrontLook`, `getSnapshot().look` | The resolved look's colors, shape and topic ids. |
| `storeAccountToken` | `getSnapshot().storeAccountToken` | Both platforms; read again whenever the person changes. |
| `usesAppBadge` | `usesAppBadge()` | |
| `handleBackgroundPush` (iOS) | `handleBackgroundPush` | Android has no separate path: a pingfront payload is handled as a received push. |
| `teamActions` | `onTeamAction` | `complete()` and `fail(message)` answer the native action. |
| `selfCheck()`, `-PingFrontSelfCheck` / `pingfront_selfcheck` | `selfCheck()` | `selfCheck()` calls the native one, so it sends the same setup message and returns the same line. In debug builds the native launch switches work on both platforms: `-PingFrontSelfCheck` on iOS, `--ez pingfront_selfcheck true` on Android (both print `PingFront self-check: PASS` or the failure). |
| SwiftUI and Compose views (`PingFrontChatView`, `PingFrontChat`) | `<PingfrontChatView />` | A Fabric view. |
| `conversation` (build your own UI) | `conversation`, `usePingfrontConversation` | Text sends, retry, discard, older pages, awaitable reload, `markRead`, typing and card actions; `isServerUnreachable`, and `heldFor` and `isHeld` on pending sends. Not bridged: photo sends (`send(text:photos:)`), `photoData`, `refreshedURL`, the draft, `timeline`, `team` and `cooldownRemaining`. |
| `requestPushAuthorization` | `requestPushAuthorization()` | iOS calls the native one; Android asks for `POST_NOTIFICATIONS` from JavaScript (the Android SDK has no such call). |

## Architecture

```
 JavaScript                           Native
 src/index.ts (typed API, hooks)      ios/Pingfront.mm  -> ios/PingfrontBridge.swift -> PingFront (Swift package, pingfront-ios)
   src/specs/NativePingfront.ts  ===  Turbo Module (Codegen)
   decode.ts (unknown-safe)           android/.../PingfrontModule.kt -> sh.pingfront:pingfront (pingfront-android)
   store.ts (one owner of state)
 src/PingfrontChatView.tsx            ios/PingfrontChatViewComponentView.mm -> PingfrontChatHostView.swift (UIHostingController)
   specs/PingfrontChatViewNativeComponent.ts === Fabric component (Codegen)
                                      android/.../PingfrontChatViewManager.kt -> dev.pingfront.ui.PingFrontChatView
```

- One Turbo Module, `Pingfront`, from the Codegen spec in `src/specs/NativePingfront.ts`, and one Fabric component,
  `PingfrontChatView`, from `src/specs/PingfrontChatViewNativeComponent.ts` (Codegen type `all`; the iOS component is
  registered through `codegenConfig.ios.componentProvider`). The view's `topic` crosses as JSON in the shape
  `openChat` sends, so localized labels survive Codegen's flat props.
- Values cross as JSON-shaped objects in the wire format of [pingfront's API](https://pingfront.sh/openapi.yaml); the native side
  decodes them with the SDKs' own `Codable` and kotlinx models.
- Codegen event emitters: `onEvent` (every `PingFrontEvent`), `onState` (changed snapshot fields, from
  Observation on iOS and the SDK's `StateFlow`s on Android), `onOfferRequest`, `onLinkRequest`, `onScreenRequest`, `onLog` (only with a
  `logHandler`), `onTeamAction` (only while a handler is set) and `onConversation` (only while subscribed).
- iOS calls run on the main queue (the SDK's facade is `@MainActor`). Android work runs in a module-owned
  coroutine scope that is cancelled with the React instance.
- A new install sends nothing at launch: importing the package and `configure` send nothing, as in the native SDKs (an
  install with a session from an earlier launch may check unread messages and report store lapses).
- Device context (build, display, connection, health, notifications) is collected and sent by the native SDKs, with
  the same per-app switches; see their READMEs. The bridge adds nothing to it.

## Development

```sh
npm install
npm test && npm run typecheck && npm run lint   # Jest, TypeScript, ESLint with no warnings
npm run android:check                           # the bridge's Kotlin compiled in the example app (Jest never compiles it)
```

`android:check` needs the example's own `node_modules` first (`cd example && npm ci`). It runs Gradle with every
warning shown and fails on any Gradle deprecation or Kotlin warning in this package's own `android/` code. Libraries
the example uses (react-native-safe-area-context) are reported, not held to that standard: their Gradle files still
use deprecated syntax. It compiles against the Android SDK on Maven Central, or against a local checkout of
[pingfront for Android](https://github.com/pingfront/pingfront-android#readme) when `PINGFRONT_ANDROID_SDK` points at one (`npm run android:sdk`
publishes that checkout to `.maven`, which the example reads first). The iOS side resolves the
[pingfront Swift package](https://github.com/pingfront/pingfront-ios#readme) from GitHub, or `PINGFRONT_IOS_SDK` (a path or a git URL).

### The example app

`example/` is a small app with the presented chat, the chat in a screen, offers, links and the self-check. It runs
the library from `src/` and talks to pingfront with your app's test key:

1. Put your test key (`pk_test_…`, from **Settings › Keys** in the dashboard) in `example/src/config.ts`, or in a
   `example/src/config.local.ts` of your own (gitignored, same exports), which the example uses instead.
2. Run it:

   ```sh
   cd example && npm install && npm start   # Metro on 8081
   (cd ios && pod install) && npm run ios   # or: npm run android
   ```

"Chat in a screen" opens `<PingfrontChatView />`. Scripts reach the same screens without taps: on Android with links
(`adb shell am start -d 'pingfrontexample://screen/chat'`, `pingfrontexample://send?text=Hi` sends through
`conversation.send`), on iOS with launch arguments, since a simulator without a window can't confirm a link
(`xcrun simctl launch <udid> dev.pingfront.example.rn -PingfrontExampleScreen chat -PingfrontExampleSend Hi
-PingfrontExampleLanguage de`). The home screen counts the native log lines `logHandler` received.
