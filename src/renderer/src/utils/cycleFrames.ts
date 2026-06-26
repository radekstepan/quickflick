import type { Thumbnail, VideoScene } from '@shared/types';

export interface CycleFrame {
  thumbnail: Thumbnail;
  /** True when this frame is a scene mid-frame, false for an interval. */
  isScene: boolean;
  /**
   * Time in seconds this frame represents — either the scene midpoint or
   * the interval thumb's time_offset.
   */
  timeSec: number;
  /**
   * 1-based position within its kind, useful for labels.
   * For scene frames: 1-based scene index (matches `video.scenes[i]`).
   * For interval frames: 1-based position among the 8 interval frames.
   */
  indexInKind: number;
}

export interface BuildCycleOptions {
  /** Total number of cycle slots. Defaults to 8. */
  totalSlots?: number;
  /**
   * When the video has >= totalSlots scenes, which scenes to keep.
   * 'longest' keeps the visually broadest cuts; 'first' keeps the
   * opening scenes only. Defaults to 'longest'.
   */
  capStrategy?: 'longest' | 'first';
}

function lengthOf(scene: VideoScene): number {
  return Math.max(0, scene.end_time_sec - scene.start_time_sec);
}

function sortByTime<T extends { time_offset: number }>(a: T, b: T): number {
  return a.time_offset - b.time_offset;
}

/**
 * Build the 8 cycling frames for a video. Order: scene mid-frames first
 * (in temporal order), then interval frames picked to maximise the
 * minimum distance to any already-chosen time, until `totalSlots` is met.
 *
 * - 0 scenes → return `totalSlots` interval frames in time order.
 * - >= totalSlots scenes → return `totalSlots` scene frames (no intervals
 *   in the cycle; the unused interval rows are still on disk for any
 *   other consumer).
 * - 1 <= N < totalSlots → all N scene frames + (totalSlots - N) interval
 *   frames chosen by greedy max-min-distance.
 */
export function buildCycleFrames(
  thumbnails: readonly Thumbnail[],
  scenes: readonly VideoScene[],
  durationSec: number,
  options: BuildCycleOptions = {}
): CycleFrame[] {
  const totalSlots = options.totalSlots ?? 8;
  const capStrategy = options.capStrategy ?? 'longest';

  const sceneThumbs = thumbnails
    .filter((t) => t.kind === 'scene')
    .slice()
    .sort(sortByTime);
  const intervalThumbs = thumbnails
    .filter((t) => t.kind === 'interval')
    .slice()
    .sort(sortByTime);

  if (scenes.length === 0) {
    return intervalThumbs.slice(0, totalSlots).map((t, i) => ({
      thumbnail: t,
      isScene: false,
      timeSec: t.time_offset,
      indexInKind: i + 1
    }));
  }

  if (scenes.length >= totalSlots) {
    const ranked = capStrategy === 'longest'
      ? [...scenes].sort((a, b) => lengthOf(b) - lengthOf(a))
      : [...scenes].sort((a, b) => a.start_time_sec - b.start_time_sec);
    const kept = ranked.slice(0, totalSlots).sort((a, b) => a.start_time_sec - b.start_time_sec);
    return kept.map((scene, i) => buildSceneFrame(scene, sceneThumbs, durationSec, i));
  }

  // 1 <= N < totalSlots: all scenes + fill the rest with intervals chosen
  // by greedy max-min-distance.
  const sceneFrames: CycleFrame[] = scenes
    .slice()
    .sort((a, b) => a.start_time_sec - b.start_time_sec)
    .map((scene, i) => buildSceneFrame(scene, sceneThumbs, durationSec, i));

  const fillCount = totalSlots - sceneFrames.length;
  const fill = pickFillIntervals(intervalThumbs, sceneFrames, fillCount);

  return [...sceneFrames, ...fill];
}

function buildSceneFrame(
  scene: VideoScene,
  sceneThumbs: readonly Thumbnail[],
  _durationSec: number,
  positionInCycle: number
): CycleFrame {
  // Find the scene thumb whose time_offset is closest to the scene midpoint.
  const midpoint = (scene.start_time_sec + scene.end_time_sec) / 2;
  let best: Thumbnail | null = null;
  let bestDelta = Infinity;
  for (const t of sceneThumbs) {
    const d = Math.abs(t.time_offset - midpoint);
    if (d < bestDelta) {
      bestDelta = d;
      best = t;
    }
  }
  if (!best) {
    // No scene thumb row for this scene (e.g. extraction failed). Fall
    // back to a synthetic frame so the cycle still has the right shape.
    return {
      thumbnail: {
        id: -1 - positionInCycle,
        video_id: -1,
        frame_index: -1,
        time_offset: midpoint,
        file_path: '',
        kind: 'scene'
      },
      isScene: true,
      timeSec: midpoint,
      indexInKind: scene.scene_index
    };
  }
  return {
    thumbnail: best,
    isScene: true,
    timeSec: midpoint,
    indexInKind: scene.scene_index
  };
}

function pickFillIntervals(
  intervalThumbs: readonly Thumbnail[],
  chosen: CycleFrame[],
  count: number
): CycleFrame[] {
  if (count <= 0 || intervalThumbs.length === 0) return [];
  const taken = new Set<number>();
  const result: CycleFrame[] = [];
  const usedTimes: number[] = chosen.map((c) => c.timeSec);

  // Greedy: at each step pick the interval whose time is farthest from
  // the nearest already-chosen time. Tie-break by smaller time_offset so
  // the fill is stable and front-loaded for empty videos.
  for (let step = 0; step < count; step++) {
    let bestIdx = -1;
    let bestMinDist = -Infinity;
    for (let i = 0; i < intervalThumbs.length; i++) {
      if (taken.has(i)) continue;
      const t = intervalThumbs[i]!.time_offset;
      let minDist = Infinity;
      for (const u of usedTimes) {
        const d = Math.abs(t - u);
        if (d < minDist) minDist = d;
      }
      // When there are no used times yet, every interval is equally
      // good — fall back to selecting the smallest remaining time so the
      // result is deterministic.
      if (minDist === Infinity) minDist = -t;
      if (minDist > bestMinDist) {
        bestMinDist = minDist;
        bestIdx = i;
      }
    }
    if (bestIdx < 0) break;
    taken.add(bestIdx);
    const t = intervalThumbs[bestIdx]!;
    usedTimes.push(t.time_offset);
    result.push({
      thumbnail: t,
      isScene: false,
      timeSec: t.time_offset,
      indexInKind: bestIdx + 1
    });
  }
  return result;
}
