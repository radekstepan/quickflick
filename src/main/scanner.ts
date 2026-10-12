import { readdir, rmdir, stat, realpath, access } from 'node:fs/promises';
import { join, basename, dirname, extname } from 'node:path';
import { homedir } from 'node:os';
import {
  listRoots,
  listAllVideos,
  markThumbStatus,
  removeStaleVideos,
  insertVideo,
  migrateVideoPath,
  refreshVideoScan,
  deleteVideo,
  setContentFingerprint,
  setProbeMetadata,
  getVideoByPath,
  getVideoById,
  getVideoWithRelations,
  getThumbsDir,
  getThumbsForVideo,
  getTagsForVideo,
  getExclusionsForVideo,
  setVideoTag,
  setVideoExclusion,
  copyTagsAndExclusions
} from './db';
import { probeVideo } from './probe';
import { generateThumbnails, thumbUrl, cacheBustThumbUrl, frameCount } from './thumbnailer';
import { computeFingerprint } from './hasher';
import { Queue } from './queue';
import type {
  ScanProgress,
  ScanResult,
  ThumbnailFailure,
  VideoBase,
  VideoWithThumbs
} from '../shared/types';

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

async function walk(
  root: string,
  onFile: (abs: string) => Promise<void>,
  onProgress?: (count: number) => void,
  visitedDirs?: Set<string>
): Promise<{ count: number; visitedDirs: Set<string> }> {
  let count = 0;
  const visited = visitedDirs ?? new Set<string>();
  const stack: string[] = [root];
  visited.add(root);
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
        visited.add(abs);
      } else if (entry.isFile()) {
        if (isVideoFile(entry.name)) {
          await onFile(abs);
          count++;
          if (onProgress && count % 25 === 0) onProgress(count);
        }
      }
    }
  }
  return { count, visitedDirs: visited };
}

// Remove any directory in `visited` that has zero entries. Sort deepest
// first so leaves go before their parents — otherwise rmdir would fail
// with ENOTEMPTY. Entries in `protect` are never removed (used to keep
// registered library roots intact even if the user empties them).
export async function pruneEmptyDirs(
  visited: Set<string>,
  protect: Set<string>
): Promise<number> {
  const sorted = Array.from(visited).sort((a, b) => b.length - a.length);
  let removed = 0;
  for (const dir of sorted) {
    if (protect.has(dir)) continue;
    let entries: string[];
    try {
      entries = await readdir(dir);
    } catch {
      // unreadable / vanished — leave it alone
      continue;
    }
    if (entries.length > 0) continue;
    try {
      await rmdir(dir);
      removed++;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.warn(`[prune] failed to remove empty dir ${dir}: ${msg}`);
    }
  }
  return removed;
}

interface FoundMeta {
  size: number;
  mtime_ms: number;
  folder: string;
  filename: string;
}

interface ReconcileOutcome {
  id: number;
  fingerprint: string | null;
  needsThumb: boolean;
  // For UI bookkeeping: was this a brand-new row, a move, a refresh, or a
  // stale-and-replace? "skipped" means a duplicate of an already-handled
  // fingerprint (e.g. the user has the same content in two library roots).
  kind: 'added' | 'moved' | 'refreshed' | 'replaced' | 'skipped';
  // Filesystem path that was the source for this outcome — used for
  // progress reporting and discovered/thumbed callbacks.
  path: string;
}

