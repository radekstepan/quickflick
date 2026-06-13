import { useMemo, useState } from 'react';
import { useHoverCycle } from '../hooks/useHoverCycle';
import { usePreloadedImages } from '../hooks/usePreloadedImages';
import { api } from '../api';
import type { VideoWithThumbs } from '@shared/types';

interface Props {
  video: VideoWithThumbs;
  onOpen: (id: number) => void;
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

export function VideoCard({ video, onOpen }: Props) {
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

  const currentSrc = urls[hover.currentFrame] ?? null;
  const currentErrored = errored.has(hover.currentFrame);
  const showImg = currentSrc && !currentErrored;
  const showBadge = hover.isHovering && urls.length > 1;

  return (
    <div
      className="card"
      onClick={() => onOpen(video.id)}
      onContextMenu={(e) => {
        e.preventDefault();
        void api.revealVideo(video.id);
      }}
      title={video.filename + '\n\nClick: open in default app\nRight-click: show in Finder'}
    >
      <div className="card-thumb" {...hover.bind}>
        {showImg && currentSrc ? (
          <img
            key={currentSrc}
            src={currentSrc}
            alt={video.filename}
            className={loaded[hover.currentFrame] ? 'loaded' : ''}
            draggable={false}
            onError={() => {
              setErrored((prev) => {
                if (prev.has(hover.currentFrame)) return prev;
                const next = new Set(prev);
                next.add(hover.currentFrame);
                return next;
              });
            }}
          />
        ) : (
          <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', color: '#666', fontSize: 11 }}>
            No thumbnail
          </div>
        )}
        {showBadge ? <span className="badge cycling">{hover.currentFrame + 1}/{urls.length}</span> : null}
        {video.duration ? <span className="badge">{formatDuration(video.duration)}</span> : null}
      </div>
      <div className="card-meta">
        <div className="card-name">{video.filename}</div>
        <div className="card-sub">
          {video.width && video.height ? <span>{video.width}×{video.height}</span> : null}
          {video.width && video.height ? <span className="dot" /> : null}
          <span>{formatSize(video.size)}</span>
        </div>
      </div>
    </div>
  );
}
