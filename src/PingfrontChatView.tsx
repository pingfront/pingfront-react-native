import { useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, View, type ViewProps } from 'react-native';
import { LOG_PREFIX } from './constants';
import { requireNative } from './native';
import { nativeTopic } from './pingfront';
import NativeChatView from './specs/PingfrontChatViewNativeComponent';
import type { ChatTopic } from './types';

declare const __DEV__: boolean;

export interface PingfrontChatViewProps extends ViewProps {
  /** With a topic, its prefill goes into the composer (or it starts the thread on that topic). */
  topic?: ChatTopic;
}

/**
 * Only one embedded chat shows at a time: the first one whose mount effect runs. Another one renders an empty view
 * (and warns in debug builds) until the first unmounts, so two copies of the thread never fight over the composer, the draft and
 * the "chat is visible" state the native SDK keeps.
 */
let owner: object | null = null;
const waiting = new Set<() => void>();

function claim(token: object): boolean {
  if (owner === null) owner = token;
  return owner === token;
}

function release(token: object) {
  if (owner !== token) return;
  owner = null;
  for (const wake of [...waiting]) wake();
}

/**
 * The native chat, embedded in your layout: a tab, a screen in your navigator, or part of a screen. It is the
 * same chat `openChat()` presents (iMessage-style on iOS, Google Messages-style on Android), hosted in a Fabric
 * view: SwiftUI's `PingFrontChatView` in a child `UIHostingController` on iOS, the `PingFrontChat` composable in a
 * `ComposeView` on Android.
 *
 * While it is on screen the native SDK counts the chat as visible (live updates, read receipts, no unread polling)
 * and the person's unread count is cleared as they read. Give it a size, usually `flex: 1`; it pads for the
 * keyboard, the home indicator and the navigation bar itself, so don't wrap it in a `KeyboardAvoidingView`.
 *
 * ```tsx
 * function HelpScreen() {
 *   return <PingfrontChatView style={{ flex: 1 }} />;
 * }
 * // <Tab.Screen name="Help" component={HelpScreen} />: a stable component, never an inline arrow, which would
 * // remount the chat on every render of the navigator.
 * ```
 *
 * Call `configure` first. `openChat()` still presents the sheet above it; use one or the other for a screen.
 */
export function PingfrontChatView({
  topic,
  style,
  ...rest
}: PingfrontChatViewProps) {
  // The native view is registered with the Turbo Module's package; without it the view would render nothing.
  requireNative();
  const token = useRef<object>({}).current;
  // Ownership is claimed in an effect, never during render: two views mounted in the same commit would otherwise
  // both render the native chat for a frame. The first render is an empty view of the same size.
  const [active, setActive] = useState(false);
  useEffect(() => {
    const tryClaim = () => setActive(claim(token));
    tryClaim();
    if (owner !== token) {
      if (__DEV__) {
        console.warn(
          `${LOG_PREFIX} Another <PingfrontChatView /> is already mounted; this one stays empty until it unmounts.`
        );
      }
      waiting.add(tryClaim);
    }
    return () => {
      waiting.delete(tryClaim);
      release(token);
    };
  }, [token]);
  const topicJson = useMemo(
    () => (topic ? JSON.stringify(nativeTopic(topic)) : ''),
    [topic]
  );
  if (!active) return <View style={[styles.fill, style]} {...rest} />;
  return (
    <NativeChatView style={[styles.fill, style]} topic={topicJson} {...rest} />
  );
}

/** Tests only. */
export function resetChatViewForTests(): void {
  owner = null;
  waiting.clear();
}

const styles = StyleSheet.create({ fill: { flex: 1 } });
