/**
 * withMonorepoConfig
 *
 * Fixes the React Native Gradle plugin's `react {}` block in app/build.gradle
 * so Metro/Expo CLI runs from apps/mobile (the actual Expo project root)
 * instead of the monorepo root.
 *
 * Without this, `gradlew bundleRelease` fails with:
 *   "Unable to resolve module ./../../node_modules/expo-router/entry.js"
 * because Metro's working directory is the repo root, not apps/mobile.
 *
 * This plugin replaces the default `react { ... }` block that Expo prebuild
 * generates with a monorepo-aware version.
 */
const { withAppBuildGradle } = require("expo/config-plugins");

// appRoot: from apps/mobile/android/app/build.gradle, ../../ = apps/mobile
const MONOREPO_REACT_BLOCK = `
// Monorepo: Expo app lives in apps/mobile; bundle and Metro must run from there.
def appRoot = file("../../")

react {
    root = appRoot

    // Use entry.js inside apps/mobile so Metro project root is apps/mobile (not repo root)
    entryFile = new File(appRoot, "entry.js")

    // Point to react-native resolved from apps/mobile
    reactNativeDir = new File(["node", "--print", "require.resolve('react-native/package.json')"].execute(null, appRoot).text.trim()).getParentFile().getAbsoluteFile()

    // Hermes compiler
    hermesCommand = new File(["node", "--print", "require.resolve('react-native/package.json')"].execute(null, appRoot).text.trim()).getParentFile().getAbsolutePath() + "/sdks/hermesc/%OS-BIN%/hermesc"

    // Codegen
    codegenDir = new File(["node", "--print", "require.resolve('@react-native/codegen/package.json', { paths: [require.resolve('react-native/package.json')] })"].execute(null, appRoot).text.trim()).getParentFile().getAbsoluteFile()

    // Use wrapper so Expo CLI runs with cwd=apps/mobile (Metro then resolves entry from app root)
    cliFile = new File(appRoot, "scripts/bundle-from-mobile.js")
    bundleCommand = "export:embed"

    /* Autolinking */
    autolinkLibrariesWithApp()
}`;

function withMonorepoConfig(config) {
  return withAppBuildGradle(config, (config) => {
    let buildGradle = config.modResults.contents;

    // Replace the existing react { ... } block.
    // Note: the default Expo/RN gradle block may contain `{ ... }` inside quoted JS strings
    // (e.g. require.resolve(..., { paths: ... })), so we should not try to "parse braces"
    // with a simplistic `[^}]` regex. Instead, match from `react {` through the known
    // `autolinkLibrariesWithApp()` call.
    const reactBlockRegex = /react\s*\{[\s\S]*?autolinkLibrariesWithApp\(\)\s*[\r\n]*\}/m;

    if (reactBlockRegex.test(buildGradle)) {
      buildGradle = buildGradle.replace(reactBlockRegex, MONOREPO_REACT_BLOCK.trim());
    } else {
      // If no react block found, insert before the android block
      buildGradle = buildGradle.replace(
        /^android\s*\{/m,
        `${MONOREPO_REACT_BLOCK.trim()}\n\nandroid {`
      );
    }

    // Also fix the native_modules.gradle apply at the bottom to use appRoot
    buildGradle = buildGradle.replace(
      /\.execute\(null,\s*rootDir\)\.text\.trim\(\)\),\s*"\.\.\/native_modules\.gradle"\)/,
      '.execute(null, file("../../")).text.trim()), "../native_modules.gradle")'
    );

    // Fix applyNativeModulesAppBuildGradle if it uses default settings
    if (!buildGradle.includes("applyNativeModulesAppBuildGradle(project, file")) {
      buildGradle = buildGradle.replace(
        /applyNativeModulesAppBuildGradle\(project\)/,
        'applyNativeModulesAppBuildGradle(project, file("../../"))'
      );
    }

    config.modResults.contents = buildGradle;
    return config;
  });
}

module.exports = withMonorepoConfig;
