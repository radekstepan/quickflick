#!/usr/bin/env node
// Installs better-sqlite3's native module for the Electron runtime.
// Layout-agnostic: handles pnpm's .pnpm/ store, yarn's flat node_modules, and npm.
// Runs automatically via dev/build/start/preview. Skips the install when the
// current binary already loads under the target Electron runtime.

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

// Skip the install when the current binary already loads under the target
// Electron runtime. Honors SKIP_ABI_CHECK=1 by always reinstalling.
const binary = join(pkgDir, 'build', 'Release', 'better_sqlite3.node');
if (process.env.SKIP_ABI_CHECK !== '1' && existsSync(binary)) {
  const currentElectronBin = findElectronBinary(electronDir);
  if (currentElectronBin) {
    const pre = probeBinary(currentElectronBin, binary);
    if (pre.status === 0) {
      console.log(`[rebuild-native] OK: binary already loads under electron@${electronVersion} — skipping install`);
      process.exit(0);
    }
    console.log('[rebuild-native] current binary does not load under electron; reinstalling…');
  }
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
if (!existsSync(binary)) {
  console.error('[rebuild-native] expected binary missing at', binary);
  process.exit(1);
}
const size = statSync(binary).size;
console.log(`[rebuild-native] OK: ${binary} (${size} bytes)`);

// 5) Verify the binary actually loads under the target Electron Node ABI.
//    prebuild-install targets a specific ABI; a wrong one (or a stale build
//    done with the system node) silently produces a binary that crashes at
//    load with "NODE_MODULE_VERSION mismatch". Catch that here.
function findElectronBinary(electronPkgDir) {
  const candidates = [
    // macOS .app bundle
    join(electronPkgDir, 'dist', 'Electron.app', 'Contents', 'MacOS', 'Electron'),
    // Linux
    join(electronPkgDir, 'dist', 'electron'),
    // Windows
    join(electronPkgDir, 'dist', 'electron.exe'),
  ];
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  return null;
}

function probeBinary(electronBin, binary) {
  return spawnSync(
    electronBin,
    ['-e', `require(${JSON.stringify(binary)}); console.log('loaded OK')`],
    {
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
      encoding: 'utf8',
    }
  );
}

const electronBin = findElectronBinary(electronDir);
if (!electronBin) {
  console.warn(`[rebuild-native] could not locate electron binary in ${electronDir}; skipping ABI verification`);
} else {
  const abiProbe = spawnSync(electronBin, ['-p', 'process.versions.modules'], {
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    encoding: 'utf8',
  });
  if (abiProbe.status !== 0) {
    console.error('[rebuild-native] failed to probe electron ABI:');
    console.error(abiProbe.stderr);
    process.exit(abiProbe.status ?? 1);
  }
  const expectedAbi = abiProbe.stdout.trim();
  console.log(`[rebuild-native] electron@${electronVersion} expects NODE_MODULE_VERSION ${expectedAbi}`);

  if (process.env.SKIP_ABI_CHECK === '1') {
    console.warn('[rebuild-native] SKIP_ABI_CHECK=1, skipping load verification');
  } else {
    const loadProbe = probeBinary(electronBin, binary);
    if (loadProbe.status !== 0) {
      console.error(
        `[rebuild-native] ABI mismatch: ${binary} does not load under electron@${electronVersion}\n` +
        `[rebuild-native] expected NODE_MODULE_VERSION ${expectedAbi}, got load error:\n` +
        loadProbe.stderr
      );
      process.exit(loadProbe.status ?? 1);
    }
    console.log(`[rebuild-native] ABI verified: ${binary} loads under electron@${electronVersion} (NODE_MODULE_VERSION ${expectedAbi})`);
  }
}
