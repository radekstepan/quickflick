#!/usr/bin/env node
// Aborts installs/launches if the active Node.js doesn't match .nvmrc.
// Bypass with SKIP_NODE_CHECK=1 when you know what you're doing (e.g.
// running `node` via Electron's bundled runtime, which has a different ABI
// by design — see scripts/rebuild-native.cjs).

const { readFileSync, existsSync } = require('node:fs');
const { resolve } = require('node:path');

const root = resolve(__dirname, '..');
const nvmrcPath = resolve(root, '.nvmrc');

if (!existsSync(nvmrcPath)) {
  console.error('[check-node] .nvmrc not found at', nvmrcPath);
  process.exit(1);
}

const required = readFileSync(nvmrcPath, 'utf8').trim();
const current = process.versions.node;
const requiredMajor = required.split('.')[0];
const currentMajor = current.split('.')[0];

if (requiredMajor !== currentMajor) {
  console.error(
    `[check-node] Node version mismatch: .nvmrc wants ${required}, but running ${current}\n` +
    `[check-node] Fix: \`nvm install && nvm use\` (or just \`nvm use\` if already installed)\n` +
    `[check-node] Bypass only if you know what you're doing: SKIP_NODE_CHECK=1`
  );
  process.exit(1);
}

console.log(`[check-node] OK: node ${current} matches .nvmrc (${required})`);
