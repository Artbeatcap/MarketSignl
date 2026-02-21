#!/usr/bin/env node
/**
 * Monorepo bundle wrapper: run Expo CLI with cwd = apps/mobile and pass
 * apps/mobile as the project dir to export:embed so Metro uses the correct root.
 * Used by Gradle via react.cliFile so createBundleReleaseJsAndAssets runs from the right directory.
 */
const path = require("path");
const { spawnSync } = require("child_process");
const projectRoot = path.resolve(__dirname, "..");
const repoRoot = path.join(projectRoot, "..", "..");
const expoCli = path.join(repoRoot, "node_modules", "@expo", "cli", "build", "bin", "cli");
const argv = process.argv.slice(2);
process.chdir(projectRoot);
// Force Metro to use apps/mobile as server root (not monorepo root)
const env = { ...process.env, EXPO_NO_METRO_WORKSPACE_ROOT: "1", PWD: projectRoot, INIT_CWD: projectRoot };
const result = spawnSync(process.execPath, [expoCli, ...argv], {
  cwd: projectRoot,
  stdio: "inherit",
  env,
});
process.exit(result.status ?? 1);
