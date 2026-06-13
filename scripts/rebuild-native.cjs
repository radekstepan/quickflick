#!/usr/bin/env node
// Re-installs better-sqlite3's native module for the Electron runtime.
// Needed because pnpm 11 + system Node ABI doesn't produce the right binary
// for Electron on a no-op `pnpm install`.

const { spawnSync } = require('node:child_process');
const { readdirSync, statSync, existsSync, readFileSync } = require('node:fs');
const { join, resolve } = require('node:path');

const root = resolve(__dirname, '..');

function findPnpmSubdir(pattern) {
  const pnpmRoot = join(root, 'node_modules', '.pnpm');
  if (!existsSync(pnpmRoot)) return null;
  for (const entry of readdirSync(pnpmRoot)) {
    if (pattern.test(entry)) return join(pnpmRoot, entry);
  }
  return null;
}

// 1) Find the installed Electron version from its package.json
const electronDir = findPnpmSubdir(/^electron@/);
if (!electronDir) {
  console.error('[rebuild-native] electron not found in node_modules');
  process.exit(1);
}
const electronPkg = JSON.parse(
  readFileSync(join(electronDir, 'node_modules', 'electron', 'package.json'), 'utf8')
);
const electronVersion = electronPkg.version;
console.log('[rebuild-native] electron version:', electronVersion);

// 2) Find the better-sqlite3 package
const bsqlDir = findPnpmSubdir(/^better-sqlite3@/);
if (!bsqlDir) {
  console.error('[rebuild-native] better-sqlite3 not found in node_modules');
  process.exit(1);
}
const pkgDir = join(bsqlDir, 'node_modules', 'better-sqlite3');
const cli = join(pkgDir, 'node_modules', '.bin', 'prebuild-install');
if (!existsSync(cli)) {
  console.error('[rebuild-native] prebuild-install not found at', cli);
  process.exit(1);
}

// 3) Run prebuild-install for the matching Electron ABI
console.log('[rebuild-native] running prebuild-install for electron@' + electronVersion);
const r = spawnSync(cli, ['-r', 'electron', '-t', electronVersion, '--verbose'], {
  cwd: pkgDir,
  stdio: 'inherit'
});
if (r.status !== 0) {
  console.error('[rebuild-native] prebuild-install failed (exit ' + r.status + ')');
  process.exit(r.status ?? 1);
}

// 4) Sanity check the binary
const binary = join(pkgDir, 'build', 'Release', 'better_sqlite3.node');
if (!existsSync(binary)) {
  console.error('[rebuild-native] expected binary missing at', binary);
  process.exit(1);
}
const size = statSync(binary).size;
console.log(`[rebuild-native] OK: ${binary} (${size} bytes)`);
