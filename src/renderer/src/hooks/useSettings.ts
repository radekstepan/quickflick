import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import type { AppSettings, PlayerChoice, PlayerList, Theme } from '@shared/types';

const THEME_STORAGE = 'qf:theme';
const PLAYER_STORAGE = 'qf:defaultPlayer';

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

export function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme;
  saveCachedTheme(theme);
}

export interface UseSettings {
  settings: AppSettings | null;
  players: PlayerList | null;
  setTheme: (next: Theme) => Promise<void>;
  setDefaultPlayer: (
    next: PlayerChoice,
    appPath?: string | null
  ) => Promise<void>;
  refreshPlayers: () => Promise<void>;
}

export function useSettings(): UseSettings {
  const cachedTheme = loadCachedTheme();
  const cachedPlayer = loadCachedPlayer();
  const [settings, setSettings] = useState<AppSettings | null>(() => {
    if (cachedTheme || cachedPlayer) {
      return {
        theme: cachedTheme ?? 'dark',
        defaultPlayer: cachedPlayer ?? 'system'
      };
    }
    return null;
  });
  const [players, setPlayers] = useState<PlayerList | null>(null);

  useEffect(() => {
    if (settings) {
      applyTheme(settings.theme);
    }
  }, [settings?.theme]);

  useEffect(() => {
    let mounted = true;
    void (async () => {
      try {
        const [s, p] = await Promise.all([api.getSettings(), api.listPlayers()]);
        if (!mounted) return;
        setSettings(s);
        setPlayers(p);
        applyTheme(s.theme);
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
      prev ? { ...prev, theme: next } : { theme: next, defaultPlayer: 'system' }
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
        prev ? { ...prev, defaultPlayer: next } : { theme: 'dark', defaultPlayer: next }
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
    refreshPlayers
  };
}
