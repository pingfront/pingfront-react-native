#!/usr/bin/env node
// Builds a local checkout of the pingfront Android SDK (github.com/pingfront/pingfront-android) and publishes it to
// .maven (gitignored), which the example's Gradle build reads before Maven Central. Without it, the example and
// apps that install the package from npm get the same artifacts from Maven Central.
//
// The checkout is PINGFRONT_ANDROID_SDK, or an `android` folder next to this package.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const repo = path.join(root, '.maven');

/** The Android SDK checkout to build, or null when there is none. */
export function androidSdk() {
  const sdk = process.env.PINGFRONT_ANDROID_SDK
    ? path.resolve(process.env.PINGFRONT_ANDROID_SDK)
    : path.resolve(root, '..', 'android');
  return fs.existsSync(path.join(sdk, 'gradlew')) ? sdk : null;
}

export function publishAndroidSdk(sdk) {
  execFileSync(
    path.join(sdk, 'gradlew'),
    [
      '-p',
      sdk,
      '-I',
      path.join(here, 'publish-android-sdk.gradle'),
      `-PpingfrontMavenRepo=${repo}`,
      '-Ppingfront.version=1.0.0',
      'publishPingfrontForReactNative',
      '--console=plain',
    ],
    { stdio: 'inherit' }
  );
  console.log(`Published sh.pingfront:* 1.0.0 from ${sdk} to ${repo}`);
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const sdk = androidSdk();
  if (!sdk) {
    console.error(
      'No Android SDK checkout: clone github.com/pingfront/pingfront-android and set PINGFRONT_ANDROID_SDK to it.'
    );
    process.exit(1);
  }
  publishAndroidSdk(sdk);
}
