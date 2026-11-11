// Every test file gets the native module from the Codegen spec replaced by a typed mock
// (src/__tests__/mockNative.ts), so a change to the spec that the mock does not follow fails tsc.
jest.mock('./src/specs/NativePingfront', () => {
  const { createMockNative } = jest.requireActual('./src/__tests__/mockNative');
  return { __esModule: true, default: createMockNative() };
});
