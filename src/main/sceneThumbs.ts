import { spawn } from 'node:child_process';
import { readdir, rm, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { thumbsDirFor, sceneFrameIndex } from './thumbnailer';
import { insertThumbnails, deleteSceneThumbsForVideo } from './db';
import type { Thumbnail } from '../shared/types';
import type { Scene } from './scenedetect';

const TARGET_WIDTH = 320;
const TIMEOUT_MS = 60_000;

export interface ExtractSceneThumbsOptions {
  onProgress?: (i: number, total: number) => void;
}

function sceneMidpoint(scene: Scene): number {
  return (scene.start + scene.end) / 2;
}

function padSceneIndex(i: number, total: number): string {
  const width = String(Math.max(1, total)).length;
  return String(i).padStart(width, '0');
}

interface RunResult {
  files: string[];
  error: string;
  elapsedMs: number;
  args: string[];
}

function buildArgs(videoPath: string, outDir: string, midpoints: number[]): string[] {
  const preInput = ['-nostdin', '-hide_banner', '-loglevel', 'error', '-y'];
  const outputSpecs: string[] = [];
  for (let i = 0; i < midpoints.length; i++) {
    const filename = `scene_${padSceneIndex(i + 1, midpoints.length)}.jpg`;
    outputSpecs.push(
      '-map', `${i}:V:0`,
      '-frames:v', '1',
      '-q:v', '2',
      '-vf', `scale=${TARGET_WIDTH}:-2`,
      join(outDir, filename)
    );
  }
  const args: string[] = [];
  for (let i = 0; i < midpoints.length; i++) {
    if (i === 0) args.push(...preInput);
    args.push('-ss', midpoints[i]!.toFixed(3), '-i', videoPath);
  }
  args.push(...outputSpecs);
  return args;
}

function runFfmpeg(videoPath: string, outDir: string, midpoints: number[]): Promise<RunResult> {
  const args = buildArgs(videoPath, outDir, midpoints);
  const t0 = Date.now();
  return new Promise((resolve) => {
    const child = spawn('ffmpeg', args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    let settled = false;
    const settle = (r: RunResult): void => {
      if (settled) return;
      settled = true;
      resolve(r);
    };
    child.stderr!.on('data', (d: Buffer) => {
      stderr += d.toString();
    });
    child.on('error', (err) => {
      settle({ files: [], error: err.message, elapsedMs: Date.now() - t0, args });
    });
    child.on('exit', async (code) => {
      if (code !== 0) {
        settle({
          files: [],
          error: `exit ${code}: ${stderr.slice(-300)}`,
          elapsedMs: Date.now() - t0,
          args
        });
        return;
      }
      let files: string[] = [];
      try {
        files = (await readdir(outDir))
          .filter((f) => f.startsWith('scene_') && f.endsWith('.jpg'))
          .sort();
      } catch {
        files = [];
      }
      settle({ files, error: '', elapsedMs: Date.now() - t0, args });
    });
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      settle({ files: [], error: 'timeout', elapsedMs: Date.now() - t0, args });
    }, TIMEOUT_MS);
    child.on('exit', () => clearTimeout(timer));
  });
}

export async function extractSceneThumbs(
  videoId: number,
  fingerprint: string,
  videoPath: string,
  scenes: Scene[],
  opts: ExtractSceneThumbsOptions = {}
): Promise<void> {
  if (scenes.length === 0) {
    // No scenes detected — just clear any stale scene thumbs from a
    // previous (different) detection run.
    deleteSceneThumbsForVideo(videoId);
    opts.onProgress?.(0, 0);
    return;
  }

  const outDir = thumbsDirFor(fingerprint);
  // Clean up old scene thumbs (DB rows + files) before extracting. This
  // makes re-detection with a different sample rate replace cleanly.
  const oldRows = deleteSceneThumbsForVideo(videoId);
  await Promise.all(
    oldRows.map(async (row) => {
      try {
        await rm(row.file_path, { force: true });
      } catch {
        // ignore
      }
    })
  );

  // Also clean any orphaned scene_*.jpg files on disk (e.g. left behind by
  // an earlier crash between the file write and the DB insert).
  try {
    const all = await readdir(outDir);
    await Promise.all(
      all
        .filter((f) => f.startsWith('scene_') && f.endsWith('.jpg'))
        .map((f) => rm(join(outDir, f), { force: true }).catch(() => {}))
    );
  } catch {
    // outDir may not exist yet — that's fine
  }

  await mkdir(outDir, { recursive: true });

  const midpoints = scenes.map(sceneMidpoint);
  const result = await runFfmpeg(videoPath, outDir, midpoints);

  if (result.files.length !== scenes.length) {
    const msg = `ffmpeg produced ${result.files.length}/${scenes.length} scene thumbs: ${result.error}`;
    console.warn(`[sceneThumbs] ${videoPath}: ${msg}`);
    throw new Error(msg);
  }

  // Map files back to scenes in order. File names are scene_001.jpg, scene_002.jpg, ...
  const rows: Omit<Thumbnail, 'id'>[] = scenes.map((scene, i) => {
    const fileName = `scene_${padSceneIndex(i + 1, scenes.length)}.jpg`;
    return {
      video_id: videoId,
      frame_index: sceneFrameIndex(i + 1),
      time_offset: sceneMidpoint(scene),
      file_path: join(outDir, fileName),
      kind: 'scene'
    };
  });

  insertThumbnails(rows);
  opts.onProgress?.(rows.length, rows.length);
  console.log(
    `[sceneThumbs] ${videoPath}: wrote ${rows.length} scene frames ` +
    `elapsed=${result.elapsedMs}ms exit=0`
  );
}
