const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

// Monorepo: app is in apps/mobile, dependencies are hoisted to repo root
const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(projectRoot);

// 1. Watch all files in the monorepo so Metro sees changes in packages/*
// Merge with Expo's default watchFolders so expo-doctor passes
const defaultWatchFolders = config.watchFolders || [];
config.watchFolders = [...defaultWatchFolders, workspaceRoot];

// 2. Resolve node_modules from repo root FIRST (hoisted deps), then apps/mobile
//    Critical for Android release build so the JS bundle can be created
config.resolver.nodeModulesPaths = [
  path.resolve(workspaceRoot, 'node_modules'),
  path.resolve(projectRoot, 'node_modules'),
];

// 3. Explicitly map packages Metro may fail to resolve from apps/mobile (monorepo)
config.resolver.extraNodeModules = {
  '@chartsignl/core': path.resolve(workspaceRoot, 'packages/core/src'),
  'expo-constants': path.resolve(workspaceRoot, 'node_modules/expo-constants'),
  'expo-asset': path.resolve(workspaceRoot, 'node_modules/expo-asset'),
  'expo-font': path.resolve(workspaceRoot, 'node_modules/expo-font'),
};

module.exports = config;
