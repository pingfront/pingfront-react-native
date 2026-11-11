declare const __DEV__: boolean;

/**
 * What the bridge logs about an error your code threw (a handler, a log handler): the error itself in debug builds,
 * only its name in release builds, since an app's error message can carry personal data.
 */
export function describeError(error: unknown): unknown {
  if (__DEV__) return error;
  return error instanceof Error ? error.name : typeof error;
}
