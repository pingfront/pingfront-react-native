#!/usr/bin/env node
// The bridge's Android gate: compiles the bridge's Kotlin (android/src) inside the example app. Jest never compiles
// it, so a change to the SDK's API or to the bridge fails here instead of in an app. With a local checkout of the
// Android SDK (PINGFRONT_ANDROID_SDK, or an `android` folder next to this package) it first publishes that checkout
// to .maven, as `android:sdk` does, and compiles against it; without one, against the release on Maven Central.
//
// Gradle runs with every warning shown, and the gate fails on any Gradle deprecation or Kotlin warning in this
// package's own Android code (android/). Third-party libraries the example uses (react-native-safe-area-context) still
// use deprecated Gradle syntax; they are reported, not held to this package's standard.
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { androidSdk, publishAndroidSdk } from './publish-android-sdk.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const sdk = androidSdk();
if (sdk) publishAndroidSdk(sdk);
else console.log('No Android SDK checkout: compiling against Maven Central.');
const example = path.join(root, 'example', 'android');
let output;
try {
  output = execFileSync(
    path.join(example, 'gradlew'),
    [
      '-p',
      example,
      ':pingfront_react-native:compileDebugKotlin',
      ':app:compileDebugKotlin',
      '--console=plain',
      '--warning-mode=all',
    ],
    {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      maxBuffer: 64 * 1024 * 1024,
    }
  );
} catch (error) {
  process.stdout.write(String(error.stdout ?? ''));
  process.stderr.write(String(error.stderr ?? ''));
  process.exit(1);
}
process.stdout.write(output);
const ours = path.join(root, 'android') + path.sep;
const lines = output.split('\n');
const problems = lines.filter(
  (line, index) =>
    // Kotlin warnings (`w: file:///…`) and Gradle deprecations ("Build file '…' line N" followed by the deprecation).
    (line.startsWith('w: ') && line.includes(ours)) ||
    (line.startsWith("Build file '") &&
      line.includes(ours) &&
      /deprecat/i.test(lines[index + 1] ?? ''))
);
if (problems.length > 0) {
  console.error(
    `\nWarnings in this package's Android code:\n${problems.join('\n')}`
  );
  process.exit(1);
}
const thirdParty = lines.filter(
  (line) => line.startsWith("Build file '") && !line.includes(ours)
).length;
console.log(
  `The bridge Kotlin compiles against the ${sdk ? 'local' : 'Maven Central'} SDK, with no warnings in android/` +
    (thirdParty
      ? ` (${thirdParty} Gradle deprecations in third-party example libraries).`
      : '.')
);
