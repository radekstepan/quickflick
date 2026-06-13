import { readdir, stat, realpath, access } from 'node:fs/promises';
import { join, basename, dirname, extname } from 'node:path';
import { homedir } from 'node:os';
import {
  listRoots,
  listAllVideos,
  markThumbStatus,
  removeStaleVideos,
  upsertVideo,
  getVideoById,
  getVideoByPath,
  getThumbsDir,
  getThumbsForVideo
} from './db';
import { probeVideo } from './probe';
import { generateThumbnails, thumbUrl, cacheBustThumbUrl } from './thumbnailer';
import { Queue } from './queue';
import type { ScanProgress, ScanResult, ThumbnailFailure, Video, VideoWithThumbs } from '../shared/types';

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
  const roots = listRoots();
  if (roots.length === 0) {
    progress({ phase: 'done', processed: 0, total: 0 });
    return { added: 0, updated: 0, removed: 0, total: 0, failedThumbnails: [] as ThumbnailFailure[] };
  }

  const realRoots: string[] = [];
  for (const r of roots) {
    try {
      realRoots.push(await realpath(r));
    } catch {
      realRoots.push(r);
    }
  }

  progress({ phase: 'walking', processed: 0, total: 0 });

  const found = new Map<string, { size: number; mtime_ms: number; folder: string; filename: string }>();
  let walked = 0;
  for (const realRoot of realRoots) {
    await walk(realRoot, async (abs) => {
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
  }

  const total = found.size;
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
  const failedThumbnails: ThumbnailFailure[] = [];
  let missingThumbs = 0;

  const discovered: VideoWithThumbs[] = [];

  for (const [path, meta] of found) {
    const prev = existing.get(path);
    const fileChanged =
      !prev ||
      prev.size !== meta.size ||
      prev.mtime_ms !== meta.mtime_ms ||
      prev.duration == null;

    let thumbMissing = false;
    if (prev?.thumb_status === 'ok') {
      const thumbs = getThumbsForVideo(prev.id);
      const first = thumbs[0];
      if (!first) {
        thumbMissing = true;
      } else {
        try {
          await access(first.file_path);
        } catch {
          thumbMissing = true;
        }
      }
    }
    if (thumbMissing) missingThumbs++;

    const needsThumb = fileChanged || prev?.thumb_status === 'pending' || thumbMissing;

    const id = upsertVideo({
      path,
      folder: meta.folder,
      filename: meta.filename,
      size: meta.size,
      mtime_ms: meta.mtime_ms,
      duration: prev?.duration ?? null,
      width: prev?.width ?? null,
      height: prev?.height ?? null,
      codec: prev?.codec ?? null
    });

    if (!prev) added++;
    else if (fileChanged) updated++;

    if (needsThumb) {
      enqueued++;
      const inserted = getVideoById(id);
      if (inserted) {
        discovered.push({ ...inserted, thumbnails: [] });
      }
      void thumbQueue.add(async () => {
        processed++;
        let thumbOk = false;
        let probedCodec: string | null = null;
        let probedTag: string | null = null;
        try {
          const probe = await probeVideo(path);
          if (!probe.hasVideo) {
            markThumbStatus(id, 'failed');
            failedThumbnails.push({
              path,
              codec: probe.codecName,
              codecTag: probe.codecTag,
              decodersTried: [],
              error: 'ffprobe found no video stream'
            });
            return;
          }
          probedCodec = probe.codecName;
          probedTag = probe.codecTag;
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
              height: probe.height,
              codec: probe.codecName
            });
          }
          if (probe.duration && probe.duration > 0) {
            await generateThumbnails(
              id,
              path,
              probe.duration,
              probedCodec,
              probedTag,
              () => {
                progress({
                  phase: 'thumbnailing',
                  processed,
                  total: enqueued,
                  currentFile: path,
                  queueDepth: thumbQueue.pending
                });
              }
            );
            markThumbStatus(id, 'ok');
            thumbOk = true;
          }
        } catch (e) {
          const message = e instanceof Error ? e.message : String(e);
          console.error('[thumbnail] failed for', path, message);
          markThumbStatus(id, 'failed');
          const decodersTried = extractDecodersTried(message);
          failedThumbnails.push({
            path,
            codec: probedCodec,
            codecTag: probedTag,
            decodersTried,
            error: message
          });
        }
        progress({
          phase: 'thumbnailing',
          processed,
          total: enqueued,
          currentFile: path,
          queueDepth: thumbQueue.pending
        });
        if (thumbOk) {
          const finalV = getVideoById(id);
          if (finalV) {
            const thumbs = getThumbsForVideo(id).map((t) => ({
              ...t,
              url: cacheBustThumbUrl(thumbUrl(t.file_path, thumbsDir), finalV.scanned_at)
            }));
            onVideoThumbed({ ...finalV, thumbnails: thumbs });
          }
        }
      });
    }
  }

  if (discovered.length > 0) {
    onVideosDiscovered(discovered);
  }

  if (missingThumbs > 0) {
    console.log(`[scan] detected ${missingThumbs} video(s) with missing thumbnails, regenerating`);
  }

  await thumbQueue.drain();

  progress({ phase: 'done', processed: enqueued, total: enqueued });

  const totalVideos = found.size;
  return { added, updated, removed, total: totalVideos, failedThumbnails };
}

export async function pickInitialFolder(): Promise<string | null> {
  return homedir();
}

function extractDecodersTried(message: string): string[] {
  const m = message.match(/tried \d+:\s*(.+?)\)/);
  if (!m) return [];
  return m[1]
    .split('|')
    .map((s) => s.split('(')[0].trim())
    .filter(Boolean);
}
