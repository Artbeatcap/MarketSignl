const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const projectRoot = __dirname;
const repoRoot = path.resolve(projectRoot, '../..');
const config = getDefaultConfig(projectRoot);

// Ensure Metro can resolve workspace packages (e.g. @chartsignl/core) even when
// Expo Router sets a different "root directory" for its resolver.
config.resolver.extraNodeModules = [
  path.join(projectRoot, 'node_modules'),
  path.join(repoRoot, 'node_modules'),
];

// Let Metro crawl the shared workspace for bundling/codegen.
config.watchFolders = [
  ...(config.watchFolders ?? []),
  path.join(repoRoot, 'packages'),
];

// Zustand's ESM bundle uses import.meta, which Metro doesn't support on web.
// Force resolution to CommonJS entry so the bundle doesn't contain import.meta.
const defaultResolve = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName === 'zustand' || moduleName.startsWith('zustand/')) {
    return { type: 'sourceFile', filePath: require.resolve(moduleName) };
  }
  return defaultResolve
    ? defaultResolve(context, moduleName, platform)
    : context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
