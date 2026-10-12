#!/usr/bin/env node
// Restores better-sqlite3's native module for the SYSTEM node runtime
// (vitest). The app itself needs the Electron build instead — see
// rebuild-native.cjs, which `yarn dev` runs on every start.
//
// The two runtimes share one path
// (node_modules/better-sqlite3/build/Release/better_sqlite3.node), so flip
// it with the matching command and don't mix them in one session:
//   tests → yarn rebuild:node · app → yarn rebuild (or yarn dev)

const { spawnSync } = require('node:child_process');
const { existsSync } = require('node:fs');
const { join, resolve } = require('node:path');

const root = resolve(__dirname, '..');
const pkgDir = join(root, 'node_modules', 'better-sqlite3');
if (!existsSync(pkgDir)) {
  console.error('[rebuild-native-node] better-sqlite3 not found in node_modules');
  process.exit(1);
}
const cli = join(root, 'node_modules', '.bin', 'prebuild-install');
if (!existsSync(cli)) {
  console.error('[rebuild-native-node] prebuild-install not found in node_modules/.bin');
  process.exit(1);
}

const targetAbi = process.versions.modules;
const targetVersion = process.version; // e.g. v22.22.2 — prebuild-install derives the ABI from this
console.log(`[rebuild-native-node] installing node prebuild for ${targetVersion} (NODE_MODULE_VERSION ${targetAbi})`);
const r = spawnSync(cli, ['--runtime=node', `--target=${targetVersion}`, '--verbose'], {
  cwd: pkgDir,
  stdio: 'inherit'
});
if (r.status !== 0) {
  console.error('[rebuild-native-node] prebuild-install failed (exit ' + r.status + ')');
  process.exit(r.status ?? 1);
}

// Sanity check: the binary must load under this exact node.
try {
  require(join(pkgDir, 'build', 'Release', 'better_sqlite3.node'));
} catch (e) {
  console.error('[rebuild-native-node] binary does not load under the current node:');
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
}
console.log(`[rebuild-native-node] OK: node build loads (NODE_MODULE_VERSION ${targetAbi})`);
