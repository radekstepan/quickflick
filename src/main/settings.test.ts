// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

vi.mock('electron', () => ({
  app: {
    isPackaged: true,
    getPath: (_name: string) => process.env['QF_TEST_USER_DATA'] ?? '/tmp'
  }
}));

import { initDb, closeDb } from './db';
import {
  DEFAULT_SETTINGS,
  KNOWN_PLAYERS,
  getSettings,
  setTheme,
  setDefaultPlayer,
  readKv,
  writeKv,
  listInstalledPlayers,
  listKnownPlayers
} from './settings';

let dir: string;

beforeEach(() => {
  closeDb();
  dir = mkdtempSync(join(tmpdir(), 'qf-settings-'));
  process.env['QF_TEST_USER_DATA'] = dir;
  initDb({ dbPath: join(dir, 'cache.db'), thumbsDir: join(dir, 'thumbs') });
  writeKv('settings:defaultPlayer', '');
  writeKv('settings:defaultPlayerPath', '');
});

afterEach(() => {
  closeDb();
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    // ignore
  }
});

describe('settings storage', () => {
  it('returns theme=dark and player=system or VLC (auto-VLC) when nothing is stored', () => {
    const s = getSettings();
    expect(s.theme).toBe(DEFAULT_SETTINGS.theme);
    const vlcPath = KNOWN_PLAYERS.find((p) => p.name === 'VLC')!.appPath;
    const expectedPlayer = existsSync(vlcPath) ? 'VLC' : 'system';
    expect(s.defaultPlayer).toBe(expectedPlayer);
  });

  it('persists and reads theme', () => {
    setTheme('light');
    expect(getSettings().theme).toBe('light');
    setTheme('dark');
    expect(getSettings().theme).toBe('dark');
  });

  it('falls back to dark for unknown theme values', () => {
    writeKv('settings:theme', 'neon');
    expect(getSettings().theme).toBe('dark');
  });

  it('persists and reads defaultPlayer', () => {
    setDefaultPlayer('VLC');
    expect(getSettings().defaultPlayer).toBe('VLC');
    setDefaultPlayer('system');
    expect(getSettings().defaultPlayer).toBe('system');
  });

  it('clears custom player path when player is set to system', () => {
    setDefaultPlayer('IINA', '/Applications/IINA.app');
    expect(readKv('settings:defaultPlayerPath')).toBe('/Applications/IINA.app');
    setDefaultPlayer('system');
    expect(readKv('settings:defaultPlayerPath')).toBe('');
  });

  it('auto-defaults to VLC when VLC is installed and no player is set', () => {
    const vlcPath = KNOWN_PLAYERS.find((p) => p.name === 'VLC')!.appPath;
    const hasVlc = existsSync(vlcPath);
    if (!hasVlc) {
      return;
    }
    writeKv('settings:defaultPlayer', '');
    const s = getSettings();
    expect(s.defaultPlayer).toBe('VLC');
  });
});

describe('player detection', () => {
  it('returns installed subset of known players', () => {
    const installed = listInstalledPlayers();
    for (const name of installed) {
      expect(listKnownPlayers()).toContain(name);
    }
  });

  it('includes custom player name in known list when path is set', () => {
    setDefaultPlayer('MyCustomPlayer', '/Applications/MyCustomPlayer.app');
    const known = listKnownPlayers();
    expect(known).toContain('MyCustomPlayer');
  });
});
