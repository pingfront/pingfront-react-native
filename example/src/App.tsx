import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import {
  BackHandler,
  Linking,
  LogBox,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Settings,
  StatusBar,
  StyleSheet,
  Text,
  useColorScheme,
  View,
} from 'react-native';
import Pingfront, {
  PingfrontChatView,
  usePingfrontEvents,
  usePingfrontPerson,
  usePingfrontUnread,
  type OfferRequest,
} from '@pingfront/react-native';
import {
  SafeAreaProvider,
  useSafeAreaInsets,
} from 'react-native-safe-area-context';
import { APP_KEY, BASE_URL } from './config';

// The "two chat views" screen shows this warning's case on purpose.
LogBox.ignoreLogs(['Another <PingfrontChatView /> is already mounted']);

// The native SDK's log lines, counted for the home screen (they also go to the JS console).
let sdkLog = { count: 0, last: '' };
const sdkLogListeners = new Set<() => void>();
const subscribeSdkLog = (listener: () => void) => {
  sdkLogListeners.add(listener);
  return () => {
    sdkLogListeners.delete(listener);
  };
};

// Configure once, at module scope. It checks the key offline and sends nothing.
Pingfront.configure(APP_KEY, {
  baseUrl: BASE_URL,
  logLevel: 'debug',
  // Native SDK lines, already redacted, in Metro's log next to the app's own.
  logHandler: (entry) => {
    const line = `[pingfront${entry.category ? `/${entry.category}` : ''}] ${entry.level}: ${entry.message}`;
    console.log(line);
    sdkLog = { count: sdkLog.count + 1, last: line };
    for (const listener of sdkLogListeners) listener();
  },
  topics: ['billing', 'bug', 'idea'],
  look: { replyExpectation: 'Usually replies within a few hours' },
});

// "Fix it for them": the dashboard's sample actions are answered here so the receipt line posts.
Pingfront.onTeamAction(async (action) => {
  if (action.actionId === 'extend_trial') await action.complete();
  else await action.fail(`The example app can't do ${action.name}.`);
});

Pingfront.setOffers([
  { id: 'yearly_winback', title: 'Pro yearly', kind: 'winback' },
]);

export default function App() {
  return (
    <SafeAreaProvider>
      <Help />
    </SafeAreaProvider>
  );
}

