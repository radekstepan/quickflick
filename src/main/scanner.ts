import { readdir, stat, realpath } from 'node:fs/promises';
import { join, basename, dirname, extname } from 'node:path';
import { homedir } from 'node:os';
import {
  getLibrary,
  listAllVideos,
  removeStaleVideos,
  upsertVideo,
  getVideoById,
  getVideoByPath,
  getThumbsDir,
  getThumbsForVideo
} from './db';
import { probeVideo } from './probe';
import { generateThumbnails, thumbUrl } from './thumbnailer';
import { Queue } from './queue';
import type { ScanProgress, ScanResult, Video, VideoWithThumbs } from '../shared/types';

const VIDEO_EXTS = new Set([
  '.mov', '.mp4', '.mkv', '.webm', '.m4v', '.avi', '.flv',
  '.wmv', '.mpg', '.mpeg', '.3gp', '.m2ts', '.ts', '.hevc'
]);

// Matches a video token followed by -, ., [, ], or end-of-name.
// Catches scene-release names like "foo.mp4-WRB[XC]" where the trailing
// ext isn't a video one but the file is still a video.
const VIDEO_NAME_RE = /\.(mov|mp4|mkv|webm|m4v|avi|flv|wmv|mpg|mpeg|3gp|m2ts|ts|hevc)(?:[-.[\]]|$)/i;

function isVideoFile(name: string): boolean {
  if (VIDEO_EXTS.has(extname(name).toLowerCase())) return true;
  return VIDEO_NAME_RE.test(name);
}

type ProgressFn = (p: ScanProgress) => void;

async function walk(root: string, onFile: (abs: string) => Promise<void>, onProgress?: (count: number) => void): Promise<number> {
  let count = 0;
  const stack: string[] = [root];
  while (stack.length > 0) {
    const dir = stack.pop()!;
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      const abs = join(dir, entry.name);
      if (entry.isDirectory()) {
        stack.push(abs);
      } else if (entry.isFile()) {
        if (isVideoFile(entry.name)) {
          await onFile(abs);
          count++;
          if (onProgress && count % 25 === 0) onProgress(count);
        }
      }
    }
  }
  return count;
}

export async function scanLibrary(
  progress: ProgressFn,
  onVideosDiscovered: (rows: VideoWithThumbs[]) => void = () => {},
  onVideoThumbed: (row: VideoWithThumbs) => void = () => {}
): Promise<ScanResult> {
  const root = getLibrary();
  if (!root) {
    throw new Error('No library folder set');
  }

  let realRoot: string;
  try {
    realRoot = await realpath(root);
  } catch {
    realRoot = root;
  }

  progress({ phase: 'walking', processed: 0, total: 0 });

  const found = new Map<string, { size: number; mtime_ms: number; folder: string; filename: string }>();
  let walked = 0;
  const total = await walk(realRoot, async (abs) => {
    try {
      const st = await stat(abs);
      const folder = dirname(abs);
      const filename = basename(abs);
      found.set(abs, {
        size: st.size,
        mtime_ms: Math.floor(st.mtimeMs),
        folder,
        filename
      });
    } catch {
      // ignore files we can't stat
    }
  }, (c) => {
    walked = c;
    progress({ phase: 'walking', processed: c, total: 0 });
  });

  progress({ phase: 'walking', processed: walked, total });

  // Reconcile DB
  const validPaths = new Set(found.keys());
  const removed = removeStaleVideos(validPaths);

  // Upsert all + collect (id, path) for thumbnail work
  const existing = new Map<string, Video>();
  for (const v of listAllVideos()) existing.set(v.path, v);

  let added = 0;
  let updated = 0;
  const thumbQueue = new Queue(2);
  let enqueued = 0;
  let processed = 0;
  const thumbsDir = getThumbsDir();

  const discovered: VideoWithThumbs[] = [];

  for (const [path, meta] of found) {
    const prev = existing.get(path);
    const needsUpdate =
      !prev ||
      prev.size !== meta.size ||
      prev.mtime_ms !== meta.mtime_ms ||
      prev.duration == null;

    const id = upsertVideo({
      path,
      folder: meta.folder,
      filename: meta.filename,
      size: meta.size,
      mtime_ms: meta.mtime_ms,
      duration: prev?.duration ?? null,
      width: prev?.width ?? null,
      height: prev?.height ?? null
    });

    if (!prev) added++;
    else if (needsUpdate) updated++;

    if (needsUpdate) {
      enqueued++;
      const inserted = getVideoById(id);
      if (inserted) {
        discovered.push({ ...inserted, thumbnails: [] });
      }
      void thumbQueue.add(async () => {
        processed++;
        try {
          const probe = await probeVideo(path);
          if (!probe.hasVideo) {
            return;
          }
          // update duration/dims
          const v = getVideoByPath(path);
          if (v) {
            upsertVideo({
              path: v.path,
              folder: v.folder,
              filename: v.filename,
              size: v.size,
              mtime_ms: v.mtime_ms,
              duration: probe.duration,
              width: probe.width,
              height: probe.height
            });
          }
          if (probe.duration && probe.duration > 0) {
            await generateThumbnails(id, path, probe.duration, (i) => {
              progress({
                phase: 'thumbnailing',
                processed: processed,
                total: enqueued,
                currentFile: path,
                queueDepth: thumbQueue.pending
              });
            });
          }
        } catch (e) {
          console.error('[thumbnail] failed for', path, e);
        }
        progress({
          phase: 'thumbnailing',
          processed,
          total: enqueued,
          currentFile: path,
          queueDepth: thumbQueue.pending
        });
        const finalV = getVideoById(id);
        if (finalV) {
          const thumbs = getThumbsForVideo(id).map((t) => ({
            ...t,
            url: thumbUrl(t.file_path, thumbsDir)
          }));
          onVideoThumbed({ ...finalV, thumbnails: thumbs });
        }
      });
    }
  }

  if (discovered.length > 0) {
    onVideosDiscovered(discovered);
  }

  await thumbQueue.drain();

  progress({ phase: 'done', processed: enqueued, total: enqueued });

  const totalVideos = found.size;
  return { added, updated, removed, total: totalVideos };
}

export async function pickInitialFolder(): Promise<string | null> {
  return homedir();
}
