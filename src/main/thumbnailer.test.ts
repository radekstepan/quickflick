import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

const rows: { video_id: number; frame_index: number; time_offset: number; file_path: string }[] = [];
let thumbsRoot = '';

vi.mock('./db', () => ({
  getThumbsDir: () => thumbsRoot,
  insertThumbnails: (r: typeof rows) => { rows.push(...r); },
  deleteThumbnailsForVideo: () => {},
}));

import { generateThumbnails } from './thumbnailer';

const hasFfmpeg =
  spawnSync('ffmpeg', ['-hide_banner', '-version']).status === 0 &&
  spawnSync('ffprobe', ['-hide_banner', '-version']).status === 0;

function makeVideo(dir: string, name: string, truncateToBytes: number | null): string {
  const full = join(dir, `full-${name}.mp4`);
  execFileSync('ffmpeg', [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-f', 'lavfi', '-i', 'testsrc=duration=60:size=640x360:rate=10',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p',
    '-movflags', '+faststart',
    full,
  ]);
  // Sanity: the header claims the full duration even after truncation, which
  // is exactly the truncated-import scenario (moov intact, mdat cut short).
  const out = join(dir, `${name}.mp4`);
  execFileSync('cp', [full, out]);
  if (truncateToBytes !== null) {
    execFileSync('truncate', ['-s', String(truncateToBytes), out]);
  }
  const dur = execFileSync('ffprobe', [
    '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', out,
  ]).toString().trim();
  expect(Number(dur)).toBeCloseTo(60, 0);
  return out;
}

describe.skipIf(!hasFfmpeg)('thumbnailer truncated-video fallback', () => {
  let dir = '';

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'thumb-test-'));
    thumbsRoot = join(dir, 'thumbs');
    rows.length = 0;
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('keeps thumbnails from the playable prefix instead of failing', async () => {
    const full = join(dir, 'probe-full.mp4');
    execFileSync('ffmpeg', [
      '-hide_banner', '-loglevel', 'error', '-y',
      '-f', 'lavfi', '-i', 'testsrc=duration=60:size=640x360:rate=10',
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p',
      '-movflags', '+faststart',
      full,
    ]);
    const { size } = statSync(full);
    const video = makeVideo(dir, 'trunc', Math.floor(size * 0.4));

    // durationSec deliberately overstates the playable content, as ffprobe
    // does for a truncated file whose moov header survived.
    await generateThumbnails(1, 'ab'.repeat(20), video, 60, 'h264', null);

    expect(rows.length).toBeGreaterThanOrEqual(1);
    for (const r of rows) {
      expect(r.frame_index).toBeGreaterThanOrEqual(0);
      expect(r.frame_index).toBeLessThan(8);
      expect(statSync(r.file_path).size).toBeGreaterThan(0);
    }
    const idx = rows.map((r) => r.frame_index);
    expect([...idx].sort((a, b) => a - b)).toEqual(idx);
  }, 120_000);

  it('still throws when nothing is decodable', async () => {
    const dead = join(dir, 'dead.mp4');
    execFileSync('ffmpeg', [
      '-hide_banner', '-loglevel', 'error', '-y',
      '-f', 'lavfi', '-i', 'testsrc=duration=5:size=160x90:rate=5',
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p',
      dead,
    ]);
    // Destroy the header too — no moov, nothing decodable at any seek.
    execFileSync('truncate', ['-s', '100', dead]);

    await expect(
      generateThumbnails(2, 'cd'.repeat(20), dead, 5, 'h264', null)
    ).rejects.toThrow(/no thumbnails/);
    expect(rows.length).toBe(0);
  }, 120_000);
});
