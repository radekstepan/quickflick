import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, rm } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { getThumbsDir, insertThumbnails, getThumbsForVideo } from './db';
import type { Thumbnail } from '../shared/types';

const FRAME_COUNT = 8;
const TARGET_WIDTH = 320;

function hashPath(p: string): string {
  return createHash('sha1').update(p).digest('hex').slice(0, 16);
}

export function thumbsDirFor(videoPath: string): string {
  return join(getThumbsDir(), hashPath(videoPath));
}

export interface ExtractOptions {
  onFrameWritten?: (index: number, timeOffset: number) => void;
}

export async function generateThumbnails(
  videoId: number,
  videoPath: string,
  durationSec: number,
  onProgress?: (i: number) => void
): Promise<void> {
  const outDir = thumbsDirFor(videoPath);
  await rm(outDir, { recursive: true, force: true });
  await mkdir(outDir, { recursive: true });

  // Skip very short videos that won't yield 8 distinct frames; still try.
  const interval = Math.max(durationSec / FRAME_COUNT, 0.05);

  // Output pattern with frame number; we compute time_offset in code.
  const outPattern = join(outDir, 'thumb_%03d.jpg');

  const args = [
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

  await new Promise<void>((resolve, reject) => {
    let child;
    try {
      child = spawn('ffmpeg', args, { stdio: ['ignore', 'ignore', 'pipe'] });
    } catch (e) {
      reject(e);
      return;
    }

    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error('ffmpeg timed out'));
    }, 60_000);

    child.stderr?.on('data', (d) => { stderr += d.toString(); });
    child.on('error', (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on('exit', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg exited ${code}: ${stderr.slice(-500)}`));
    });
  });

  // Read the produced files; filenames will be thumb_001.jpg .. thumb_NNN.jpg
  const { readdir } = await import('node:fs/promises');
  let files: string[];
  try {
    files = (await readdir(outDir))
      .filter((f) => f.endsWith('.jpg'))
      .sort();
  } catch {
    files = [];
  }

  const rows: Omit<Thumbnail, 'id'>[] = files.map((f, idx) => ({
    video_id: videoId,
    frame_index: idx,
    time_offset: idx * interval,
    file_path: join(outDir, f)
  }));

  if (rows.length === 0) {
    throw new Error('No thumbnails produced');
  }

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
