import { BrowserWindow } from 'electron';
import { getVideoDurationSec, recordView } from './db';
import type { VideoViewedEvent } from '../shared/types';

export const VIEW_THRESHOLD_MS = 10_000;

interface Pending {
  id: number;
  startedAt: number;
  durationSec: number | null;
}

let pending: Pending | null = null;

type Emit = (e: VideoViewedEvent) => void;
let emit: Emit = () => {};

export function setViewedEmitter(fn: Emit): void {
  emit = fn;
}

function capMs(elapsedMs: number, durationSec: number | null): number {
  if (durationSec && durationSec > 0) {
    return Math.min(elapsedMs, Math.floor(durationSec * 1000));
  }
  return elapsedMs;
}

function recordIfMeaningful(): void {
  if (!pending) return;
  const elapsed = Date.now() - pending.startedAt;
  if (elapsed >= VIEW_THRESHOLD_MS) {
    const viewTimeMs = capMs(elapsed, pending.durationSec);
    const updated = recordView(pending.id, viewTimeMs);
    if (updated) {
      emit({
        id: pending.id,
        view_count: updated.view_count,
        view_time_ms: updated.view_time_ms
      });
    }
  }
  pending = null;
}

export function attachToWindow(win: BrowserWindow): void {
  win.on('focus', recordIfMeaningful);
}

export function startView(id: number): void {
  const durationSec = getVideoDurationSec(id);
  pending = { id, startedAt: Date.now(), durationSec };
}

export function flushOnQuit(): void {
  recordIfMeaningful();
}

export function hasPending(): boolean {
  return pending !== null;
}

// Exposed for tests.
export const __testing = {
  reset(): void {
    pending = null;
    emit = () => {};
  }
};
