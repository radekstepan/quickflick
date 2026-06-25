import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { api } from '../api';
import { ACCENT_COLOR_IDS, ACCENT_COLORS } from '@shared/palette';
import type {
  AccentColor,
  AppSettings,
  PlayerChoice,
  PlayerList
} from '@shared/types';

interface Props {
  settings: AppSettings;
  players: PlayerList;
  onClose: () => void;
  onSetDefaultPlayer: (
    player: PlayerChoice,
    appPath?: string | null
  ) => void;
  onSetAccentColor: (color: AccentColor) => void;
  onPlayersChanged: () => void;
}

interface PlayerOption {
  value: PlayerChoice;
  label: string;
  hint?: string;
  disabled?: boolean;
  tag?: string;
}

const SYSTEM_OPTION: PlayerOption = {
  value: 'system',
  label: 'System default (macOS)'
};

const KNOWN_OPTIONS: PlayerOption[] = [
  { value: 'VLC', label: 'VLC' },
  { value: 'IINA', label: 'IINA' },
  { value: 'QuickTime Player', label: 'QuickTime' },
  { value: 'MPV', label: 'MPV' }
];

export function SettingsModal({
  settings,
  players,
  onClose,
  onSetDefaultPlayer,
  onSetAccentColor,
  onPlayersChanged
}: Props) {
  const [playerOpen, setPlayerOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (playerOpen) setPlayerOpen(false);
        else onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, playerOpen]);

  useEffect(() => {
    if (!playerOpen) return;
    const onDown = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && target.closest('.settings-player-dropdown')) return;
      setPlayerOpen(false);
    };
    window.addEventListener('mousedown', onDown);
    return () => window.removeEventListener('mousedown', onDown);
  }, [playerOpen]);

  const allOptions: PlayerOption[] = useMemo(() => {
    const installed = new Set(players.installed);
    const known = new Set(players.known);
    const out: PlayerOption[] = [SYSTEM_OPTION];
    for (const opt of KNOWN_OPTIONS) {
      const isInstalled = installed.has(opt.value);
      out.push({
        ...opt,
        hint: isInstalled ? undefined : 'not installed',
        disabled: !isInstalled && opt.value === settings.defaultPlayer
      });
    }
    for (const name of players.known) {
      if (KNOWN_OPTIONS.some((o) => o.value === name)) continue;
      out.push({ value: name, label: name, tag: 'Custom' });
    }
    return out;
  }, [players, settings.defaultPlayer]);

  const currentOption =
    allOptions.find((o) => o.value === settings.defaultPlayer) ?? SYSTEM_OPTION;

  const selectPlayer = async (opt: PlayerOption) => {
    if (opt.value === '__pick') {
      setPlayerOpen(false);
      const picked = await api.pickApp();
      if (picked) {
        onSetDefaultPlayer(picked.name, picked.path);
        onPlayersChanged();
      }
      return;
    }
    if (opt.disabled) return;
    setPlayerOpen(false);
    onSetDefaultPlayer(opt.value);
  };

  const resetDefaults = () => {
    onSetDefaultPlayer('system', null);
    onSetAccentColor('red');
  };

  return createPortal(
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal"
        onClick={(e) => e.stopPropagation()}
        style={{ width: 480 }}
      >
        <div className="modal-header">
          <h2>Settings</h2>
          <button
            type="button"
            className="modal-close"
            onClick={onClose}
            aria-label="Close"
          >
            ×
          </button>
        </div>

        <div className="settings-section">
          <div className="settings-section-label">Default player</div>
          <div className="settings-player-dropdown" ref={wrapRef}>
            <button
              type="button"
              className="settings-player-button"
              onClick={() => setPlayerOpen((v) => !v)}
              aria-haspopup="listbox"
              aria-expanded={playerOpen}
            >
              <span>{currentOption.label}</span>
              <span className="chevron" aria-hidden="true">▾</span>
            </button>
            {playerOpen ? (
              <div className="settings-player-menu" role="listbox">
                {allOptions.map((opt) => {
                  const isActive = opt.value === settings.defaultPlayer;
                  return (
                    <button
                      type="button"
                      key={opt.value}
                      role="option"
                      aria-selected={isActive}
                      className={`settings-player-option${
                        isActive ? ' active' : ''
                      }${opt.disabled ? ' disabled' : ''}`}
                      onClick={() => selectPlayer(opt)}
                      title={opt.hint ? `${opt.label} (${opt.hint})` : opt.label}
                    >
                      <span className="check" aria-hidden="true">
                        {isActive ? '✓' : ''}
                      </span>
                      <span>{opt.label}</span>
                      {opt.hint ? (
                        <span className="not-installed">{opt.hint}</span>
                      ) : null}
                      {opt.tag ? (
                        <span className="custom-tag">{opt.tag}</span>
                      ) : null}
                    </button>
                  );
                })}
                <div
                  className="context-menu-separator"
                  style={{ margin: '4px 6px' }}
                />
                <button
                  type="button"
                  className="settings-player-option"
                  onClick={() => selectPlayer({ value: '__pick', label: 'Other…' })}
                >
                  <span className="check" aria-hidden="true" />
                  <span>Other…</span>
                  <span className="custom-tag">choose .app</span>
                </button>
              </div>
            ) : null}
          </div>
          <div className="settings-subtext">
            QuickFlick runs <code>open -a &lt;App&gt; &lt;video&gt;</code> for each
            open. If the app is missing, it falls back to the macOS default.
          </div>
        </div>

        <div className="settings-divider" />

        <div className="settings-section">
          <div className="settings-section-label">Accent color</div>
          <div className="settings-accent-row" role="radiogroup" aria-label="Accent color">
            {ACCENT_COLOR_IDS.map((id) => {
              const preset = ACCENT_COLORS[id];
              const isActive = id === settings.accentColor;
              return (
                <button
                  type="button"
                  key={id}
                  role="radio"
                  aria-checked={isActive}
                  aria-label={preset.label}
                  title={preset.label}
                  className={`settings-accent-swatch${
                    isActive ? ' active' : ''
                  }`}
                  style={{ backgroundColor: preset.swatch }}
                  onClick={() => onSetAccentColor(id)}
                >
                  {isActive ? (
                    <span className="settings-accent-check" aria-hidden="true">
                      ✓
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>
          <div className="settings-subtext">
            Recolors highlights, focus rings, and the active selection across the app.
          </div>
        </div>

        <div className="settings-footer">
          <button
            type="button"
            className="settings-reset"
            onClick={resetDefaults}
            title="Restore default player to System default"
          >
            Reset to defaults
          </button>
          <div className="modal-actions" style={{ marginTop: 0 }}>
            <button type="button" className="btn primary" onClick={onClose}>
              Done
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
