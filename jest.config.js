/** @type {import('jest').Config} */
module.exports = {
  preset: '@react-native/jest-preset',
  roots: ['<rootDir>/src', '<rootDir>/plugin'],
  testMatch: ['**/__tests__/**/*.test.ts?(x)'],
  modulePathIgnorePatterns: ['<rootDir>/example/', '<rootDir>/lib/', '<rootDir>/plugin/build/'],
  // pnpm keeps packages under node_modules/.pnpm/<name>@<version>/node_modules/<name>, so the
  // preset's pattern needs the extra segment to still transform React Native's own ESM.
  transformIgnorePatterns: [
    'node_modules/(?!(\\.pnpm/[^/]+/node_modules/)?((jest-)?react-native|@react-native(-community)?|@testing-library)/)',
  ],
  setupFiles: ['<rootDir>/jest.setup.ts'],
};
