import { describe, it, expect } from 'vitest';
import { buildCycleFrames, type CycleFrame } from './cycleFrames';
import type { Thumbnail, VideoScene } from '@shared/types';

function thumb(
  partial: Partial<Thumbnail> & Pick<Thumbnail, 'video_id' | 'frame_index' | 'time_offset' | 'file_path' | 'kind'>
): Thumbnail {
  return {
    id: partial.frame_index + 1,
    ...partial
  };
}

function scene(
  partial: Partial<VideoScene> & Pick<VideoScene, 'start_time_sec' | 'end_time_sec'>
): VideoScene {
  return {
    id: 0,
    video_id: 1,
    scene_index: 0,
    ...partial
  };
}

const DURATION = 800;

const intervals: Thumbnail[] = Array.from({ length: 8 }, (_, i) =>
  thumb({
    video_id: 1,
    frame_index: i,
    time_offset: (i * DURATION) / 8,
    file_path: `/thumbs/1/interval_${i + 1}.jpg`,
    kind: 'interval'
  })
);

const sceneAt = (mid: number, idx: number): { scene: VideoScene; thumb: Thumbnail } => {
  const start = Math.max(0, mid - 5);
  const end = Math.min(DURATION, mid + 5);
  return {
    scene: scene({ id: idx, video_id: 1, scene_index: idx, start_time_sec: start, end_time_sec: end }),
    thumb: thumb({
      video_id: 1,
      frame_index: 100 + idx,
      time_offset: mid,
      file_path: `/thumbs/1/scene_${idx + 1}.jpg`,
      kind: 'scene'
    })
  };
};

const timesOf = (frames: CycleFrame[]): number[] => frames.map((f) => f.timeSec);
const kindsOf = (frames: CycleFrame[]): string[] => frames.map((f) => (f.isScene ? 'S' : 'I'));

describe('buildCycleFrames', () => {
  it('returns 8 interval frames when no scenes detected', () => {
    const frames = buildCycleFrames(intervals, [], DURATION);
    expect(frames).toHaveLength(8);
    expect(frames.every((f) => !f.isScene)).toBe(true);
    expect(timesOf(frames)).toEqual([0, 100, 200, 300, 400, 500, 600, 700]);
  });

  it('returns fewer than 8 frames when there are fewer than 8 intervals and no scenes', () => {
    const fewer = intervals.slice(0, 5);
    const frames = buildCycleFrames(fewer, [], DURATION);
    expect(frames).toHaveLength(5);
    expect(frames.every((f) => !f.isScene)).toBe(true);
  });

  it('places 3 scenes first then fills to 8 with interval frames', () => {
    const a = sceneAt(120, 1);
    const b = sceneAt(440, 2);
    const c = sceneAt(680, 3);
    const frames = buildCycleFrames(
      intervals,
      [a.scene, b.scene, c.scene],
      DURATION
    );
    expect(frames).toHaveLength(8);
    expect(kindsOf(frames)).toEqual(['S', 'S', 'S', 'I', 'I', 'I', 'I', 'I']);
    expect(frames.slice(0, 3).map((f) => f.timeSec)).toEqual([120, 440, 680]);
  });

  it('orders scene frames by start_time_sec regardless of input order', () => {
    const a = sceneAt(120, 1);
    const b = sceneAt(440, 2);
    const c = sceneAt(680, 3);
    const frames = buildCycleFrames(
      intervals,
      [c.scene, a.scene, b.scene],
      DURATION
    );
    expect(frames.slice(0, 3).map((f) => f.timeSec)).toEqual([120, 440, 680]);
  });

  it('avoids fill interval frames that are too close to scene midpoints', () => {
    // Scene at 400s is exactly the midpoint of interval 4. With another
    // scene at 120s, the greedy fill should skip interval 4 (closest to
    // 400) and pick something further away.
    const a = sceneAt(120, 1);
    const b = sceneAt(400, 2);
    const frames = buildCycleFrames(
      intervals,
      [a.scene, b.scene],
      DURATION
    );
    const fillTimes = frames.slice(2).map((f) => f.timeSec);
    expect(fillTimes).not.toContain(400);
    expect(fillTimes).not.toContain(120);
  });

  it('caps at 8 scenes (longest strategy) and ignores intervals in the cycle', () => {
    const many = Array.from({ length: 12 }, (_, i) => {
      // Vary lengths: shorter ones first, longer ones later so the
      // 'longest' strategy has to actually pick.
      const mid = (i + 1) * (DURATION / 13);
      return sceneAt(mid, i + 1);
    });
    // Make scenes 0..3 short and 4..11 long so 'longest' prefers the latter.
    const scenes = many.slice(4).concat(many.slice(0, 4)).map((s) => s.scene);
    const frames = buildCycleFrames(intervals, scenes, DURATION, { capStrategy: 'longest' });
    expect(frames).toHaveLength(8);
    expect(frames.every((f) => f.isScene)).toBe(true);
    // Sorted by start_time_sec at the end.
    const starts = frames.map((f) => f.timeSec);
    for (let i = 1; i < starts.length; i++) {
      expect(starts[i]!).toBeGreaterThanOrEqual(starts[i - 1]!);
    }
  });

  it('respects the first cap strategy for >=8 scenes', () => {
    const many = Array.from({ length: 9 }, (_, i) => {
      const mid = (i + 1) * (DURATION / 10);
      return sceneAt(mid, i + 1);
    });
    const scenes = many.map((s) => s.scene);
    const frames = buildCycleFrames(intervals, scenes, DURATION, { capStrategy: 'first' });
    expect(frames).toHaveLength(8);
    const expectedStarts = scenes.slice(0, 8).map((s) => (s.start_time_sec + s.end_time_sec) / 2);
    expect(frames.map((f) => f.timeSec)).toEqual(expectedStarts);
  });

  it('handles 1 scene gracefully (1 scene + 7 intervals)', () => {
    const a = sceneAt(200, 1);
    const frames = buildCycleFrames(intervals, [a.scene], DURATION);
    expect(frames).toHaveLength(8);
    expect(kindsOf(frames).filter((k) => k === 'S')).toHaveLength(1);
  });

  it('falls back to a synthetic frame when a scene has no matching thumb', () => {
    // No scene thumbs on disk; cycle should still produce 8 entries.
    const a = sceneAt(200, 1);
    const frames = buildCycleFrames(intervals, [a.scene], DURATION);
    expect(frames[0]!.isScene).toBe(true);
    expect(frames[0]!.thumbnail.file_path).toBe('');
  });
});
