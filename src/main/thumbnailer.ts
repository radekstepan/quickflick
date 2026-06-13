import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, rm } from 'node:fs/promises';
import { join, basename } from 'node:path';
import { getThumbsDir, insertThumbnails } from './db';
import type { Thumbnail } from '../shared/types';

const FRAME_COUNT = 8;
const TARGET_WIDTH = 320;
const TIMEOUT_MS = 15_000;

function hashPath(p: string): string {
  return createHash('sha1').update(p).digest('hex').slice(0, 16);
}

export function thumbsDirFor(videoPath: string): string {
  return join(getThumbsDir(), hashPath(videoPath));
}

export interface ExtractOptions {
  onFrameWritten?: (index: number, timeOffset: number) => void;
}

function codecFamily(codec: string | null | undefined): 'hevc' | 'h264' | 'other' {
  if (!codec) return 'other';
  const c = codec.toLowerCase();
  if (c === 'hevc' || c === 'h265') return 'hevc';
  if (c === 'h264' || c === 'avc' || c === 'avc1') return 'h264';
  return 'other';
}

function buildArgs(videoPath: string, interval: number, codec: string | null): string[] {
  const outPattern = join(thumbsDirFor(videoPath), 'thumb_%03d.jpg');
  const family = codecFamily(codec);
  const useVT = process.platform === 'darwin' && (family === 'hevc' || family === 'h264');

  if (useVT) {
    const decoder = family === 'hevc' ? 'hevc_videotoolbox' : 'h264_videotoolbox';
    return [
      '-nostdin',
      '-hide_banner',
      '-loglevel', 'error',
      '-y',
      '-ss', '0',
      '-c:v', decoder,
      '-i', videoPath,
      '-vf', `fps=1/${interval.toFixed(3)},scale_vt=${TARGET_WIDTH}:-2`,
      '-frames:v', String(FRAME_COUNT),
      '-vsync', 'vfr',
      '-q:v', '2',
      outPattern
    ];
  }

  return [
    '-nostdin',
    '-hide_banner',
    '-loglevel', 'error',
    '-y',
    '-ss', '0',
    '-i', videoPath,
    '-vf', `fps=1/${interval.toFixed(3)},scale=${TARGET_WIDTH}:-2`,
    '-frames:v', String(FRAME_COUNT),
    '-vsync', 'vfr',
    '-q:v', '2',
    outPattern
  ];
}

export async function generateThumbnails(
  videoId: number,
  videoPath: string,
  durationSec: number,
  codec: string | null,
  onProgress?: (i: number) => void
): Promise<void> {
  const outDir = thumbsDirFor(videoPath);
  await rm(outDir, { recursive: true, force: true });
  await mkdir(outDir, { recursive: true });

  const interval = Math.max(durationSec / FRAME_COUNT, 0.05);

  let args: string[];
  try {
    args = buildArgs(videoPath, interval, codec);
  } catch (e) {
    throw new Error(`failed to build ffmpeg args: ${String(e)}`);
  }

  let exitCode: number | null = null;
  let stderrTail = '';
  let timedOut = false;

  await new Promise<void>((resolve) => {
    let child;
    try {
      child = spawn('ffmpeg', args, { stdio: ['ignore', 'ignore', 'pipe'] });
    } catch (e) {
      stderrTail = String(e);
      resolve();
      return;
    }

    let stderr = '';
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, TIMEOUT_MS);

    child.stderr?.on('data', (d) => { stderr += d.toString(); });
    child.on('error', (e) => {
      clearTimeout(timer);
      exitCode = -1;
      stderrTail = String(e);
      resolve();
    });
    child.on('exit', (code) => {
      clearTimeout(timer);
      exitCode = code;
      const tail = stderr.slice(-500);
      if (timedOut) {
        stderrTail = `ffmpeg timed out after ${TIMEOUT_MS}ms (exit ${code}, last stderr: ${tail || 'empty'})`;
      } else {
        stderrTail = tail;
      }
      resolve();
    });
  });

  // Always inspect what ffmpeg actually wrote, even if it errored.
  // Many ffmpeg failures (codec, output path, muxer) still leave valid files behind.
  const { readdir } = await import('node:fs/promises');
  let files: string[];
  try {
    files = (await readdir(outDir))
      .filter((f) => f.endsWith('.jpg'))
      .sort();
  } catch {
    files = [];
  }

  if (files.length === 0) {
    throw new Error(
      `ffmpeg produced no thumbnails (exit ${exitCode ?? 'n/a'})${stderrTail ? ': ' + stderrTail : ''}`
    );
  }

  if (files.length < FRAME_COUNT || exitCode !== 0) {
    console.warn(
      `[thumbnail] ${basename(videoPath)}: ${files.length}/${FRAME_COUNT} frames (exit ${exitCode ?? 'n/a'})`
    );
  }

  const rows: Omit<Thumbnail, 'id'>[] = files.map((f, idx) => ({
    video_id: videoId,
    frame_index: idx,
    time_offset: idx * interval,
    file_path: join(outDir, f)
  }));

  insertThumbnails(rows);
  onProgress?.(rows.length);
}

export function frameCount(): number {
  return FRAME_COUNT;
}

// Convert an absolute thumbnail file path to a qfthumb:// URL for the renderer.
// The path is something like <userData>/thumbs/<hash>/thumb_001.jpg
export function thumbUrl(absPath: string, thumbsDir: string): string {
  let rel: string;
  if (absPath.startsWith(thumbsDir)) {
    rel = absPath.slice(thumbsDir.length);
  } else {
    rel = '/' + absPath.split('/').pop()!;
  }
  rel = rel.replace(/^\/+/, '');
  return `qfthumb://localhost/${encodeURI(rel)}`;
}
