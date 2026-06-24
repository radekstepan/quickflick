import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { readKv, writeKv } from './db';
import type { AppSettings, PlayerChoice, Theme } from '../shared/types';

const THEME_KEY = 'settings:theme';
const PLAYER_KEY = 'settings:defaultPlayer';
const CUSTOM_PLAYER_PATH_KEY = 'settings:defaultPlayerPath';

export const DEFAULT_SETTINGS: AppSettings = {
  theme: 'dark',
  defaultPlayer: 'system'
};

interface PlayerSpec {
  name: string;
  appPath: string;
  displayName: string;
}

export const KNOWN_PLAYERS: ReadonlyArray<PlayerSpec> = [
  {
    name: 'VLC',
    displayName: 'VLC',
    appPath: '/Applications/VLC.app'
  },
  {
    name: 'IINA',
    displayName: 'IINA',
    appPath: '/Applications/IINA.app'
  },
  {
    name: 'QuickTime Player',
    displayName: 'QuickTime',
    appPath: '/System/Applications/QuickTime Player.app'
  },
  {
    name: 'MPV',
    displayName: 'MPV',
    appPath: '/Applications/MPV.app'
  }
];

export { readKv, writeKv };

function readTheme(): Theme {
  const raw = readKv(THEME_KEY);
  return raw === 'light' || raw === 'dark' ? raw : DEFAULT_SETTINGS.theme;
}

function readPlayer(): PlayerChoice {
  const raw = readKv(PLAYER_KEY);
  if (!raw) return DEFAULT_SETTINGS.defaultPlayer;
  if (raw === 'system') return 'system';
  return raw;
}

function readCustomPlayerPath(): string | null {
  return readKv(CUSTOM_PLAYER_PATH_KEY);
}

export function getSettings(): AppSettings {
  const theme = readTheme();
  let defaultPlayer = readPlayer();
  if (defaultPlayer === 'system' && !readKv(PLAYER_KEY)) {
    const hasVlc = existsSync(
      KNOWN_PLAYERS.find((p) => p.name === 'VLC')!.appPath
    );
    if (hasVlc) {
      writeKv(PLAYER_KEY, 'VLC');
      defaultPlayer = 'VLC';
    }
  }
  return {
    theme,
    defaultPlayer
  };
}

export function getDefaultPlayerPath(): string | null {
  return readCustomPlayerPath();
}

export function setTheme(theme: Theme): void {
  writeKv(THEME_KEY, theme);
}

export function setDefaultPlayer(player: PlayerChoice, appPath?: string | null): void {
  writeKv(PLAYER_KEY, player);
  if (appPath) {
    writeKv(CUSTOM_PLAYER_PATH_KEY, appPath);
  } else if (player === 'system') {
    writeKv(CUSTOM_PLAYER_PATH_KEY, '');
  }
}

export function listInstalledPlayers(): string[] {
  const installed: string[] = [];
  for (const p of KNOWN_PLAYERS) {
    if (existsSync(p.appPath)) installed.push(p.name);
  }
  const custom = readCustomPlayerPath();
  if (custom && existsSync(custom)) {
    const customName = appDisplayNameForPath(custom) ?? basename(custom, '.app');
    if (customName && !installed.includes(customName)) installed.push(customName);
  }
  return installed;
}

export function listKnownPlayers(): string[] {
  const names = KNOWN_PLAYERS.map((p) => p.name);
  const custom = readCustomPlayerPath();
  if (custom) {
    const customName = appDisplayNameForPath(custom) ?? basename(custom, '.app');
    if (customName && !names.includes(customName)) names.push(customName);
  }
  return names;
}

function appDisplayNameForPath(appPath: string): string | null {
  const plist = join(appPath, 'Contents', 'Info.plist');
  if (!existsSync(plist)) return null;
  try {
    const raw = readFileSync(plist, 'utf8');
    const m = raw.match(/<key>CFBundleName<\/key>\s*<string>([^<]+)<\/string>/);
    return m ? m[1].trim() : null;
  } catch {
    return null;
  }
}

export interface LaunchResult {
  ok: boolean;
  error?: string;
  usedFallback: boolean;
}

export async function openWithPlayer(
  filePath: string,
  player: PlayerChoice
): Promise<LaunchResult> {
  if (player === 'system') {
    return launchWithOpen(filePath, null);
  }
  const custom = readCustomPlayerPath();
  if (custom && existsSync(custom)) {
    const customName = appDisplayNameForPath(custom) ?? basename(custom, '.app');
    if (customName === player) {
      return launchWithOpen(filePath, custom);
    }
  }
  const known = KNOWN_PLAYERS.find((p) => p.name === player);
  if (known) {
    if (!existsSync(known.appPath)) {
      const fallback = await launchWithOpen(filePath, null);
      return { ...fallback, usedFallback: true };
    }
    return launchWithOpen(filePath, known.appPath);
  }
  return launchWithOpen(filePath, null);
}

function launchWithOpen(
  filePath: string,
  appPath: string | null
): Promise<LaunchResult> {
  return new Promise((resolve) => {
    const args: string[] = [];
    if (appPath) args.push('-a', appPath);
    args.push(filePath);
    const child = spawn('open', args, { stdio: 'ignore', detached: true });
    child.on('error', (err) => {
      resolve({ ok: false, error: err.message, usedFallback: false });
    });
    child.on('exit', (code) => {
      if (code === 0) {
        resolve({ ok: true, usedFallback: false });
      } else {
        resolve({ ok: false, error: `open exited with code ${code}`, usedFallback: false });
      }
    });
    child.unref();
  });
}
