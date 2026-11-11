import {
  AndroidConfig,
  createRunOncePlugin,
  withAndroidManifest,
  withDangerousMod,
  withEntitlementsPlist,
  withGradleProperties,
  withInfoPlist,
  type ConfigPlugin,
} from '@expo/config-plugins';
import fs from 'node:fs';
import path from 'node:path';
import {
  applyAndroidManifest,
  applyEntitlements,
  applyGradleProperties,
  applyInfoPlist,
  addStoreKitConfigurationToScheme,
  resolveOptions,
  type PingfrontPluginOptions,
} from './apply';

export type { PingfrontPluginOptions } from './apply';

// The package name, read from package.json so the project-wide rename has one place less to edit.

const pkg = require('../../package.json') as { name: string; version: string };

/**
 * Sets up a prebuilt Expo app (development build; not Expo Go) for the native SDKs:
 *
 * - `appKey`: `PingFrontAppKey` in Info.plist and `pingfront.app_key` in the Android manifest, so
 *   `configure(null)` reads it.
 * - `push`: the iOS `aps-environment` entitlement and, on Android, `POST_NOTIFICATIONS` plus the
 *   `pingfront-push` (FCM) module. Set `push: { androidModule: false }` when another library
 *   (expo-notifications, React Native Firebase) owns FCM; then forward tokens and payloads from JS.
 * - `billing`: the Android `pingfront-billing` module (Google Play Billing, In-App Review).
 * - `storeKitConfigFile`: copies a `.storekit` file into the iOS project and selects it in the
 *   scheme, for local StoreKit testing. StoreKit itself needs no entitlement.
 */
const withPingfront: ConfigPlugin<PingfrontPluginOptions | void> = (
  config,
  raw
) => {
  const options = resolveOptions(raw ?? {});

  config = withInfoPlist(config, (mod) => {
    mod.modResults = applyInfoPlist(mod.modResults, options);
    return mod;
  });

  config = withEntitlementsPlist(config, (mod) => {
    mod.modResults = applyEntitlements(mod.modResults, options);
    return mod;
  });

  config = withAndroidManifest(config, (mod) => {
    mod.modResults = applyAndroidManifest(
      mod.modResults,
      options,
      AndroidConfig.Manifest.getMainApplicationOrThrow
    );
    return mod;
  });

  config = withGradleProperties(config, (mod) => {
    mod.modResults = applyGradleProperties(mod.modResults, options);
    return mod;
  });

  const storeKitFile = options.storeKitConfigFile;
  if (storeKitFile) {
    config = withDangerousMod(config, [
      'ios',
      async (mod) => {
        const projectRoot = mod.modRequest.projectRoot;
        const iosRoot = mod.modRequest.platformProjectRoot;
        const source = path.resolve(projectRoot, storeKitFile);
        if (!fs.existsSync(source)) {
          throw new Error(
            `${pkg.name}: storeKitConfigFile ${storeKitFile} does not exist (resolved to ${source}).`
          );
        }
        const fileName = path.basename(source);
        fs.copyFileSync(source, path.join(iosRoot, fileName));
        const projectName = mod.modRequest.projectName ?? '';
        const scheme = path.join(
          iosRoot,
          `${projectName}.xcodeproj`,
          'xcshareddata',
          'xcschemes',
          `${projectName}.xcscheme`
        );
        if (fs.existsSync(scheme)) {
          const xml = fs.readFileSync(scheme, 'utf8');
          fs.writeFileSync(
            scheme,
            addStoreKitConfigurationToScheme(xml, `../${fileName}`)
          );
        }
        return mod;
      },
    ]);
  }

  return config;
};

export default createRunOncePlugin(withPingfront, pkg.name, pkg.version);