function Help() {
  // Android draws edge to edge, so the home screen starts below the status bar; iOS insets the scroll view for
  // the safe area by itself (see the ScrollView below).
  const insets = useSafeAreaInsets();
  const topInset = Platform.OS === 'android' ? insets.top : 0;
  const dark = useColorScheme() === 'dark';
  const colors = dark ? darkColors : lightColors;
  const unread = usePingfrontUnread();
  const log$ = useSyncExternalStore(subscribeSdkLog, () => sdkLog);
  const person = usePingfrontPerson();
  const [log, setLog] = useState<string[]>([]);
  const [offer, setOffer] = useState<OfferRequest | null>(null);
  // Debug builds: when the offer card's request reached JavaScript and when the handler ran (Date.now()), for scripts
  // that measure the dismiss-before-handler wait.
  const timing = useRef({ requested: 0, handler: 0 });
  // The chat embedded in a screen of the app (<PingfrontChatView />) instead of the sheet openChat() presents.
  // iOS launch arguments (`-PingfrontExampleScreen chat`, `-PingfrontExampleSend <text>`,
  // `-PingfrontExampleLanguage de`) do what the
  // links below do, for scripts on a simulator without a window, where opening a link asks for a tap.
  // Screens: `chat` (full screen), `tabs` (above a tab bar), `modal` (inside a React Native <Modal>) and
  // `two` (two chat views at once: only the first shows the chat).
  const [screen, setScreen] = useState<Screen>(() =>
    screenNamed(launchArgument('PingfrontExampleScreen'))
  );
  // A <Modal> rendered visible in the very first render, before the window is up, is never presented on iOS:
  // the modal screen opens once the app has mounted.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  useEffect(() => {
    // `sheet`: the chat openChat() presents, for comparing it with the embedded one.
    if (launchArgument('PingfrontExampleScreen') === 'sheet')
      Pingfront.openChat();
    // `-PingfrontExampleLogout yes`: log out a few seconds after launch, with the chat on screen.
    // `-PingfrontExampleOpenSheet yes`: present the sheet a few seconds after launch, above an embedded chat.
    if (__DEV__ && launchArgument('PingfrontExampleOpenSheet') === 'yes') {
      setTimeout(() => Pingfront.openChat(), 4000);
    }
    if (__DEV__ && launchArgument('PingfrontExampleLogout') === 'yes') {
      setTimeout(() => Pingfront.logout(), 5000);
    }
    const language = launchArgument('PingfrontExampleLanguage');
    if (language) Pingfront.setLanguage(language);
    // Sending from a launch argument or a link is for scripts on debug builds only.
    const text = launchArgument('PingfrontExampleSend');
    if (__DEV__ && text) Pingfront.conversation.send(text);
  }, []);

  const note = (line: string) =>
    setLog((lines) => [line, ...lines].slice(0, 6));

  usePingfrontEvents((event) => {
    if (event.type === 'messageReceived')
      note(`Message: ${event.message.preview}`);
    else if (event.type === 'messageSent')
      note(`Sent: ${event.message.textLength} characters`);
    else if (event.type === 'cardOpened') note(`Card: ${event.card.kind}`);
    else if (event.type === 'offerRequested') {
      timing.current.requested = Date.now();
      note(`Event: ${event.type}`);
    } else if (event.type === 'unknown') note(`Event: ${event.name}`);
    else note(`Event: ${event.type}`);
  });

  // An offer card opens this JS <Modal> paywall. onOffer closes the native chat first, so the
  // modal is not hidden behind the chat sheet.
  useEffect(
    () =>
      Pingfront.onOffer((request) => {
        // Scripts measure the time from the tap on the card to here (adb logcat, Date.now() on the device).
        timing.current.handler = Date.now();
        console.log(`[example] offer handler at ${timing.current.handler}`);
        setOffer(request);
      }),
    []
  );

  // Chat links: pingfrontexample://help?pingfront=chat (or &topic=billing, or pingfront=report) opens the
  // chat, so scripts (and you) can open it with `xcrun simctl openurl` or `adb shell am start -d`.
  // handleUrl resolves false for the app's own links, which the app routes itself.
  useEffect(() => {
    // pingfrontexample://screen/chat and pingfrontexample://screen/home switch screens;
    // pingfrontexample://send?text=... sends through the build-your-own-UI conversation API.
    const route = async (url: string | null) => {
      if (!url) return false;
      if (await Pingfront.handleUrl(url)) return true;
      const parsed = /^pingfrontexample:\/\/([a-z]+)\/?([a-z]*)\??(.*)$/.exec(
        url
      );
      if (parsed?.[1] === 'screen' && parsed[2] === 'sheet')
        Pingfront.openChat();
      else if (parsed?.[1] === 'screen') setScreen(screenNamed(parsed[2]));
      if (__DEV__ && parsed?.[1] === 'send') {
        const text = new URLSearchParams(parsed[3]).get('text');
        if (text) Pingfront.conversation.send(text);
      }
      return false;
    };
    Linking.getInitialURL().then(route);
    const subscription = Linking.addEventListener('url', ({ url }) =>
      route(url)
    );
    return () => subscription.remove();
  }, []);

  // Links in the chat come here first. Ours (pingfrontexample://...) are handled, and the chat closes once we say so;
  // anything else is declined and opens natively (web links in the in-app browser).
  useEffect(
    () =>
      Pingfront.onLink((url) => {
        if (!url.startsWith('pingfrontexample://')) return false;
        note(`Link: ${url}`);
        return true;
      }),
    []
  );

  // Android's back button leaves the chat screen.
  useEffect(() => {
    if (screen === 'home') return;
    const subscription = BackHandler.addEventListener(
      'hardwareBackPress',
      () => {
        setScreen('home');
        return true;
      }
    );
    return () => subscription.remove();
  }, [screen]);

  const header = <Header colors={colors} onDone={() => setScreen('home')} />;

  // The paywall an offer card opens, on every screen: the embedded chat shows offer cards too.
  const paywall = (
    <Modal
      visible={offer !== null}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={() => setOffer(null)}
    >
      <View style={[styles.paywall, { backgroundColor: colors.background }]}>
        {__DEV__ ? (
          // Invisible: read by UI test scripts (offer request and handler times, in ms).
          <View
            accessible
            testID="offer-timing"
            accessibilityLabel={`requested=${timing.current.requested};handler=${timing.current.handler}`}
            style={styles.marker}
          />
        ) : null}
        <Text style={[styles.title, { color: colors.label }]}>Pro yearly</Text>
        <Text style={[styles.subtitle, { color: colors.secondary }]}>
          {`Opened from offer card ${offer?.cardId ?? ''} (${offer?.offerId ?? ''}).`}
        </Text>
        <Pressable
          accessibilityRole="button"
          style={[styles.button, { backgroundColor: colors.tint }]}
          onPress={() => setOffer(null)}
        >
          <Text style={styles.buttonText}>Not now</Text>
        </Pressable>
      </View>
    </Modal>
  );

  if (screen === 'chat' || screen === 'two') {
    return (
      <View style={[styles.screen, { backgroundColor: colors.group }]}>
        <StatusBar barStyle={dark ? 'light-content' : 'dark-content'} />
        {header}
        <PingfrontChatView style={styles.screen} />
        {screen === 'two' ? (
          <>
            <Text style={[styles.caption, { color: colors.secondary }]}>
              A second chat view stays empty while the first is mounted.
            </Text>
            <PingfrontChatView
              style={[styles.screen, { backgroundColor: colors.background }]}
            />
          </>
        ) : null}
        {paywall}
      </View>
    );
  }

  // List-detail, as on a tablet or an unfolded phone: the chat beside a list, so its left edge is not the window's.
  if (screen === 'split') {
    return (
      <View style={[styles.screen, { backgroundColor: colors.group }]}>
        <StatusBar barStyle={dark ? 'light-content' : 'dark-content'} />
        {header}
        <View style={styles.split}>
          <View
            style={[
              styles.sidebar,
              {
                backgroundColor: colors.background,
                borderRightColor: colors.separator,
              },
            ]}
          >
            <Text style={[styles.rowLabel, { color: colors.label }]}>Help</Text>
          </View>
          <PingfrontChatView style={styles.screen} />
        </View>
        {paywall}
      </View>
    );
  }

  if (screen === 'tabs') {
    return (
      <View style={[styles.screen, { backgroundColor: colors.group }]}>
        <StatusBar barStyle={dark ? 'light-content' : 'dark-content'} />
        {header}
        <PingfrontChatView style={styles.screen} />
        <View
          style={[
            styles.tabBar,
            { backgroundColor: colors.group, borderTopColor: colors.separator },
          ]}
        >
          <View style={[styles.tabs, { paddingBottom: insets.bottom }]}>
            <Pressable
              accessibilityRole="button"
              style={styles.tab}
              onPress={() => setScreen('home')}
            >
              <Text style={[styles.tabLabel, { color: colors.secondary }]}>
                Home
              </Text>
            </Pressable>
            <View style={styles.tab}>
              <Text style={[styles.tabLabel, { color: colors.tint }]}>
                Help
              </Text>
            </View>
          </View>
        </View>
        {paywall}
      </View>
    );
  }

  return (
    <View style={[styles.screen, { backgroundColor: colors.background }]}>
      <StatusBar barStyle={dark ? 'light-content' : 'dark-content'} />
      {/* "always" insets every edge on its own and follows changes. "automatic" insets only the scrolling
          axis, so on a foldable iPhone, whose controls sit in a bar on one side, the rows ran under it. */}
      <ScrollView
        contentInsetAdjustmentBehavior="always"
        contentContainerStyle={[styles.content, { paddingTop: 24 + topInset }]}
      >
        <Text style={[styles.title, { color: colors.label }]}>Help</Text>
        <Text style={[styles.subtitle, { color: colors.secondary }]}>
          {person
            ? `Signed in as ${person.name ?? person.level}`
            : 'Not signed in'}
        </Text>

        <View style={[styles.group, { backgroundColor: colors.group }]}>
          <Row
            label="Chat with us"
            detail={unread > 0 ? String(unread) : undefined}
            badge={unread > 0}
            colors={colors}
            onPress={() => Pingfront.openChat()}
          />
          <Separator colors={colors} />
          <Row
            label="Ask about billing"
            colors={colors}
            onPress={() => Pingfront.openChat({ topic: 'billing' })}
          />
          <Separator colors={colors} />
          <Row
            label="Chat in a screen"
            colors={colors}
            onPress={() => setScreen('chat')}
          />
          <Separator colors={colors} />
          <Row
            label="Chat above a tab bar"
            colors={colors}
            onPress={() => setScreen('tabs')}
          />
          <Separator colors={colors} />
          <Row
            label="Chat in a modal"
            colors={colors}
            onPress={() => setScreen('modal')}
          />
          <Separator colors={colors} />
          <Row
            label="Report a bug"
            colors={colors}
            onPress={() => Pingfront.openReport()}
          />
        </View>

        <View style={[styles.group, { backgroundColor: colors.group }]}>
          <Row
            label="Sign in as Riley"
            colors={colors}
            onPress={() =>
              Pingfront.identify({ userId: 'riley-rn', name: 'Riley' })
            }
          />
          <Separator colors={colors} />
          <Row
            label="Close the paywall (moment)"
            colors={colors}
            onPress={async () => {
              const result = await Pingfront.moment('paywall_closed', {
                screen: 'plans',
              });
              note(`paywall_closed: ${result.type}`);
            }}
          />
          <Separator colors={colors} />
          <Row
            label="Run the self-check"
            colors={colors}
            onPress={async () => {
              const result = await Pingfront.selfCheck().catch((e: Error) => ({
                line: e.message,
              }));
              note(result.line);
            }}
          />
          <Separator colors={colors} />
          <Row
            label="Log out"
            colors={colors}
            destructive
            onPress={() => Pingfront.logout()}
          />
        </View>

        {log$.count > 0 && (
          <Text style={[styles.logLine, { color: colors.secondary }]}>
            {`SDK log lines: ${log$.count}. Last: ${log$.last}`}
          </Text>
        )}
        {log.length > 0 && (
          <View style={styles.log}>
            {log.map((line, index) => (
              <Text
                key={`${index}-${line}`}
                style={[styles.logLine, { color: colors.secondary }]}
              >
                {line}
              </Text>
            ))}
          </View>
        )}
      </ScrollView>

      <Modal
        visible={mounted && screen === 'modal'}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setScreen('home')}
      >
        <View style={[styles.screen, { backgroundColor: colors.group }]}>
          {/* A modal is its own window: its insets come from its own provider (none in an iOS page sheet,
              the status bar on Android, which draws the modal edge to edge too). */}
          <SafeAreaProvider>
            <Header colors={colors} onDone={() => setScreen('home')} />
            <PingfrontChatView style={styles.screen} />
          </SafeAreaProvider>
        </View>
      </Modal>

      {paywall}
    </View>
  );
}

