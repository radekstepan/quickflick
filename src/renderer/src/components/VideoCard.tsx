import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { useHoverCycle } from '../hooks/useHoverCycle';
import { usePreloadedImages } from '../hooks/usePreloadedImages';
import { api } from '../api';
import { displayName } from '../utils/displayName';
import { getMatchingTags, type Tag } from '../utils/tags';
import { TagPickerModal } from './TagPickerModal';
import type { VideoWithThumbs } from '@shared/types';

interface Props {
  video: VideoWithThumbs;
  roots: string[];
  tags: Tag[];
  onOpen: (id: number) => void;
  onAddTag: (id: number, name: string) => void;
  onRemoveTag: (id: number, name: string) => void;
}

function formatDuration(seconds: number | null): string {
  if (!seconds || !Number.isFinite(seconds)) return '';
  const total = Math.round(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function formatViews(n: number): string {
  if (n === 1) return '1 view';
  return `${n} views`;
}

export function VideoCard({ video, roots, tags, onOpen, onAddTag, onRemoveTag }: Props) {
  const urls = useMemo(
    () =>
      video.thumbnails
        .slice()
        .sort((a, b) => a.frame_index - b.frame_index)
        .slice(1)
        .map((t) => (t as { url?: string }).url ?? `file://${t.file_path}`),
    [video.thumbnails]
  );

  const loaded = usePreloadedImages(urls);
  const hover = useHoverCycle({ frameCount: urls.length, intervalMs: 700 });
  const [errored, setErrored] = useState<Set<number>>(new Set());
  const [displayFrame, setDisplayFrame] = useState(hover.currentFrame);
  const [leavingFrame, setLeavingFrame] = useState<number | null>(null);
  const [currentActive, setCurrentActive] = useState(true);

  useEffect(() => {
    if (displayFrame === hover.currentFrame) return;
    setLeavingFrame(displayFrame);
    setCurrentActive(false);
    setDisplayFrame(hover.currentFrame);
    let raf2 = 0;
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => setCurrentActive(true));
    });
    const t = setTimeout(() => setLeavingFrame(null), 220);
    return () => {
      cancelAnimationFrame(raf1);
      cancelAnimationFrame(raf2);
      clearTimeout(t);
    };
  }, [hover.currentFrame, displayFrame]);

  const renderImg = (idx: number, role: 'current' | 'leaving') => {
    const src = urls[idx];
    if (!src || errored.has(idx)) return null;
    const isCurrent = role === 'current';
    const show = isCurrent ? currentActive && loaded[idx] : true;
    return (
      <img
        key={src}
        src={src}
        alt={isCurrent ? video.filename : ''}
        className={`thumb${show ? ' current' : ''}`}
        draggable={false}
        aria-hidden={!isCurrent}
        onError={() => {
          if (errored.has(idx)) return;
          setErrored((prev) => {
            if (prev.has(idx)) return prev;
            const next = new Set(prev);
            next.add(idx);
            return next;
          });
        }}
      />
    );
  };

  const showBadge = hover.isHovering && urls.length > 1;

  const matchingTags = useMemo(
    () => getMatchingTags(video, tags, roots),
    [video, tags, roots]
  );
  const userTagSet = useMemo(
    () => new Set(video.tags.map((t) => t.toLowerCase())),
    [video.tags]
  );
  const excludedTagSet = useMemo(
    () => new Set(video.excludedTags.map((t) => t.toLowerCase())),
    [video.excludedTags]
  );

  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);

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

  return (
    <div
      className="card"
      onClick={() => onOpen(video.id)}
      onContextMenu={(e) => {
        e.preventDefault();
        setMenu({ x: e.clientX, y: e.clientY });
      }}
      onMouseEnter={hover.bind.onMouseEnter}
      onMouseLeave={hover.bind.onMouseLeave}
      title={
        displayName(video.filename, video.folder, roots) +
        '\n\nClick: open in default app\nRight-click: more options'
      }
    >
      <div className="card-thumb">
        {leavingFrame !== null ? renderImg(leavingFrame, 'leaving') : null}
        {renderImg(displayFrame, 'current')}
        {urls.length === 0 ? (
          <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', color: '#666', fontSize: 11 }}>
            No thumbnail
          </div>
        ) : null}
        {showBadge ? <span className="badge cycling">{displayFrame + 1}/{urls.length}</span> : null}
        {video.duration ? <span className="badge">{formatDuration(video.duration)}</span> : null}
      </div>
      <div className="card-meta">
        <div className="card-name">{displayName(video.filename, video.folder, roots)}</div>
        <div className="card-sub">
          {video.width && video.height ? <span>{video.width}×{video.height}</span> : null}
          {video.width && video.height ? <span className="dot" /> : null}
          <span>{formatSize(video.size)}</span>
          <span className="dot" />
          <span>{formatViews(video.view_count)}</span>
        </div>
      </div>
      {menu
        ? createPortal(
            <div
              className="context-menu"
              style={{ left: menu.x, top: menu.y }}
              onClick={(e) => e.stopPropagation()}
            >
              <button
                type="button"
                className="context-menu-item"
                onClick={() => {
                  setMenu(null);
                  void api.revealVideo(video.id);
                }}
              >
                Reveal in Finder
              </button>
              <button
                type="button"
                className="context-menu-item"
                onClick={() => {
                  setMenu(null);
                  setPickerOpen(true);
                }}
              >
                Edit tags
              </button>
            </div>,
            document.body
          )
        : null}
      {pickerOpen
        ? createPortal(
            <TagPickerModal
              matchingTags={matchingTags}
              allTagNames={tags.map((t) => t.name)}
              userTagSet={userTagSet}
              excludedTagSet={excludedTagSet}
              onAdd={(name) => onAddTag(video.id, name)}
              onRemove={(name) => onRemoveTag(video.id, name)}
              onClose={() => setPickerOpen(false)}
            />,
            document.body
          )
        : null}
    </div>
  );
}
