const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

// Project root is where this file is
const projectRoot = __dirname;

// Point to the mobile app
const workspaceRoot = path.resolve(projectRoot, 'apps/mobile');

const config = getDefaultConfig(workspaceRoot);

// Tell Metro where to find the mobile app's source
config.projectRoot = workspaceRoot;
config.watchFolders = [projectRoot];

// Monorepo: resolve from repo root node_modules first (hoisted deps), then apps/mobile
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];

module.exports = config;