export async function scanLibrary(
  progress: ProgressFn,
  onVideosDiscovered: (rows: VideoWithThumbs[]) => void = () => {},
  onVideoThumbed: (row: VideoWithThumbs) => void = () => {}
): Promise<ScanResult> {
  const roots = listRoots();
  if (roots.length === 0) {
    progress({ phase: 'done', processed: 0, total: 0 });
    return { added: 0, updated: 0, removed: 0, total: 0, failedThumbnails: [] as ThumbnailFailure[], prunedFolders: 0 };
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

  const found = new Map<string, FoundMeta>();
  const visitedDirs = new Set<string>();
  let walked = 0;
  for (const realRoot of realRoots) {
    const { count } = await walk(realRoot, async (abs) => {
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
    }, visitedDirs);
    walked = count;
  }

  const total = found.size;
  progress({ phase: 'walking', processed: walked, total });

  // After the walk, sweep up directories that contain no entries (often
  // left behind when the user removes the last video in a folder). Roots
  // are protected so the user must remove them explicitly via the UI.
  const prunedFolders = await pruneEmptyDirs(visitedDirs, new Set(realRoots));
  if (prunedFolders > 0) {
    console.log(`[scan] pruned ${prunedFolders} empty folder(s)`);
  }

  const validPaths = new Set(found.keys());

  // Build in-memory indexes of the current DB state. We mutate the
  // fingerprint index lazily as we backfill NULL fingerprints during
  // the reconcile pass.
  const byPath = new Map<string, VideoBase>();
  const byFingerprint = new Map<string, VideoBase>();
  for (const v of listAllVideos()) {
    byPath.set(v.path, v);
    if (v.content_fingerprint) byFingerprint.set(v.content_fingerprint, v);
  }

  let added = 0;
  let updated = 0;
  const thumbQueue = new Queue(2);
  let enqueued = 0;
  let processed = 0;
  const thumbsDir = getThumbsDir();
  const failedThumbnails: ThumbnailFailure[] = [];
  const discovered: VideoWithThumbs[] = [];
  const outcomes: ReconcileOutcome[] = [];

  for (const [path, meta] of found) {
    const outcome = await _reconcile({
      path,
      meta,
      byPath,
      byFingerprint
    });
    outcomes.push(outcome);

    if (outcome.kind === 'added') added++;
    else if (outcome.kind === 'moved' || outcome.kind === 'replaced') updated++;

    if (outcome.needsThumb) {
      enqueued++;
      const inserted = getVideoWithRelations(outcome.id);
      if (inserted) {
        discovered.push(inserted);
      }
      const fingerprint = outcome.fingerprint;
      const id = outcome.id;
      const filePath = path;
      void thumbQueue.add(async () => {
        processed++;
        let thumbOk = false;
        let probedCodec: string | null = null;
        let probedTag: string | null = null;
        try {
          const probe = await probeVideo(filePath);
          if (!probe.hasVideo) {
            markThumbStatus(id, 'failed');
            failedThumbnails.push({
              path: filePath,
              codec: probe.codecName,
              codecTag: probe.codecTag,
              decodersTried: [],
              error: 'ffprobe found no video stream',
              attempts: []
            });
            return;
          }
          probedCodec = probe.codecName;
          probedTag = probe.codecTag;
          setProbeMetadata(id, {
            duration: probe.duration,
            width: probe.width,
            height: probe.height,
            codec: probe.codecName
          });
          const safeDuration = probe.duration && probe.duration > 0 ? probe.duration : 60;
          if (!fingerprint) {
            throw new Error('cannot generate thumbnails without a content fingerprint');
          }
          await generateThumbnails(
            id,
            fingerprint,
            filePath,
            safeDuration,
            probedCodec,
            probedTag,
            () => {
              progress({
                phase: 'thumbnailing',
                processed,
                total: enqueued,
                currentFile: filePath,
                queueDepth: thumbQueue.pending
              });
            }
          );
          markThumbStatus(id, 'ok');
          thumbOk = true;
        } catch (e) {
          const message = e instanceof Error ? e.message : String(e);
          console.error('[thumbnail] failed for', filePath, message);
          markThumbStatus(id, 'failed');
          const attempts =
            (e as Error & { attempts?: { label: string; error: string }[] }).attempts ?? [];
          const decodersTried = attempts.length
            ? attempts.map((a) => a.label)
            : extractDecodersTried(message);
          failedThumbnails.push({
            path: filePath,
            codec: probedCodec,
            codecTag: probedTag,
            decodersTried,
            error: message,
            attempts
          });
        }
        progress({
          phase: 'thumbnailing',
          processed,
          total: enqueued,
          currentFile: filePath,
          queueDepth: thumbQueue.pending
        });
        if (thumbOk) {
          const finalV = getVideoWithRelations(id);
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

  // RemoveStale runs AFTER reconcile: by then, any row whose content is
  // still on disk has either been refreshed in place or migrated to its
  // current path. Rows whose path is not in `validPaths` are genuinely
  // orphaned.
  const removed = removeStaleVideos(validPaths);

  if (discovered.length > 0) {
    onVideosDiscovered(discovered);
  }

  const missingThumbs = outcomes.filter((o) => o.needsThumb).length;
  if (missingThumbs > 0) {
    console.log(`[scan] ${missingThumbs} video(s) queued for thumbnailing`);
  }

  await thumbQueue.drain();

  progress({ phase: 'done', processed: enqueued, total: enqueued });

  const totalVideos = found.size;
  return { added, updated, removed, total: totalVideos, failedThumbnails, prunedFolders };
}

interface ReconcileInput {
  path: string;
  meta: FoundMeta;
  byPath: Map<string, VideoBase>;
  byFingerprint: Map<string, VideoBase>;
}

export type { ReconcileInput };

// Reconcile a single found file against the DB. Returns the row id to use
// for subsequent thumbnail work and bookkeeping. Mutates byPath/byFingerprint
// in place as it backfills NULL fingerprints.
//
// Exported (with a `_` prefix) so tests can exercise the per-file logic
// without spinning up ffmpeg/ffprobe.
export async function _reconcile(input: ReconcileInput): Promise<ReconcileOutcome> {
  const { path, meta, byPath, byFingerprint } = input;
  let prev = byPath.get(path);

  // Compute the content fingerprint. Fast path: if a row already exists
  // at this path with matching size+mtime and a non-null fingerprint,
  // reuse it. Otherwise compute fresh.
  let fingerprint: string | null = null;
  if (
    prev &&
    prev.size === meta.size &&
    prev.mtime_ms === meta.mtime_ms &&
    prev.content_fingerprint
  ) {
    fingerprint = prev.content_fingerprint;
  } else {
    fingerprint = await computeFingerprint(path, meta.size);
    if (!fingerprint) {
      fingerprint = null;
    }
  }

  // Backfill a NULL fingerprint on a pre-migration row. Done unconditionally
  // (regardless of size/mtime match) so the user keeps their view stats,
  // tags, and thumbs even if the file's mtime drifted (clock change, copy
  // from a backup, etc.). Guarded so we never overwrite another row's
  // fingerprint — if a different row already owns this fingerprint, the
  // move branch below will migrate that row here and drop the
  // pre-migration row.
  if (prev && prev.content_fingerprint == null && fingerprint) {
    if (!byFingerprint.has(fingerprint)) {
      setContentFingerprint(prev.id, fingerprint);
      prev = { ...prev, content_fingerprint: fingerprint };
      byFingerprint.set(fingerprint, prev);
    }
  }

  const byFp = fingerprint ? byFingerprint.get(fingerprint) : undefined;

  // Branch 1: refresh — same row, same path, same content.
  if (prev && byFp && prev.id === byFp.id) {
    refreshVideoScan(prev.id, { size: meta.size, mtime_ms: meta.mtime_ms });
    return {
      id: prev.id,
      fingerprint,
      needsThumb: await needsThumbWork(prev.id),
      kind: 'refreshed',
      path
    };
  }

  // Branch 2: move — same content lives at a different row/path. Migrate
  // the existing row here. If `prev` exists at the new path with a
  // different fingerprint, it's a stale pre-migration row that we drop —
  // but its tags/exclusions belong to this path, so merge them into the
  // survivor first instead of wiping them via CASCADE.
  if (byFp) {
    if (prev && prev.id !== byFp.id) {
      try {
        copyTagsAndExclusions(prev.id, byFp.id);
      } catch {
        // best effort — never fail a scan on tag carry-over
      }
      deleteVideo(prev.id);
    }
    migrateVideoPath(byFp.id, {
      path,
      folder: meta.folder,
      filename: meta.filename,
      size: meta.size,
      mtime_ms: meta.mtime_ms,
      content_fingerprint: fingerprint
    });
    // Reflect the migration in the in-memory indexes.
    byPath.delete(path);
    byPath.set(path, { ...byFp, path, folder: meta.folder, filename: meta.filename });
    // Note: byFingerprint doesn't need updating — the fingerprint key is
    // unchanged.
    return {
      id: byFp.id,
      fingerprint,
      needsThumb: await needsThumbWork(byFp.id),
      kind: 'moved',
      path
    };
  }

  // Branch 3: stale-and-replace — a row exists at this path but its
  // content (fingerprint) is gone (or was never set and the file is
  // now genuinely new). Drop the old row, insert fresh — but carry the
  // user's tags/exclusions over by path so a re-encode/trim doesn't wipe
  // their tagging work (view stats still reset — that's content-specific).
  if (prev) {
    let carriedTags: string[] = [];
    let carriedExcluded: string[] = [];
    try {
      carriedTags = getTagsForVideo(prev.id);
      carriedExcluded = getExclusionsForVideo(prev.id);
    } catch {
      // best effort
    }
    deleteVideo(prev.id);
    byPath.delete(path);
    if (prev.content_fingerprint) byFingerprint.delete(prev.content_fingerprint);
    const id = insertVideo({
      path,
      folder: meta.folder,
      filename: meta.filename,
      size: meta.size,
      mtime_ms: meta.mtime_ms,
      duration: null,
      width: null,
      height: null,
      codec: null,
      content_fingerprint: fingerprint
    });
    for (const t of carriedTags) {
      try {
        setVideoTag(id, t);
      } catch {
        // best effort
      }
    }
    const tagSet = new Set(carriedTags.map((t) => t.toLowerCase()));
    for (const e of carriedExcluded) {
      if (tagSet.has(e.toLowerCase())) continue;
      try {
        setVideoExclusion(id, e);
      } catch {
        // best effort
      }
    }
    const inserted = getVideoByPath(path);
    if (inserted && fingerprint) byFingerprint.set(fingerprint, inserted);
    return { id, fingerprint, needsThumb: true, kind: 'replaced', path };
  }

  // Branch 4: brand-new content. Insert.
  const id = insertVideo({
    path,
    folder: meta.folder,
    filename: meta.filename,
    size: meta.size,
    mtime_ms: meta.mtime_ms,
    duration: null,
    width: null,
    height: null,
    codec: null,
    content_fingerprint: fingerprint
  });
  const inserted = getVideoByPath(path);
  if (inserted && fingerprint) byFingerprint.set(fingerprint, inserted);
  return { id, fingerprint, needsThumb: true, kind: 'added', path };
}

async function needsThumbWork(id: number): Promise<boolean> {
  const v = getVideoById(id);
  if (!v) return true;
  if (v.thumb_status === 'pending' || v.thumb_status === 'failed') return true;
  const thumbs = getThumbsForVideo(id);
  if (thumbs.length < frameCount()) return true;
  for (const t of thumbs) {
    try {
      await access(t.file_path);
    } catch {
      return true;
    }
  }
  return false;
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
