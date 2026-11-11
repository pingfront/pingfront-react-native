/**
 * The pure parts of the Expo config plugin: each takes a parsed native file and returns it changed,
 * so they are unit-tested without running a prebuild.
 */

/** Product-name strings the plugin writes; mirrors `src/constants.ts` (the plugin builds separately). */
const NAMES = {
  infoPlistKey: 'PingFrontAppKey',
  manifestKey: 'pingfront.app_key',
  gradlePush: 'pingfront.push',
  gradleBilling: 'pingfront.billing',
} as const;

export interface PingfrontPluginOptions {
  /** The public app key. Written to Info.plist and the Android manifest for `configure(null)`. */
  appKey?: string;
  /** Push setup. `true` is `{ iosEnvironment: 'development', androidModule: true }`. */
  push?:
    | boolean
    | {
        /** The `aps-environment` entitlement. Use `production` for TestFlight and App Store builds. */
        iosEnvironment?: 'development' | 'production';
        /** Add the `pingfront-push` FCM module (Firebase). Default true. */
        androidModule?: boolean;
      };
  /** Android: add the `pingfront-billing` module (Google Play Billing). */
  billing?: boolean;
  /** iOS: a `.storekit` file (path from the app root) to select in the scheme for local testing. */
  storeKitConfigFile?: string;
}

export interface ResolvedOptions {
  appKey?: string;
  push: {
    iosEnvironment: 'development' | 'production';
    androidModule: boolean;
  } | null;
  billing: boolean;
  storeKitConfigFile?: string;
}

const keyPattern = /^pk_(live|test)_[A-Za-z0-9]{24}$/;

export function resolveOptions(
  options: PingfrontPluginOptions
): ResolvedOptions {
  if (options.appKey !== undefined && !keyPattern.test(options.appKey)) {
    // The native SDKs check the checksum too; this catches the obvious mistakes at prebuild time.
    throw new Error(
      `appKey "${options.appKey}" is not a public app key (pk_live_… or pk_test_… with 24 characters). Copy it from Dashboard > App > Connect.`
    );
  }
  const push =
    options.push === undefined || options.push === false
      ? null
      : {
          iosEnvironment:
            (options.push === true ? undefined : options.push.iosEnvironment) ??
            'development',
          androidModule:
            (options.push === true ? undefined : options.push.androidModule) ??
            true,
        };
  const resolved: ResolvedOptions = { push, billing: options.billing === true };
  if (options.appKey) resolved.appKey = options.appKey;
  if (options.storeKitConfigFile)
    resolved.storeKitConfigFile = options.storeKitConfigFile;
  return resolved;
}

type Plist = Record<string, unknown>;

export function applyInfoPlist<T extends Plist>(
  plist: T,
  options: ResolvedOptions
): T {
  const next: Plist = { ...plist };
  if (options.appKey) next[NAMES.infoPlistKey] = options.appKey;
  if (options.push) {
    const modes = Array.isArray(next.UIBackgroundModes)
      ? [...(next.UIBackgroundModes as string[])]
      : [];
    // Lets a received pingfront push update the unread count while the app is in the background.
    if (!modes.includes('remote-notification'))
      modes.push('remote-notification');
    next.UIBackgroundModes = modes;
  }
  return next as T;
}

export function applyEntitlements<T extends Plist>(
  plist: T,
  options: ResolvedOptions
): T {
  if (!options.push) return plist;
  return { ...plist, 'aps-environment': options.push.iosEnvironment };
}

interface ManifestShape {
  manifest: {
    'uses-permission'?: Array<{ $: { 'android:name': string } }>;
    'application'?: unknown[];
  };
}

interface MetaData {
  $: { 'android:name': string; 'android:value'?: string };
}

export function applyAndroidManifest<T extends ManifestShape>(
  manifest: T,
  options: ResolvedOptions,
  mainApplication: (manifest: never) => unknown
): T {
  if (options.push) {
    const permissions = manifest.manifest['uses-permission'] ?? [];
    const name = 'android.permission.POST_NOTIFICATIONS';
    if (!permissions.some((p) => p.$['android:name'] === name)) {
      permissions.push({ $: { 'android:name': name } });
    }
    manifest.manifest['uses-permission'] = permissions;
  }
  if (options.appKey) {
    const application = mainApplication(manifest as never) as {
      'meta-data'?: MetaData[];
    };
    const items = (application['meta-data'] ?? []).filter(
      (item) => item.$['android:name'] !== NAMES.manifestKey
    );
    items.push({
      $: { 'android:name': NAMES.manifestKey, 'android:value': options.appKey },
    });
    application['meta-data'] = items;
  }
  return manifest;
}

type PropertiesItem =
  | { type: 'property'; key: string; value: string }
  | { type: 'comment'; value: string }
  | { type: 'empty' };

/** The pingfront Android SDK's minimum (Android 8.0). */
const MIN_SDK = 26;
const MIN_SDK_PROPERTY = 'android.minSdkVersion';

export function applyGradleProperties(
  items: PropertiesItem[],
  options: ResolvedOptions
): PropertiesItem[] {
  // Expo's prebuild template reads `android.minSdkVersion` (the property expo-build-properties writes) and starts at
  // 24; the pingfront Android SDK needs 26. A higher value the app set stays.
  const current = items.find(
    (item) => item.type === 'property' && item.key === MIN_SDK_PROPERTY
  );
  const currentValue =
    current && current.type === 'property'
      ? Number.parseInt(current.value, 10)
      : NaN;
  const wanted: Record<string, string> = {
    [NAMES.gradlePush]: String(options.push?.androidModule === true),
    [NAMES.gradleBilling]: String(options.billing),
    [MIN_SDK_PROPERTY]: String(
      Number.isFinite(currentValue) && currentValue > MIN_SDK
        ? currentValue
        : MIN_SDK
    ),
  };
  const next = items.filter(
    (item) => !(item.type === 'property' && item.key in wanted)
  );
  for (const [key, value] of Object.entries(wanted))
    next.push({ type: 'property', key, value });
  return next;
}

/** Selects a StoreKit configuration file in a scheme's LaunchAction (idempotent). */
export function addStoreKitConfigurationToScheme(
  xml: string,
  identifier: string
): string {
  const reference = `<StoreKitConfigurationFileReference\n         identifier = "${identifier}">\n      </StoreKitConfigurationFileReference>`;
  const existing =
    /<StoreKitConfigurationFileReference[\s\S]*?<\/StoreKitConfigurationFileReference>/;
  if (existing.test(xml)) return xml.replace(existing, reference);
  return xml.replace(
    /(<LaunchAction[\s\S]*?)(\n\s*<\/LaunchAction>)/,
    `$1\n      ${reference}$2`
  );
}
