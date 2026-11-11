import NativePingfront, { type Spec } from './specs/NativePingfront';
import { DOCS_URL, LOG_PREFIX, PACKAGE_NAME } from './constants';

declare const __DEV__: boolean;

const missingMessage =
  `${LOG_PREFIX} The native module is not in this build. Rebuild the app after installing ` +
  `${PACKAGE_NAME} (iOS: pod install; Expo: npx expo prebuild, a development build, not Expo Go). ` +
  `See ${DOCS_URL}#if-it-doesnt-work`;

let warned = false;

/** The native module, or null when the app was built without it. */
export function nativeModule(): Spec | null {
  return NativePingfront ?? null;
}

/**
 * The native module for a call. Without it, debug builds throw (a missing native module is a setup
 * mistake that must not fail silently) and release builds warn once and skip the call.
 */
export function requireNative(): Spec | null {
  const module = NativePingfront ?? null;
  if (module) return module;
  if (__DEV__) throw new Error(missingMessage);
  if (!warned) {
    warned = true;
    console.warn(missingMessage);
  }
  return null;
}
