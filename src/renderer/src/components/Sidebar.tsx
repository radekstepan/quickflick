import { useEffect, useMemo, useState } from 'react';
import type { VideoWithThumbs } from '@shared/types';

interface Props {
  roots: string[];
  videos: VideoWithThumbs[];
  selectedRoot: string | null;
  onSelectRoot: (root: string | null) => void;
  onRemoveRoot: (path: string) => void;
}

interface ContextMenu {
  x: number;
  y: number;
  path: string;
}

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

export function Sidebar({ roots, videos, selectedRoot, onSelectRoot, onRemoveRoot }: Props) {
  const counts = useMemo(() => {
    const map = new Map<string, number>();
    for (const r of roots) map.set(r, 0);
    for (const v of videos) {
      const r = rootFor(v, roots);
      if (r) map.set(r, (map.get(r) ?? 0) + 1);
    }
    return map;
  }, [roots, videos]);

  const [menu, setMenu] = useState<ContextMenu | null>(null);

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
            onClick={() => onSelectRoot(isActive ? null : r)}
            onContextMenu={(e) => {
              e.preventDefault();
              setMenu({ x: e.clientX, y: e.clientY, path: r });
            }}
            title={r + '\n\nClick to filter · Right-click for options'}
          >
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{basename(r)}</span>
            <span className="count">{counts.get(r) ?? 0}</span>
          </div>
        );
      })}

      {menu ? (
        <div
          className="context-menu"
          style={{ left: menu.x, top: menu.y }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            className="context-menu-item danger"
            onClick={() => {
              const p = menu.path;
              setMenu(null);
              void onRemoveRoot(p);
            }}
          >
            Remove folder from library
          </button>
        </div>
      ) : null}
    </div>
  );
}
