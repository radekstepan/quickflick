import { useEffect } from 'react';
import type { VideoScene } from '@shared/types';
import type { CycleFrame } from '../utils/cycleFrames';

interface Props {
  videoName: string;
  durationSec: number;
  cycleFrames: readonly CycleFrame[];
  scenes: readonly VideoScene[];
  onClose: () => void;
}

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const total = Math.round(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function cellLabel(frame: CycleFrame, totalScenes: number): string {
  if (frame.isScene) {
    return `Scene ${frame.indexInKind}/${totalScenes || '?'}`;
  }
  return `Int ${frame.indexInKind}/8`;
}

function scenePct(start: number, end: number, duration: number): number {
  if (!duration) return 0;
  const widthPct = ((end - start) / duration) * 100;
  return Math.max(0, Math.min(100, widthPct));
}

export function SampleGridModal({ videoName, durationSec, cycleFrames, scenes, onClose }: Props) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const cells = cycleFrames.slice(0, 8);

  return (
    <div
      className="modal-backdrop sample-modal-backdrop"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="modal sample-modal"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={`8 samples for ${videoName}`}
      >
        <div className="sample-modal-header">
          <div className="sample-modal-title">
            <span className="sample-modal-eyebrow">8 samples</span>
            <span className="sample-modal-name">{videoName}</span>
          </div>
          <button
            type="button"
            className="sample-modal-close"
            onClick={onClose}
            aria-label="Close"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="6" y1="6" x2="18" y2="18" />
              <line x1="18" y1="6" x2="6" y2="18" />
            </svg>
          </button>
        </div>

        <div className="sample-grid" role="list">
          {cells.map((frame, i) => {
            const src = (frame.thumbnail as { url?: string }).url ?? `file://${frame.thumbnail.file_path}`;
            const label = cellLabel(frame, scenes.length);
            return (
              <div className="sample-cell" role="listitem" key={`${i}-${frame.thumbnail.id}`}>
                <div className="sample-cell-frame">
                  <span className={`sample-cell-badge${frame.isScene ? ' is-scene' : ''}`}>
                    {label}
                  </span>
                  <img
                    src={src}
                    alt={`${label} at ${formatTime(frame.timeSec)}`}
                    draggable={false}
                    className="sample-cell-img"
                  />
                  <span className="sample-cell-time">{formatTime(frame.timeSec)}</span>
                </div>
              </div>
            );
          })}
        </div>

        {scenes.length > 0 ? (
          <div className="sample-timeline">
            <div className="sample-timeline-label">
              <span>Scene timeline</span>
              <span className="sample-timeline-meta">
                {scenes.length} scene{scenes.length === 1 ? '' : 's'} · {formatTime(durationSec)}
              </span>
            </div>
            <div className="sample-timeline-bar" role="img" aria-label="Scene boundaries across the video">
              {scenes.map((scene, i) => {
                const leftPct = durationSec > 0 ? (scene.start_time_sec / durationSec) * 100 : 0;
                const widthPct = scenePct(scene.start_time_sec, scene.end_time_sec, durationSec);
                return (
                  <div
                    key={i}
                    className="sample-timeline-segment"
                    style={{ left: `${leftPct}%`, width: `${widthPct}%` }}
                    title={`Scene ${i + 1}: ${formatTime(scene.start_time_sec)} – ${formatTime(scene.end_time_sec)}`}
                  />
                );
              })}
            </div>
          </div>
        ) : (
          <div className="sample-timeline sample-timeline-empty">
            <span>No scenes detected. Right-click → Detect Scenes to populate.</span>
          </div>
        )}
      </div>
    </div>
  );
}
