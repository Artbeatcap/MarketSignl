const path = require('path');

// Monorepo: ensure autolinking finds react-native-purchases (lives under apps/mobile
// or hoisted to root). android/settings.gradle runs Node from repo root; without this
// config the native module can be missed and NativeModules.RNPurchases stays null.
let purchasesRoot;
try {
  purchasesRoot = path.dirname(
    require.resolve('react-native-purchases/package.json', {
      paths: [__dirname, path.join(__dirname, 'apps', 'mobile')],
    })
  );
} catch {
  purchasesRoot = path.resolve(__dirname, 'node_modules', 'react-native-purchases');
}

module.exports = {
  dependencies: {
    'react-native-purchases': {
      root: purchasesRoot,
    },
  },
};
