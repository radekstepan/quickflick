import { useEffect, useRef } from 'react';
import { prefetchFrame0, prefetchFrameIdle } from '../prefetch';
import type { VideoWithThumbs } from '@shared/types';

const OVERSCAN_ROWS = 2;
const COLUMNS_HINT = 5;
const OVERSCAN = OVERSCAN_ROWS * COLUMNS_HINT;

export function useViewportPrefetch(
  videos: VideoWithThumbs[],
  visibleRange: { startIndex: number; endIndex: number } | null
): void {
  const lastRangeRef = useRef<{ from: number; to: number }>({ from: -1, to: -1 });

  useEffect(() => {
    if (!visibleRange || videos.length === 0) return;
    const from = Math.max(0, visibleRange.startIndex - OVERSCAN);
    const to = Math.min(videos.length - 1, visibleRange.endIndex + OVERSCAN);

    if (from === lastRangeRef.current.from && to === lastRangeRef.current.to) return;
    lastRangeRef.current = { from, to };

    for (let i = from; i <= to; i++) {
      const v = videos[i];
      if (!v || v.thumbnails.length === 0) continue;
      const sorted = v.thumbnails.slice().sort((a, b) => a.frame_index - b.frame_index);
      const first = sorted[0] as { url?: string; file_path: string };
      const url0 = first.url ?? `file://${first.file_path}`;
      prefetchFrame0(url0);
      for (let k = 1; k < sorted.length; k++) {
        const t = sorted[k] as { url?: string; file_path: string };
        const u = t.url ?? `file://${t.file_path}`;
        prefetchFrameIdle(u);
      }
    }
  }, [videos, visibleRange]);
}
