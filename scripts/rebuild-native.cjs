#!/usr/bin/env node
// Re-installs better-sqlite3's native module for the Electron runtime.
// Layout-agnostic: handles pnpm's .pnpm/ store, yarn's flat node_modules, and npm.

const { spawnSync } = require('node:child_process');
const { readdirSync, statSync, existsSync, readFileSync } = require('node:fs');
const { join, resolve } = require('node:path');

const root = resolve(__dirname, '..');

function findPackageDir(pkgName) {
  // pnpm store layout: node_modules/.pnpm/<pkg>@<ver>/node_modules/<pkg>
  const pnpmRoot = join(root, 'node_modules', '.pnpm');
  if (existsSync(pnpmRoot)) {
    for (const entry of readdirSync(pnpmRoot)) {
      if (entry.startsWith(pkgName + '@')) {
        return join(pnpmRoot, entry, 'node_modules', pkgName);
      }
    }
  }
  // yarn / npm flat layout: node_modules/<pkg>
  const flat = join(root, 'node_modules', pkgName);
  if (existsSync(flat)) return flat;
  return null;
}

function findPrebuildInstall(pkgDir) {
  // pnpm puts prebuild-install in <pkg>/node_modules/.bin (per-package dep)
  const nestedBin = join(pkgDir, 'node_modules', '.bin', 'prebuild-install');
  if (existsSync(nestedBin)) return nestedBin;
  // yarn/npm hoist to top-level node_modules/.bin
  const topBin = join(root, 'node_modules', '.bin', 'prebuild-install');
  if (existsSync(topBin)) return topBin;
  return null;
}

function readPackageJson(pkgDir) {
  return JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8'));
}

// 1) Find the installed Electron version
const electronDir = findPackageDir('electron');
if (!electronDir) {
  console.error('[rebuild-native] electron not found in node_modules');
  process.exit(1);
}
const electronVersion = readPackageJson(electronDir).version;
console.log('[rebuild-native] electron version:', electronVersion);

// 2) Find the better-sqlite3 package
const pkgDir = findPackageDir('better-sqlite3');
if (!pkgDir) {
  console.error('[rebuild-native] better-sqlite3 not found in node_modules');
  process.exit(1);
}

const cli = findPrebuildInstall(pkgDir);
if (!cli) {
  console.error('[rebuild-native] prebuild-install not found (tried nested and top-level)');
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
