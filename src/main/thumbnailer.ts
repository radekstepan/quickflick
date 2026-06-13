import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, rm, readdir } from 'node:fs/promises';
import { join, basename } from 'node:path';
import { getThumbsDir, insertThumbnails } from './db';
import { codecFamily, type CodecFamily } from './probe';
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

interface Candidate {
  label: string;
  args: string[];
}

function buildCandidates(
  videoPath: string,
  family: CodecFamily,
  interval: number
): Candidate[] {
  const outPattern = join(thumbsDirFor(videoPath), 'thumb_%03d.jpg');
  const isMac = process.platform === 'darwin';
  const candidates: Candidate[] = [];
  const seen = new Set<string>();

  function add(label: string, args: string[]): void {
    if (seen.has(label)) return;
    seen.add(label);
    candidates.push({ label, args });
  }

  const fps = `fps=1/${interval.toFixed(3)}`;
  const swFilter = `${fps},scale=${TARGET_WIDTH}:-2`;
  const vtFilter = `${fps},scale_vt=${TARGET_WIDTH}:-2`;

  function swArgs(decoder: string | null): string[] {
    const a = [
      '-nostdin',
      '-hide_banner',
      '-loglevel', 'error',
      '-y',
      '-ss', '0'
    ];
    if (decoder) a.push('-c:v', decoder);
    a.push('-i', videoPath, '-map', '0:V:0', '-vf', swFilter, '-frames:v', String(FRAME_COUNT), '-vsync', '1', '-q:v', '2', outPattern);
    return a;
  }

  function vtArgs(decoder: 'hevc_videotoolbox' | 'h264_videotoolbox'): string[] {
    return [
      '-nostdin',
      '-hide_banner',
      '-loglevel', 'error',
      '-y',
      '-ss', '0',
      '-c:v', decoder,
      '-i', videoPath,
      '-map', '0:V:0',
      '-vf', vtFilter,
      '-frames:v', String(FRAME_COUNT),
      '-vsync', '1',
      '-q:v', '2',
      outPattern
    ];
  }

  // Candidates are emitted unconditionally; ffmpeg will fail fast with
  // "Decoder not found" (~100ms) if a specific decoder isn't compiled in,
  // and the next candidate takes over. We do NOT gate on `available` because
  // a misparsed decoder list would otherwise produce zero candidates and
  // break thumbnail generation for files that ffmpeg can clearly handle.

  // 1) Primary path based on detected family.
  if (family === 'hevc') {
    if (isMac) {
      add('hevc_videotoolbox+scale_vt', vtArgs('hevc_videotoolbox'));
    } else {
      add('hevc+scale', swArgs('hevc'));
    }
  } else if (family === 'h264') {
    if (isMac) add('h264_videotoolbox+scale_vt', vtArgs('h264_videotoolbox'));
    add('h264+scale', swArgs('h264'));
  } else if (family === 'av1') {
    add('av1+scale', swArgs('av1'));
    if (isMac) add('hevc_videotoolbox+scale_vt', vtArgs('hevc_videotoolbox'));
  } else {
    // 2) Unknown codec: try defaults then last-resort VT guesses.
    add('auto+scale', swArgs(null));
    if (isMac) add('hevc_videotoolbox+scale_vt', vtArgs('hevc_videotoolbox'));
    if (isMac) add('h264_videotoolbox+scale_vt', vtArgs('h264_videotoolbox'));
  }

  return candidates;
}

interface RunResult {
  files: string[];
  error: string;
  timedOut: boolean;
}

async function runFfmpeg(args: string[], outDir: string): Promise<RunResult> {
  let exitCode: number | null = null;
  let stderr = '';
  let timedOut = false;
  let spawnErr: string | null = null;

  await new Promise<void>((resolve) => {
    let child;
    try {
      child = spawn('ffmpeg', args, { stdio: ['ignore', 'ignore', 'pipe'] });
    } catch (e) {
      spawnErr = String(e);
      resolve();
      return;
    }

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, TIMEOUT_MS);

    child.stderr?.on('data', (d) => { stderr += d.toString(); });
    child.on('error', (e) => {
      clearTimeout(timer);
      spawnErr = String(e);
      resolve();
    });
    child.on('exit', (code) => {
      clearTimeout(timer);
      exitCode = code;
      resolve();
    });
  });

  let files: string[] = [];
  try {
    files = (await readdir(outDir))
      .filter((f) => f.endsWith('.jpg'))
      .sort();
  } catch {
    files = [];
  }

  const tail = stderr.slice(-500);
  let error: string;
  if (spawnErr) {
    error = `spawn failed: ${spawnErr}`;
  } else if (timedOut) {
    error = `timed out after ${TIMEOUT_MS}ms (exit ${exitCode}, stderr: ${tail || 'empty'})`;
  } else {
    error = `exit ${exitCode ?? 'n/a'}${tail ? `: ${tail}` : ''}`;
  }

  return { files, error, timedOut };
}

export async function generateThumbnails(
  videoId: number,
  videoPath: string,
  durationSec: number,
  codec: string | null,
  codecTag: string | null,
  onProgress?: (i: number) => void
): Promise<void> {
  const outDir = thumbsDirFor(videoPath);
  await rm(outDir, { recursive: true, force: true });
  await mkdir(outDir, { recursive: true });

  const interval = Math.max(durationSec / FRAME_COUNT, 0.05);

  const family = codecFamily(codec, codecTag);
  const candidates = buildCandidates(videoPath, family, interval);

  if (candidates.length === 0) {
    throw new Error(
      `no ffmpeg decode candidates for codec=${codec ?? '?'}/${codecTag ?? '?'} on ${process.platform}`
    );
  }

  const attempts: { label: string; error: string; files: number }[] = [];
  for (const c of candidates) {
    const result = await runFfmpeg(c.args, outDir);
    if (result.files.length > 0) {
      if (result.files.length < FRAME_COUNT) {
        console.warn(
          `[thumbnail] ${basename(videoPath)}: ${result.files.length}/${FRAME_COUNT} frames via ${c.label}`
        );
      }
      const rows: Omit<Thumbnail, 'id'>[] = result.files.map((f, idx) => ({
        video_id: videoId,
        frame_index: idx,
        time_offset: idx * interval,
        file_path: join(outDir, f)
      }));
      insertThumbnails(rows);
      onProgress?.(rows.length);
      return;
    }
    attempts.push({ label: c.label, error: result.error, files: result.files.length });
  }

  const summary = attempts
    .map((a) => `${a.label} (${a.error})`)
    .join(' | ');
  const err: Error & { attempts?: { label: string; error: string }[] } = new Error(
    `ffmpeg produced no thumbnails (codec=${codec ?? '?'}/${codecTag ?? '?'}, tried ${attempts.length}: ${summary})`
  );
  err.attempts = attempts.map((a) => ({ label: a.label, error: a.error }));
  throw err;
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

// Append a cache-busting query string so the browser refetches when the thumb
// is regenerated (scanned_at advances on each upsert).
export function cacheBustThumbUrl(url: string, scannedAt: number): string {
  return `${url}?v=${scannedAt}`;
}
