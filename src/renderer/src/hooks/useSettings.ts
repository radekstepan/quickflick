import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import {
  DEFAULT_ACCENT_COLOR,
  isAccentColor,
  variantsFor
} from '@shared/palette';
import type {
  AccentColor,
  AppSettings,
  PlayerChoice,
  PlayerList,
  SceneSampleRate,
  Theme
} from '@shared/types';

const THEME_STORAGE = 'qf:theme';
const PLAYER_STORAGE = 'qf:defaultPlayer';
const ACCENT_STORAGE = 'qf:accentColor';

function loadCachedTheme(): Theme | null {
  try {
    const raw = localStorage.getItem(THEME_STORAGE);
    if (raw === 'dark' || raw === 'light') return raw;
  } catch {
    // ignore
  }
  return null;
}

function loadCachedPlayer(): PlayerChoice | null {
  try {
    const raw = localStorage.getItem(PLAYER_STORAGE);
    if (raw === null) return null;
    if (raw === 'system' || raw.length > 0) return raw;
  } catch {
    // ignore
  }
  return null;
}

function loadCachedAccent(): AccentColor | null {
  try {
    const raw = localStorage.getItem(ACCENT_STORAGE);
    if (raw && isAccentColor(raw)) return raw;
  } catch {
    // ignore
  }
  return null;
}

function saveCachedTheme(theme: Theme): void {
  try {
    localStorage.setItem(THEME_STORAGE, theme);
  } catch {
    // ignore
  }
}

function saveCachedPlayer(player: PlayerChoice): void {
  try {
    localStorage.setItem(PLAYER_STORAGE, player);
  } catch {
    // ignore
  }
}

function saveCachedAccent(color: AccentColor): void {
  try {
    localStorage.setItem(ACCENT_STORAGE, color);
  } catch {
    // ignore
  }
}

export function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme;
  saveCachedTheme(theme);
}

const ACCENT_VARS: ReadonlyArray<[string, keyof ReturnType<typeof variantsFor>]> = [
  ['--accent', 'accent'],
  ['--accent-hover', 'accentHover'],
  ['--accent-soft', 'accentSoft'],
  ['--accent-glow', 'accentGlow'],
  ['--accent-glow-soft', 'accentGlowSoft'],
  ['--primary-shadow', 'primaryShadow']
];

export function applyAccentColor(color: AccentColor, theme: Theme): void {
  const variants = variantsFor(color, theme);
  const root = document.documentElement;
  for (const [name, key] of ACCENT_VARS) {
    root.style.setProperty(name, variants[key]);
  }
  saveCachedAccent(color);
}

export interface UseSettings {
  settings: AppSettings | null;
  players: PlayerList | null;
  setTheme: (next: Theme) => Promise<void>;
  setDefaultPlayer: (
    next: PlayerChoice,
    appPath?: string | null
  ) => Promise<void>;
  setAccentColor: (next: AccentColor) => Promise<void>;
  setSceneSampleRate: (next: SceneSampleRate) => Promise<void>;
  refreshPlayers: () => Promise<void>;
}

export function useSettings(): UseSettings {
  const cachedTheme = loadCachedTheme();
  const cachedPlayer = loadCachedPlayer();
  const cachedAccent = loadCachedAccent();
  const [settings, setSettings] = useState<AppSettings | null>(() => {
    if (cachedTheme || cachedPlayer || cachedAccent) {
      return {
        theme: cachedTheme ?? 'dark',
        defaultPlayer: cachedPlayer ?? 'system',
        accentColor: cachedAccent ?? DEFAULT_ACCENT_COLOR,
        sceneSampleRate: 'fast'
      };
    }
    return null;
  });
  const [players, setPlayers] = useState<PlayerList | null>(null);

  useEffect(() => {
    if (!settings) return;
    applyTheme(settings.theme);
    applyAccentColor(settings.accentColor, settings.theme);
  }, [settings?.theme, settings?.accentColor]);

  useEffect(() => {
    let mounted = true;
    void (async () => {
      try {
        const [s, p] = await Promise.all([api.getSettings(), api.listPlayers()]);
        if (!mounted) return;
        setSettings(s);
        setPlayers(p);
        applyTheme(s.theme);
        applyAccentColor(s.accentColor, s.theme);
        saveCachedPlayer(s.defaultPlayer);
      } catch (e) {
        console.error('Failed to load settings:', e);
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  const setThemeFn = useCallback(async (next: Theme) => {
    setSettings((prev) =>
      prev
        ? { ...prev, theme: next }
        : { theme: next, defaultPlayer: 'system', accentColor: DEFAULT_ACCENT_COLOR, sceneSampleRate: 'fast' }
    );
    applyTheme(next);
    try {
      await api.setTheme(next);
    } catch (e) {
      console.error('Failed to persist theme:', e);
    }
  }, []);

  const setDefaultPlayerFn = useCallback(
    async (next: PlayerChoice, appPath?: string | null) => {
      setSettings((prev) =>
        prev
          ? { ...prev, defaultPlayer: next }
          : { theme: 'dark', defaultPlayer: next, accentColor: DEFAULT_ACCENT_COLOR, sceneSampleRate: 'fast' }
      );
      saveCachedPlayer(next);
      try {
        await api.setDefaultPlayer(next, appPath);
      } catch (e) {
        console.error('Failed to persist player:', e);
      }
    },
    []
  );

  const setAccentColorFn = useCallback(async (next: AccentColor) => {
    setSettings((prev) =>
      prev
        ? { ...prev, accentColor: next }
        : { theme: 'dark', defaultPlayer: 'system', accentColor: next, sceneSampleRate: 'fast' }
    );
    const theme: Theme = (typeof document !== 'undefined'
      ? (document.documentElement.dataset.theme as Theme | undefined)
      : undefined) ?? 'dark';
    applyAccentColor(next, theme);
    try {
      await api.setAccentColor(next);
    } catch (e) {
      console.error('Failed to persist accent color:', e);
    }
  }, []);

  const setSceneSampleRateFn = useCallback(async (next: SceneSampleRate) => {
    setSettings((prev) =>
      prev
        ? { ...prev, sceneSampleRate: next }
        : { theme: 'dark', defaultPlayer: 'system', accentColor: DEFAULT_ACCENT_COLOR, sceneSampleRate: next }
    );
    try {
      await api.setSceneSampleRate(next);
    } catch (e) {
      console.error('Failed to persist scene sample rate:', e);
    }
  }, []);

  const refreshPlayers = useCallback(async () => {
    try {
      const p = await api.listPlayers();
      setPlayers(p);
    } catch (e) {
      console.error('Failed to list players:', e);
    }
  }, []);

  return {
    settings,
    players,
    setTheme: setThemeFn,
    setDefaultPlayer: setDefaultPlayerFn,
    setAccentColor: setAccentColorFn,
    setSceneSampleRate: setSceneSampleRateFn,
    refreshPlayers
  };
}
