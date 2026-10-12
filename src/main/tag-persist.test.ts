// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

vi.mock('electron', () => ({
  app: {
    getPath: (_name: string) => process.env['QF_TEST_USER_DATA'] ?? '/tmp'
  }
}));

import {
  initDb,
  closeDb,
  insertVideo,
  setVideoTag,
  setVideoExclusion,
  getTagsForVideo,
  getExclusionsForVideo,
  getVideoByPath,
  listAllVideos
} from './db';
import { _reconcile } from './scanner';
import { computeFingerprint } from './hasher';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'qf-tagpersist-'));
  process.env['QF_TEST_USER_DATA'] = dir;
  initDb({ dbPath: join(dir, 'cache.db'), thumbsDir: join(dir, 'thumbs') });
});

afterEach(() => {
  closeDb();
  delete process.env['QF_TEST_USER_DATA'];
  rmSync(dir, { recursive: true, force: true });
});

function writeFile(absPath: string, content: Buffer, mtimeMs: number): void {
  writeFileSync(absPath, content);
  const secs = Math.floor(mtimeMs / 1000);
  const ns = (mtimeMs % 1000) * 1_000_000;
  utimesSync(absPath, secs, ns);
}

function buildIndexes() {
  const byPath = new Map();
  const byFingerprint = new Map();
  for (const v of listAllVideos()) {
    byPath.set(v.path, v);
    if (v.content_fingerprint) byFingerprint.set(v.content_fingerprint, v);
  }
  return { byPath, byFingerprint };
}

describe('tag persistence across rescan', () => {
  it('carries tags + exclusions over when file content is replaced at the same path', async () => {
    const p = join(dir, 'clip.mp4');
    const oldBuf = Buffer.alloc(4096, 0x41);
    writeFile(p, oldBuf, 1700000000000);
    const oldFp = await computeFingerprint(p, oldBuf.length);
    const oldId = insertVideo({
      path: p,
      folder: dir,
      filename: 'clip.mp4',
      size: oldBuf.length,
      mtime_ms: 1700000000000,
      duration: null,
      width: null,
      height: null,
      codec: null,
      content_fingerprint: oldFp
    });
    setVideoTag(oldId, 'Favorite');
    setVideoExclusion(oldId, 'Beach');

    // Same path, genuinely new bytes + new mtime.
    const newBuf = Buffer.alloc(4096, 0x42);
    writeFile(p, newBuf, 1800000000000);
    const meta = {
      size: newBuf.length,
      mtime_ms: 1800000000000,
      folder: dir,
      filename: 'clip.mp4'
    };
    const outcome = await _reconcile({ path: p, meta, ...buildIndexes() });

    expect(outcome.kind).toBe('replaced');
    const fresh = getVideoByPath(p)!;
    // Note: SQLite may reuse the row id after DELETE+INSERT, so assert on
    // the new fingerprint + carried tags instead of id inequality.
    expect(fresh.content_fingerprint).not.toBe(oldFp);
    expect(getTagsForVideo(fresh.id)).toEqual(['Favorite']);
    expect(getExclusionsForVideo(fresh.id)).toEqual(['Beach']);
  });

  it('merges the stale destination row tags into the survivor on move', async () => {
    const src = join(dir, 'src.mp4');
    const dst = join(dir, 'dst.mp4');
    const buf = Buffer.alloc(4096, 0x43);
    writeFile(src, buf, 1700000000000);
    writeFile(dst, buf, 1700000000000);
    const fp = await computeFingerprint(src, buf.length);

    const survivor = insertVideo({
      path: src,
      folder: dir,
      filename: 'src.mp4',
      size: buf.length,
      mtime_ms: 1700000000000,
      duration: null,
      width: null,
      height: null,
      codec: null,
      content_fingerprint: fp
    });
    setVideoTag(survivor, 'Survivor Tag');

    // Stale pre-migration row sitting at the destination path.
    const stale = insertVideo({
      path: dst,
      folder: dir,
      filename: 'dst.mp4',
      size: buf.length,
      mtime_ms: 1700000000000,
      duration: null,
      width: null,
      height: null,
      codec: null,
      content_fingerprint: null
    });
    setVideoTag(stale, 'Stale Tag');

    const meta = { size: buf.length, mtime_ms: 1700000000000, folder: dir, filename: 'dst.mp4' };
    const outcome = await _reconcile({ path: dst, meta, ...buildIndexes() });

    expect(outcome.kind).toBe('moved');
    expect(outcome.id).toBe(survivor);
    expect(getTagsForVideo(survivor).sort()).toEqual(['Stale Tag', 'Survivor Tag']);
    expect(getVideoByPath(dst)?.id).toBe(survivor);
  });
});
