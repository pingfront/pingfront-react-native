import {
  addStoreKitConfigurationToScheme,
  applyAndroidManifest,
  applyEntitlements,
  applyGradleProperties,
  applyInfoPlist,
  resolveOptions,
} from '../apply';

const key = 'pk_test_abcdefghijklmnopqrstuvvd';

function manifest() {
  return {
    manifest: {
      'uses-permission': [
        { $: { 'android:name': 'android.permission.INTERNET' } },
      ],
      'application': [
        {
          '$': { 'android:name': '.MainApplication' },
          'meta-data': [] as unknown[],
        },
      ],
    },
  };
}
const mainApplication = (m: never) =>
  (m as ReturnType<typeof manifest>).manifest.application[0];

describe('resolveOptions', () => {
  it('rejects something that is not a public key at prebuild time', () => {
    expect(() => resolveOptions({ appKey: 'sk_live_123' })).toThrow(
      /not a public app key/
    );
    expect(() => resolveOptions({ appKey: key })).not.toThrow();
  });

  it('push: true means development APNs and the FCM module', () => {
    expect(resolveOptions({ push: true }).push).toEqual({
      iosEnvironment: 'development',
      androidModule: true,
    });
    expect(resolveOptions({}).push).toBeNull();
  });
});

describe('iOS', () => {
  it('writes the key and push background mode once', () => {
    const options = resolveOptions({ appKey: key, push: true });
    const once = applyInfoPlist({ UIBackgroundModes: ['audio'] }, options);
    const twice = applyInfoPlist(once, options);
    expect(twice).toEqual({
      PingFrontAppKey: key,
      UIBackgroundModes: ['audio', 'remote-notification'],
    });
  });

  it('adds aps-environment only with push', () => {
    expect(applyEntitlements({}, resolveOptions({}))).toEqual({});
    expect(
      applyEntitlements(
        {},
        resolveOptions({ push: { iosEnvironment: 'production' } })
      )
    ).toEqual({ 'aps-environment': 'production' });
  });

  it('selects a StoreKit file in the scheme, idempotently', () => {
    const scheme = `<Scheme>\n   <LaunchAction\n      buildConfiguration = "Debug">\n      <BuildableProductRunnable/>\n   </LaunchAction>\n</Scheme>`;
    const once = addStoreKitConfigurationToScheme(
      scheme,
      '../Products.storekit'
    );
    expect(once).toContain('identifier = "../Products.storekit"');
    expect(once.indexOf('StoreKitConfigurationFileReference')).toBeLessThan(
      once.indexOf('</LaunchAction>')
    );
    const twice = addStoreKitConfigurationToScheme(
      once,
      '../Products.storekit'
    );
    expect(twice.match(/<StoreKitConfigurationFileReference/g)).toHaveLength(1);
  });
});

describe('Android', () => {
  it('adds the manifest key and POST_NOTIFICATIONS, without duplicates', () => {
    const options = resolveOptions({ appKey: key, push: true });
    const result = applyAndroidManifest(
      applyAndroidManifest(manifest(), options, mainApplication),
      options,
      mainApplication
    );
    expect(
      result.manifest['uses-permission'].map((p) => p.$['android:name'])
    ).toEqual([
      'android.permission.INTERNET',
      'android.permission.POST_NOTIFICATIONS',
    ]);
    expect(result.manifest.application[0]!['meta-data']).toEqual([
      { $: { 'android:name': 'pingfront.app_key', 'android:value': key } },
    ]);
  });

  it('sets the module switches the library build reads', () => {
    const items = applyGradleProperties(
      [
        { type: 'property', key: 'pingfront.push', value: 'true' },
        { type: 'property', key: 'hermesEnabled', value: 'true' },
      ],
      resolveOptions({ billing: true, push: { androidModule: false } })
    );
    expect(items).toEqual([
      { type: 'property', key: 'hermesEnabled', value: 'true' },
      { type: 'property', key: 'pingfront.push', value: 'false' },
      { type: 'property', key: 'pingfront.billing', value: 'true' },
      { type: 'property', key: 'android.minSdkVersion', value: '26' },
    ]);
  });

  it('raises android.minSdkVersion to 26, and never lowers a higher one', () => {
    const minSdk = (
      items: Array<{ type: string; key?: string; value?: string }>
    ) => items.find((item) => item.key === 'android.minSdkVersion')?.value;
    const options = resolveOptions({});
    // expo-build-properties (or the template) wrote 24: the SDK needs 26.
    expect(
      minSdk(
        applyGradleProperties(
          [{ type: 'property', key: 'android.minSdkVersion', value: '24' }],
          options
        )
      )
    ).toBe('26');
    expect(
      minSdk(
        applyGradleProperties(
          [{ type: 'property', key: 'android.minSdkVersion', value: '28' }],
          options
        )
      )
    ).toBe('28');
    expect(minSdk(applyGradleProperties([], options))).toBe('26');
  });
});
