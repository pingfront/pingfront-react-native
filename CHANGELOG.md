# Changelog

## 1.0.0

First release: a typed bridge over the pingfront iOS and Android SDKs (1.0), with the native chat on both platforms.

- `configure` with topics, the look, modules, `language` and `logHandler`. It checks the key offline and sends
  nothing; a new install makes no request until the chat or a call needs one.
- Identity: `identify`, `setTraits`, `setEntitlement`, `logout`, `eraseMyData`, `exportMyData` and `prepare`.
- The presented chat (`openChat`, `closeChat`) and `<PingfrontChatView />`, the native chat embedded in your layout,
  with a `topic` prop.
- Your own chat UI: `conversation` and `usePingfrontConversation`, with sends, retry, discard, older pages, reload,
  `markRead`, typing and card actions.
- Moments, offers (`setOffers`, `onOffer`, which dismisses the chat before your paywall shows), chat links
  (`handleUrl`, `onLink`) and saved links (`registerScreens`, `onScreen`).
- Team actions (`onTeamAction`, with `complete()` and `fail(message)`).
- Push: `setPushToken`, `handlePush`, `handleBackgroundPush`, `isPingFrontPush`, `requestPushAuthorization` and
  `usesAppBadge`.
- Hooks and events: unread count, person, chat visibility, language, look, and every native event. Unknown events,
  outcomes and enum values arrive as `unknown`, never as a crash.
- `selfCheck()`, the same check as the native SDKs.
- The Expo config plugin: the app key, push, Google Play Billing, a StoreKit configuration file for local testing,
  and `android.minSdkVersion` raised to 26.
- Requires React Native 0.80 or later with the New Architecture, iOS 17 and Android 8.0 (API 26).
