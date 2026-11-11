/**
 * Every product-name string the JavaScript layer uses, in one place, so the project-wide rename
 * (pingfront -> pingfront) touches one file here.
 *
 * Two names cannot live here because tools read them as literals:
 * - the Turbo Module name in `specs/NativePingfront.ts` (Codegen needs a string literal), which must
 *   equal `NATIVE_MODULE_NAME`; a test checks they match;
 * - the package name and Codegen config in `package.json`.
 */
const PRODUCT_NAME = 'pingfront';

/** The npm package name, for error messages that tell people what to install. */
export const PACKAGE_NAME = '@pingfront/react-native';

/** The Turbo Module name registered by the iOS and Android code. */
export const NATIVE_MODULE_NAME = 'Pingfront';

/** The docs page for this SDK. */
export const DOCS_URL = 'https://pingfront.sh/docs/react-native';

/** Prefix of every log line and error message from this package. */
export const LOG_PREFIX = `[${PRODUCT_NAME}]`;

/** The APNs payload key that holds the pingfront object (`ApnsPayload` in the protocol). */
export const APNS_PAYLOAD_KEY = 'pingfront';

/** The FCM data key that marks a pingfront payload (`FcmData`: `pf_*` keys). */
export const FCM_VERSION_KEY = 'pf_v';

/** The version of this package (`version` export). */
export const SDK_VERSION = '1.0.0';
