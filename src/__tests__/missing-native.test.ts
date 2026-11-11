// Without the native module (Expo Go, or a build made before installing), debug builds must fail
// loudly instead of turning every call into a silent no-op.
jest.mock('../specs/NativePingfront', () => ({
  __esModule: true,
  default: null,
}));

import { configure, isPingFrontPush, openChat } from '../index';

describe('without the native module', () => {
  it('throws in debug builds with what to do', () => {
    expect(() => configure('pk_test_abcdefghijklmnopqrstuvvd')).toThrow(
      /native module is not in this build/
    );
    expect(() => openChat()).toThrow(/expo prebuild/);
  });

  it('pure helpers still work', () => {
    expect(isPingFrontPush({ pf_v: '1' })).toBe(true);
  });
});
