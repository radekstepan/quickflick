import { memo, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { useHoverCycle } from '../hooks/useHoverCycle';
import { usePreloadedImages } from '../hooks/usePreloadedImages';
import { api } from '../api';
import { displayName } from '../utils/displayName';
import { getMatchingTags, type Tag } from '../utils/tags';
import { formatViewsWithTime } from '../utils/formatViewTime';
import { TagPickerModal } from './TagPickerModal';
import { applyPendingToVideo, type PendingVideoEdit } from '../hooks/useLibrary';
import type { OpenResult, VideoWithThumbs } from '@shared/types';

interface Props {
  video: VideoWithThumbs;
  roots: string[];
  /** Transition-consistent base tags. Referentially stable across delete
   *  clicks, so per-card matching memos survive them. */
  matchTags: Tag[];
  /** Globally deleted names, hidden urgently (cheap chip filter below). */
  removedTagNames: ReadonlySet<string>;
  /** This video's urgent optimistic overlay, if any. Stable per video. */
  pending: PendingVideoEdit | undefined;
  /** Display names for the picker, memoized once in the parent. */
  tagNames: string[];
  onOpen: (id: number) => Promise<OpenResult> | void;
  onOpened?: (result: OpenResult) => void;
  onAddTag: (id: number, name: string) => void;
  onRemoveTag: (id: number, name: string) => void;
}

export function formatDuration(seconds: number | null): string {
  if (!seconds || !Number.isFinite(seconds)) return '';
  const total = Math.round(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

export function formatViews(n: number): string {
  if (n === 1) return '1 view';
  return `${n} views`;
}

export function viewsLabel(viewCount: number, viewTimeMs: number): string {
  return formatViewsWithTime(viewCount, viewTimeMs);
}

function VideoCardInner({
  video,
  roots,
  matchTags,
  removedTagNames,
  pending,
  tagNames,
  onOpen,
  onOpened,
  onAddTag,
  onRemoveTag
}: Props) {
  const urls = useMemo(
    () =>
      video.thumbnails
        .slice()
        .sort((a, b) => a.frame_index - b.frame_index)
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

  // Urgent optimistic overlay: pending entry wins over the
  // (possibly transition-lagged) video prop. Same ref unless edited.
  const effVideo = useMemo(
    () => applyPendingToVideo(video, pending),
    [video, pending]
  );

  // Matching runs against the stable base list. Split in two so a delete
  // click — which only changes removedTagNames — skips the O(T) match and
  // reruns just the O(own chips) tail below.
  const baseMatches = useMemo(
    () => getMatchingTags(effVideo, matchTags, roots),
    [effVideo, matchTags, roots]
  );
  const matchingTags = useMemo(() => {
    // Union covers pending-added explicit tags during the transition beat.
    const out = baseMatches.slice();
    const seen = new Set(out.map((t) => t.toLowerCase()));
    for (const t of effVideo.tags) {
      if (!seen.has(t.toLowerCase())) {
        seen.add(t.toLowerCase());
        out.push(t);
      }
    }
    // Removed filter hides globally deleted names on the same frame.
    const filtered = out.filter((t) => !removedTagNames.has(t.toLowerCase()));
    filtered.sort((a, b) => a.localeCompare(b));
    return filtered;
  }, [baseMatches, effVideo, removedTagNames]);
  const userTagSet = useMemo(
    () => new Set(effVideo.tags.map((t) => t.toLowerCase())),
    [effVideo]
  );
  const excludedTagSet = useMemo(
    () => new Set(effVideo.excludedTags.map((t) => t.toLowerCase())),
    [effVideo]
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

  const handleOpen = () => {
    const result = onOpen(video.id);
    if (result && typeof (result as Promise<OpenResult>).then === 'function') {
      void (result as Promise<OpenResult>).then((r) => onOpened?.(r));
    }
  };

  return (
    <div
      className="card"
      onClick={handleOpen}
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
          <div className="no-thumb">No thumbnail</div>
        ) : null}
        {showBadge ? <span className="badge cycling">{displayFrame + 1}/{urls.length}</span> : null}
        {video.duration ? <span className="badge">{formatDuration(video.duration)}</span> : null}
      </div>
      <div className="card-meta">
        <div className="card-name">{displayName(video.filename, video.folder, roots)}</div>
        <div className="card-sub">
          {video.width && video.height ? (
            <span className={video.width >= 3840 || video.height >= 2160 ? 'res-4k' : undefined}>
              {video.width}×{video.height}
            </span>
          ) : null}
          {video.width && video.height ? <span className="dot" /> : null}
          <span>{formatSize(video.size)}</span>
          <span className="dot" />
          {video.view_count === 0 ? (
            <span className="card-sub-new" data-testid="new-label">new</span>
          ) : (
            <span data-testid="views-label">
              {formatViewsWithTime(video.view_count, video.view_time_ms ?? 0)}
            </span>
          )}
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
                  handleOpen();
                }}
              >
                <span className="context-menu-icon" aria-hidden="true">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                    <polygon points="6 4 20 12 6 20 6 4" fill="currentColor" stroke="none" />
                  </svg>
                </span>
                <span>Play</span>
              </button>
              <button
                type="button"
                className="context-menu-item"
                onClick={() => {
                  setMenu(null);
                  void api.revealVideo(video.id);
                }}
              >
                <span className="context-menu-icon" aria-hidden="true">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z" />
                    <path d="M9 13l2 2 4-4" />
                  </svg>
                </span>
                <span>Reveal in Finder</span>
              </button>
              <div className="context-menu-separator" />
              <button
                type="button"
                className="context-menu-item"
                onClick={() => {
                  setMenu(null);
                  setPickerOpen(true);
                }}
              >
                <span className="context-menu-icon" aria-hidden="true">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z" />
                    <circle cx="7" cy="7" r="1.2" fill="currentColor" />
                  </svg>
                </span>
                <span>Edit tags</span>
              </button>
            </div>,
            document.body
          )
        : null}
      {pickerOpen
        ? createPortal(
            <TagPickerModal
              matchingTags={matchingTags}
              allTagNames={tagNames}
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

// Skips re-render unless this card's own inputs changed. matchTags is
// transition-stable and pending is a stable per-video entry; a delete
// elsewhere only changes removedTagNames/tagNames identity, whose memos
// inside are O(own chips). NOTE: removedTagNames/tagNames MUST stay in
// the comparison — memo bailout discards the new props, so ignoring them
// would leave stale chips in an open picker until an unrelated prop
// changes. Re-render exec with memo hits costs microseconds per card.
export const VideoCard = memo(VideoCardInner, (prev, next) => {
  return (
    prev.video === next.video &&
    prev.roots === next.roots &&
    prev.matchTags === next.matchTags &&
    prev.removedTagNames === next.removedTagNames &&
    prev.pending === next.pending &&
    prev.tagNames === next.tagNames &&
    prev.onOpen === next.onOpen &&
    prev.onOpened === next.onOpened &&
    prev.onAddTag === next.onAddTag &&
    prev.onRemoveTag === next.onRemoveTag
  );
});
