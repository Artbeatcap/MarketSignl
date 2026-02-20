#!/usr/bin/env node
/**
 * Monorepo: ensure apps/mobile can resolve dependencies from root node_modules.
 * - If apps/mobile/node_modules is missing or empty, create a junction (Windows) or
 *   symlink (Unix) to the repo root node_modules so Metro and Gradle find deps.
 * Run from repo root: node scripts/ensure-mobile-node-modules.js
 */

const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');
const mobileDir = path.join(repoRoot, 'apps', 'mobile');
const mobileNodeModules = path.join(mobileDir, 'node_modules');
const rootNodeModules = path.join(repoRoot, 'node_modules');

if (!fs.existsSync(rootNodeModules)) {
  console.warn('ensure-mobile-node-modules: root node_modules not found. Run npm install from repo root.');
  process.exit(0);
}

function needsLink() {
  if (!fs.existsSync(mobileNodeModules)) return true;
  try {
    const entries = fs.readdirSync(mobileNodeModules);
    return entries.length === 0;
  } catch {
    return true;
  }
}

if (!needsLink()) {
  console.log('ensure-mobile-node-modules: apps/mobile/node_modules already present.');
  process.exit(0);
}

// Remove empty or missing dir so we can create link
try {
  if (fs.existsSync(mobileNodeModules)) {
    fs.rmdirSync(mobileNodeModules, { recursive: true });
  }
} catch (e) {
  console.error('ensure-mobile-node-modules: could not remove existing apps/mobile/node_modules', e.message);
  process.exit(1);
}

try {
  if (process.platform === 'win32') {
    // Directory junction works without admin on Windows
    fs.symlinkSync(rootNodeModules, mobileNodeModules, 'junction');
  } else {
    fs.symlinkSync(rootNodeModules, mobileNodeModules, 'dir');
  }
  console.log('ensure-mobile-node-modules: linked apps/mobile/node_modules -> root node_modules');
} catch (e) {
  console.error('ensure-mobile-node-modules: failed to create link:', e.message);
  console.error('From repo root run: npm install (and ensure apps/mobile has no conflicting node_modules).');
  process.exit(1);
}
