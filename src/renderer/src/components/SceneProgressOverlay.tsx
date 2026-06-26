import { useEffect, useRef, useState } from 'react';
import type { SceneProgress, SceneProgressEvent } from '@shared/types';

interface Props {
  progress: { videoId: number; progress: SceneProgress } | null;
}

const MIN_FRAME_INTERVAL_MS = 150;
const ETA_WINDOW_MS = 12_000;
const STALE_THRESHOLD_SEC = 3;

export function SceneProgressOverlay({ progress }: Props) {
  const [staleSeconds, setStaleSeconds] = useState(0);
  const lastFrameTimeRef = useRef<number>(0);
  const samplesRef = useRef<{ time: number; frame: number }[]>([]);
  const rafRef = useRef<number | null>(null);

  const event: SceneProgressEvent | null = progress;

  useEffect(() => {
    if (event) {
      samplesRef.current = [];
      lastFrameTimeRef.current = performance.now();
      setStaleSeconds(0);
    }
  }, [event?.videoId]);

  useEffect(() => {
    if (!event) return;
    if (event.progress.kind !== 'frame') return;
    const now = performance.now();
    if (now - lastFrameTimeRef.current < MIN_FRAME_INTERVAL_MS) return;
    lastFrameTimeRef.current = now;
    const samples = samplesRef.current;
    samples.push({ time: now, frame: event.progress.frame });
    while (samples.length > 2 && samples[0]!.time < now - ETA_WINDOW_MS) {
      samples.shift();
    }
  }, [event]);

  useEffect(() => {
    if (!event) return;
    const tick = () => {
      const elapsed = (performance.now() - lastFrameTimeRef.current) / 1000;
      setStaleSeconds(elapsed);
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, [event]);

  if (!event) return null;

  const p = event.progress;
  const showStale = p.kind === 'frame' && staleSeconds > STALE_THRESHOLD_SEC;
  const label = formatLabel(p, showStale);
  const eta = formatEtaText(p, samplesRef.current);

  return (
    <div className="scan-progress scene-progress">
      <span className="spinner" />
      <span className="scan-progress-label">{label}</span>
      {eta ? (
        <>
          <span className="scan-progress-divider" />
          <span className="scan-progress-eta">{eta} remaining</span>
        </>
      ) : null}
    </div>
  );
}

function formatLabel(p: SceneProgress, stale: boolean): string {
  if (p.kind === 'frame') {
    const pct = Math.floor(p.percent);
    const pctText = Number.isFinite(pct) ? `${pct}%` : '';
    const staleText = stale ? ' (still working…)' : '';
    if (pctText) {
      return `Detecting scenes… ${pctText}${staleText}`;
    }
    return `Detecting scenes…${staleText}`;
  }
  if (p.kind === 'phase') {
    if (p.text.length > 80) return p.text.slice(0, 80) + '…';
    return p.text;
  }
  if (p.kind === 'done') return `Found ${p.count} scene${p.count === 1 ? '' : 's'}`;
  return p.kind === 'error' ? `Failed: ${p.message}` : '';
}

function formatEtaText(
  p: SceneProgress,
  samples: ReadonlyArray<{ time: number; frame: number }>
): string | null {
  if (p.kind !== 'frame' || p.percent <= 0 || p.percent >= 100) return null;
  if (samples.length < 2) return null;
  const first = samples[0]!;
  const last = samples[samples.length - 1]!;
  const dt = last.time - first.time;
  const df = last.frame - first.frame;
  if (dt <= 0 || df <= 0) return null;
  const fps = (df / dt) * 1000;
  if (fps < 1) return null;
  const totalFrames = (p.frame / p.percent) * 100;
  const remainingFrames = totalFrames - p.frame;
  if (!Number.isFinite(remainingFrames) || remainingFrames <= 0) return null;
  const ms = (remainingFrames / fps) * 1000;
  const totalSec = Math.max(0, Math.round(ms / 1000));
  if (totalSec < 60) return `~${totalSec}s`;
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return s > 0 ? `~${m}m ${s}s` : `~${m}m`;
}
