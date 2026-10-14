#!/usr/bin/env node
// Wrapper around `electron-vite dev` so `yarn dev --demo` boots the app with
// a fake in-memory library (placeholder posters, famous movie titles, demo
// tags) instead of the real on-disk database.
//
// Yarn 4 appends extra args to the END of the script command, so
// `yarn dev --demo` arrives here as `node scripts/dev.cjs --demo`.
// The flag is forwarded to Electron via ELECTRON_CLI_ARGS (which
// electron-vite appends to the spawned Electron argv) and mirrored as the
// QF_DEMO env var so the main process can detect demo mode even if argv
// parsing ever changes. All other args pass through to electron-vite.

const { spawn } = require('node:child_process');
const { resolve } = require('node:path');

const root = resolve(__dirname, '..');

const incoming = process.argv.slice(2);
const demo = incoming.includes('--demo');
const passthrough = incoming.filter((a) => a !== '--demo');

const env = { ...process.env };
if (demo) {
  env.QF_DEMO = '1';
  env.ELECTRON_CLI_ARGS = JSON.stringify(['--demo']);
}

const cli = resolve(root, 'node_modules', 'electron-vite', 'bin', 'electron-vite.js');

const child = spawn(process.execPath, [cli, 'dev', ...passthrough], {
  stdio: 'inherit',
  env,
  cwd: root
});

child.on('close', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 0);
});
child.on('error', (err) => {
  console.error('[dev] failed to start electron-vite:', err.message);
  process.exit(1);
});
