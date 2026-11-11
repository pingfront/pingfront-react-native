const fs = require('fs');
const path = require('path');
const { getDefaultConfig, mergeConfig } = require('@react-native/metro-config');

// The example runs the library from source (../src), exactly as an app would get it from npm,
// with one copy of react and react-native: the example's own.
const root = path.resolve(__dirname, '..');
const pkg = require('../package.json');
// src/config.local.ts (gitignored), when it exists, stands in for src/config.ts: your own key or API URL without
// changing a tracked file.
const localConfig = path.join(__dirname, 'src', 'config.local.ts');
const escape = (p) => p.replace(/[/\\]/g, '[/\\\\]').replace(/\./g, '\\.');

/** @type {import('@react-native/metro-config').MetroConfig} */
const metroConfig = {
  watchFolders: [root],
  resolver: {
    nodeModulesPaths: [path.resolve(__dirname, 'node_modules')],
    disableHierarchicalLookup: true,
    blockList: [
      new RegExp(`^${escape(path.join(root, 'node_modules'))}[/\\\\].*$`),
      new RegExp(`^${escape(path.join(root, 'lib'))}[/\\\\].*$`),
      new RegExp(`^${escape(path.join(__dirname, 'ios'))}[/\\\\].*$`),
      new RegExp(`^${escape(path.join(__dirname, 'android'))}[/\\\\].*$`),
    ],
    resolveRequest: (context, moduleName, platform) => {
      if (
        moduleName === './config' &&
        path.dirname(context.originModulePath) ===
          path.join(__dirname, 'src') &&
        fs.existsSync(localConfig)
      ) {
        return { type: 'sourceFile', filePath: localConfig };
      }
      if (moduleName === pkg.name) {
        return {
          type: 'sourceFile',
          filePath: path.join(root, 'src', 'index.ts'),
        };
      }
      return context.resolveRequest(context, moduleName, platform);
    },
  },
};

module.exports = mergeConfig(getDefaultConfig(__dirname), metroConfig);
