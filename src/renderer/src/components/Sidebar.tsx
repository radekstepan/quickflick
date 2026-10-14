import { useEffect, useMemo, useState } from 'react';
import type { VideoWithThumbs } from '@shared/types';
import type { Tag } from '../utils/tags';
import { formatViewTime } from '../utils/formatViewTime';
import { useMenuPosition } from '../hooks/useMenuPosition';

interface Props {
  roots: string[];
  videos: VideoWithThumbs[];
  tags: Tag[];
  untaggedCount: number;
  selectedRoot: string | null;
  selectedTag: string | null;
  filterUntagged: boolean;
  isScanning: boolean;
  onSelectRoot: (root: string | null) => void;
  onSelectTag: (tag: string | null) => void;
  onSelectUntagged: () => void;
  onRemoveRoot: (path: string) => Promise<void>;
  onRescan: () => void;
  onDeleteTag: (name: string) => void;
}

type ContextMenu =
  | { kind: 'root'; x: number; y: number; path: string }
  | { kind: 'tag'; x: number; y: number; name: string };

function basename(p: string): string {
  const parts = p.split('/').filter(Boolean);
  return parts[parts.length - 1] ?? p;
}

function rootFor(video: VideoWithThumbs, roots: string[]): string | null {
  for (const r of roots) {
    if (video.folder === r || video.folder.startsWith(r + '/')) return r;
  }
  return null;
}

export function Sidebar({
  roots,
  videos,
  tags,
  untaggedCount,
  selectedRoot,
  selectedTag,
  filterUntagged,
  isScanning,
  onSelectRoot,
  onSelectTag,
  onSelectUntagged,
  onRemoveRoot,
  onRescan,
  onDeleteTag
}: Props) {
  const counts = useMemo(() => {
    const map = new Map<string, number>();
    for (const r of roots) map.set(r, 0);
    for (const v of videos) {
      const r = rootFor(v, roots);
      if (r) map.set(r, (map.get(r) ?? 0) + 1);
    }
    return map;
  }, [roots, videos]);

  const viewTimes = useMemo(() => {
    const map = new Map<string, number>();
    for (const r of roots) map.set(r, 0);
    for (const v of videos) {
      const r = rootFor(v, roots);
      if (r) map.set(r, (map.get(r) ?? 0) + v.view_time_ms);
    }
    return map;
  }, [roots, videos]);

  const [menu, setMenu] = useState<ContextMenu | null>(null);
  const menuPosition = useMenuPosition(menu);

  useEffect(() => {
    if (!menu) return;
    const onDown = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && target.closest('.context-menu')) return;
      setMenu(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenu(null);
    };
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [menu]);

  if (roots.length === 0) {
    return <div className="sidebar" />;
  }

  return (
    <div className="sidebar">
      <div className="sidebar-section">Library</div>
      {roots.map((r) => {
        const isActive = selectedRoot === r;
        return (
          <div
            key={r}
            className={`sidebar-item ${isActive ? 'active' : ''}`}
            onClick={() => { if (!isActive) onSelectRoot(r); }}
            onContextMenu={(e) => {
              e.preventDefault();
              setMenu({ kind: 'root', x: e.clientX, y: e.clientY, path: r });
            }}
            title={r + '\n\nClick to filter · Right-click for options'}
          >
            <svg className="sidebar-icon" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z" />
            </svg>
            <span className="sidebar-label">{basename(r)}</span>
            <span className="count">{counts.get(r) ?? 0}</span>
          </div>
        );
      })}

      {tags.length > 0 || untaggedCount > 0 ? (
        <>
          <div className="sidebar-section">
            <span className="sidebar-section-row">
              <svg className="sidebar-icon" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z" />
                <circle cx="7" cy="7" r="1.2" fill="currentColor" />
              </svg>
              <span>Tags</span>
            </span>
          </div>
          {tags.map((t) => {
            const isActive = selectedTag === t.name;
            return (
              <div
                key={t.name}
                className={`sidebar-item ${isActive ? 'active' : ''}`}
                onClick={() => onSelectTag(isActive ? null : t.name)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  setMenu({ kind: 'tag', x: e.clientX, y: e.clientY, name: t.name });
                }}
                title={`Delete "${t.name}" from all videos`}
              >
                <span className="sidebar-label">{t.name}</span>
                <span className="count">{t.count}</span>
              </div>
            );
          })}
          {untaggedCount > 0 ? (
            <div
              key="__untagged__"
              className={`sidebar-item untagged ${filterUntagged ? 'active' : ''}`}
              onClick={onSelectUntagged}
              title="Click to filter to untagged videos only"
            >
              <span className="sidebar-label">Untagged</span>
              <span className="count">{untaggedCount}</span>
            </div>
          ) : null}
        </>
      ) : null}

      {menu ? (
        <div
          ref={menuPosition.ref}
          className="context-menu"
          style={{ left: menuPosition.position?.x ?? menu.x, top: menuPosition.position?.y ?? menu.y }}
          onClick={(e) => e.stopPropagation()}
        >
          {menu.kind === 'root' ? (
            <>
              <div className="context-menu-item-static">
                <span>Total view time</span>
                <span className="context-menu-shortcut">{formatViewTime(viewTimes.get(menu.path) ?? 0)}</span>
              </div>
              <div className="context-menu-separator" />
              <button
                type="button"
                className="context-menu-item"
                onClick={() => {
                  setMenu(null);
                  onRescan();
                }}
                disabled={isScanning}
              >
                <span className="context-menu-icon" aria-hidden="true">
                  {isScanning ? <span className="spinner" /> : (
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M21 12a9 9 0 1 1-3-6.7" />
                      <path d="M21 4v5h-5" />
                    </svg>
                  )}
                </span>
                <span>{isScanning ? 'Scanning…' : 'Rescan library'}</span>
                <span className="context-menu-shortcut">⌘R</span>
              </button>
              <div className="context-menu-separator" />
              <button
                type="button"
                className="context-menu-item danger"
                onClick={() => {
                  const p = menu.path;
                  setMenu(null);
                  void onRemoveRoot(p);
                }}
              >
                <span className="context-menu-icon" aria-hidden="true">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                  </svg>
                </span>
                <span>Remove folder from library</span>
              </button>
            </>
          ) : (
            <button
              type="button"
              className="context-menu-item danger"
              onClick={() => {
                const n = menu.name;
                if (selectedTag === n) onSelectTag(null);
                setMenu(null);
                onDeleteTag(n);
              }}
            >
              <span className="context-menu-icon" aria-hidden="true">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M18 6L6 18M6 6l12 12" />
                </svg>
              </span>
                <span>Delete tag</span>
              </button>
          )}
        </div>
      ) : null}
    </div>
  );
}