type Screen = 'home' | 'chat' | 'tabs' | 'modal' | 'two' | 'split';

function screenNamed(name: string | undefined): Screen {
  return name === 'chat' ||
    name === 'tabs' ||
    name === 'modal' ||
    name === 'two' ||
    name === 'split'
    ? name
    : 'home';
}

function Header(props: { colors: Colors; onDone: () => void }) {
  const insets = useSafeAreaInsets();
  return (
    <View
      style={{ paddingTop: insets.top, backgroundColor: props.colors.group }}
    >
      <View style={styles.header}>
        <Pressable
          accessibilityRole="button"
          hitSlop={12}
          onPress={props.onDone}
        >
          <Text style={[styles.headerButton, { color: props.colors.tint }]}>
            Done
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

function launchArgument(name: string): string | undefined {
  if (Platform.OS !== 'ios') return undefined;
  const value: unknown = Settings.get(name);
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

type Colors = typeof lightColors;

function Row(props: {
  label: string;
  detail?: string;
  badge?: boolean;
  destructive?: boolean;
  colors: Colors;
  onPress: () => void;
}) {
  const { colors } = props;
  return (
    <Pressable
      accessibilityRole="button"
      onPress={props.onPress}
      style={({ pressed }) => [
        styles.row,
        pressed && { backgroundColor: colors.pressed },
      ]}
    >
      <Text
        style={[
          styles.rowLabel,
          { color: props.destructive ? colors.destructive : colors.label },
        ]}
      >
        {props.label}
      </Text>
      {props.badge && props.detail ? (
        <View style={[styles.badge, { backgroundColor: colors.badge }]}>
          <Text style={styles.badgeText}>{props.detail}</Text>
        </View>
      ) : null}
    </Pressable>
  );
}

function Separator({ colors }: { colors: Colors }) {
  return (
    <View style={[styles.separator, { backgroundColor: colors.separator }]} />
  );
}

// iOS system colors (grouped table style).
const lightColors = {
  background: '#F2F2F7',
  group: '#FFFFFF',
  label: '#000000',
  secondary: '#3C3C4399',
  separator: '#3C3C4349',
  pressed: '#E5E5EA',
  tint: '#007AFF',
  destructive: '#FF3B30',
  badge: '#FF3B30',
};

const darkColors: Colors = {
  background: '#000000',
  group: '#1C1C1E',
  label: '#FFFFFF',
  secondary: '#EBEBF599',
  separator: '#54545899',
  pressed: '#2C2C2E',
  tint: '#0A84FF',
  destructive: '#FF453A',
  badge: '#FF453A',
};

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { padding: 16, paddingTop: 24 },
  title: { fontSize: 34, fontWeight: '700', marginBottom: 4 },
  subtitle: { fontSize: 15, marginBottom: 20 },
  group: { borderRadius: 12, overflow: 'hidden', marginBottom: 24 },
  row: {
    minHeight: 48,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  rowLabel: { fontSize: 17 },
  separator: { height: StyleSheet.hairlineWidth, marginLeft: 16 },
  badge: {
    minWidth: 24,
    height: 24,
    borderRadius: 12,
    paddingHorizontal: 7,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: { color: '#FFFFFF', fontSize: 15, fontWeight: '600' },
  log: { paddingHorizontal: 4 },
  logLine: { fontSize: 13, marginBottom: 6 },
  paywall: { flex: 1, padding: 24, paddingTop: 48 },
  header: {
    minHeight: 44,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
  },
  headerButton: { fontSize: 17, fontWeight: '600' },
  split: { flex: 1, flexDirection: 'row' },
  marker: { width: 1, height: 1 },
  sidebar: {
    width: '33%',
    padding: 16,
    borderRightWidth: StyleSheet.hairlineWidth,
  },
  caption: { fontSize: 13, paddingHorizontal: 16, paddingVertical: 8 },
  tabBar: { borderTopWidth: StyleSheet.hairlineWidth },
  tabs: { flexDirection: 'row' },
  tab: {
    flex: 1,
    minHeight: 49,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabLabel: { fontSize: 13, fontWeight: '600' },
  button: {
    marginTop: 24,
    height: 50,
    borderRadius: 25,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonText: { color: '#FFFFFF', fontSize: 17, fontWeight: '600' },
});
