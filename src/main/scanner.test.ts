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
  migrateVideoPath,
  insertThumbnails,
  setContentFingerprint,
  recordView,
  setVideoTag,
  getVideoByPath,
  getVideoById,
  getVideoByFingerprint,
  listAllVideos
} from './db';
import { _reconcile, type ReconcileInput } from './scanner';
import { computeFingerprint } from './hasher';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'qf-scan-'));
  process.env['QF_TEST_USER_DATA'] = dir;
  initDb({ dbPath: join(dir, 'cache.db'), thumbsDir: join(dir, 'thumbs') });
});

afterEach(() => {
  closeDb();
  delete process.env['QF_TEST_USER_DATA'];
  rmSync(dir, { recursive: true, force: true });
});

async function writeVideoFile(absPath: string, content: Buffer, mtimeMs: number): Promise<void> {
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

describe('_reconcile', () => {
  it('inserts a brand-new file', async () => {
    const p = join(dir, 'a.mp4');
    const buf = Buffer.alloc(4096, 0x41);
    await writeVideoFile(p, buf, 1700000000000);
    const fp = await computeFingerprint(p, buf.length);
    const meta = { size: buf.length, mtime_ms: 1700000000000, folder: dir, filename: 'a.mp4' };
    const indexes = buildIndexes();
    const outcome = await _reconcile({ path: p, meta, ...indexes });
    expect(outcome.kind).toBe('added');
    expect(outcome.fingerprint).toBe(fp);
    expect(outcome.needsThumb).toBe(true);
    const inserted = getVideoByPath(p)!;
    expect(inserted).toBeTruthy();
    expect(inserted.content_fingerprint).toBe(fp);
  });

  it('refreshes in place when file is unchanged', async () => {
    const p = join(dir, 'a.mp4');
    const buf = Buffer.alloc(4096, 0x41);
    await writeVideoFile(p, buf, 1700000000000);
    const fp = await computeFingerprint(p, buf.length);
    insertVideo({
      path: p,
      folder: dir,
      filename: 'a.mp4',
      size: buf.length,
      mtime_ms: 1700000000000,
      duration: 30,
      width: 100,
      height: 200,
      codec: 'h264',
      content_fingerprint: fp
    });
    recordView(getVideoByPath(p)!.id, 5_000);

    const meta = { size: buf.length, mtime_ms: 1700000000000, folder: dir, filename: 'a.mp4' };
    const indexes = buildIndexes();
    const outcome = await _reconcile({ path: p, meta, ...indexes });
    expect(outcome.kind).toBe('refreshed');
    expect(outcome.id).toBe(getVideoByPath(p)!.id);
    const after = getVideoById(outcome.id)!;
    expect(after.view_count).toBe(1);
    expect(after.view_time_ms).toBe(5_000);
    expect(after.content_fingerprint).toBe(fp);
  });

  it('backfills a NULL fingerprint on an unchanged row', async () => {
    const p = join(dir, 'a.mp4');
    const buf = Buffer.alloc(4096, 0x41);
    await writeVideoFile(p, buf, 1700000000000);
    const id = insertVideo({
      path: p,
      folder: dir,
      filename: 'a.mp4',
      size: buf.length,
      mtime_ms: 1700000000000,
      duration: null,
      width: null,
      height: null,
      codec: null,
      content_fingerprint: null
    });
    expect(getVideoById(id)?.content_fingerprint).toBeNull();

    const meta = { size: buf.length, mtime_ms: 1700000000000, folder: dir, filename: 'a.mp4' };
    const indexes = buildIndexes();
    const fp = await computeFingerprint(p, buf.length);
    const outcome = await _reconcile({ path: p, meta, ...indexes });
    expect(outcome.kind).toBe('refreshed');
    expect(getVideoById(id)?.content_fingerprint).toBe(fp);
  });

  it('backfills a NULL fingerprint and preserves stats when size or mtime has drifted', async () => {
    const p = join(dir, 'a.mp4');
    const buf = Buffer.alloc(4096, 0x41);
    await writeVideoFile(p, buf, 1700000000000);
    // Pre-migration row with an OLD size/mtime (e.g. the file was touched
    // between the last scan and the upgrade — clock change, copy from a
    // backup, etc.).
    const id = insertVideo({
      path: p,
      folder: dir,
      filename: 'a.mp4',
      size: buf.length - 1, // pretend the DB thinks the file is 1 byte smaller
      mtime_ms: 1699999999000, // and the mtime is 1s earlier
      duration: 42,
      width: 1280,
      height: 720,
      codec: 'h264',
      content_fingerprint: null
    });
    recordView(id, 3_000);
    recordView(id, 2_000);
    setVideoTag(id, 'favorite');

    const fp = await computeFingerprint(p, buf.length);
    const meta = { size: buf.length, mtime_ms: 1700000000000, folder: dir, filename: 'a.mp4' };
    const indexes = buildIndexes();
    const outcome = await _reconcile({ path: p, meta, ...indexes });

    expect(outcome.kind).toBe('refreshed');
    expect(outcome.id).toBe(id);
    const after = getVideoById(id)!;
    expect(after.content_fingerprint).toBe(fp);
    expect(after.size).toBe(buf.length);
    expect(after.mtime_ms).toBe(1700000000000);
    // Stats preserved.
    expect(after.view_count).toBe(2);
    expect(after.view_time_ms).toBe(5_000);
    expect(after.duration).toBe(42);
    expect(after.codec).toBe('h264');
  });

  it('does not backfill when another row already owns the fingerprint', async () => {
    // Pre-migration row at A with NULL fingerprint, and a post-migration
    // row at B with the fingerprint. The move branch should migrate B to
    // A and drop the pre-migration row, rather than the backfill clobbering
    // B's fingerprint.
    const pA = join(dir, 'a.mp4');
    const pB = join(dir, 'b.mp4');
    const buf = Buffer.alloc(4096, 0x41);
    await writeVideoFile(pA, buf, 1700000000000);
    const fp = await computeFingerprint(pA, buf.length);
    // Post-migration row at B (with fingerprint, view stats).
    const bId = insertVideo({
      path: pB,
      folder: dir,
      filename: 'b.mp4',
      size: buf.length,
      mtime_ms: 1700000000000,
      duration: 30,
      width: 100,
      height: 200,
      codec: 'h264',
      content_fingerprint: fp
    });
    recordView(bId, 4_000);
    // Pre-migration row at A (NULL fingerprint, different size/mtime).
    insertVideo({
      path: pA,
      folder: dir,
      filename: 'a.mp4',
      size: 1,
      mtime_ms: 1,
      duration: null,
      width: null,
      height: null,
      codec: null,
      content_fingerprint: null
    });

    const meta = { size: buf.length, mtime_ms: 1700000000000, folder: dir, filename: 'a.mp4' };
    const indexes = buildIndexes();
    const outcome = await _reconcile({ path: pA, meta, ...indexes });
    // Move branch wins: B's row is migrated to A; the pre-migration row
    // is dropped.
    expect(outcome.kind).toBe('moved');
    expect(outcome.id).toBe(bId);
    const moved = getVideoById(bId)!;
    expect(moved.path).toBe(pA);
    expect(moved.view_count).toBe(1);
    expect(moved.view_time_ms).toBe(4_000);
  });

  it('migrates a row when the same content appears at a new path', async () => {
    const { mkdirSync } = await import('node:fs');
    const oldDir = join(dir, 'old');
    const newDir = join(dir, 'new');
    mkdirSync(oldDir, { recursive: true });
    mkdirSync(newDir, { recursive: true });
    const p1 = join(oldDir, 'a.mp4');
    const p2 = join(newDir, 'a.mp4');
    const buf = Buffer.alloc(4096, 0x41);
    await writeVideoFile(p1, buf, 1700000000000);
    const fp = await computeFingerprint(p1, buf.length);
    const oldId = insertVideo({
      path: p1,
      folder: oldDir,
      filename: 'a.mp4',
      size: buf.length,
      mtime_ms: 1700000000000,
      duration: 30,
      width: 100,
      height: 200,
      codec: 'h264',
      content_fingerprint: fp
    });
    recordView(oldId, 7_000);
    setVideoTag(oldId, 'favorite');

    // Now the file lives at p2 only.
    writeFileSync(p2, buf);
    utimesSync(p2, Math.floor(1700000000000 / 1000), (1700000000000 % 1000) * 1_000_000);

    const meta = { size: buf.length, mtime_ms: 1700000000000, folder: newDir, filename: 'a.mp4' };
    const indexes = buildIndexes();
    const outcome = await _reconcile({ path: p2, meta, ...indexes });
    expect(outcome.kind).toBe('moved');
    expect(outcome.id).toBe(oldId);
    expect(outcome.fingerprint).toBe(fp);

    const moved = getVideoById(oldId)!;
    expect(moved.path).toBe(p2);
    expect(moved.folder).toBe(newDir);
    expect(moved.view_count).toBe(1);
    expect(moved.view_time_ms).toBe(7_000);
    expect(getVideoByPath(p1)).toBeNull();
  });

  it('preserves thumbnails across a move (they live at the fingerprint dir)', async () => {
    const oldDir = join(dir, 'old');
    const newDir = join(dir, 'new');
    writeFileSync(oldDir, '', { flag: 'w' }); // placeholder; replaced below
    rmSync(oldDir, { recursive: true, force: true });
    const { mkdirSync } = await import('node:fs');
    mkdirSync(oldDir, { recursive: true });
    mkdirSync(newDir, { recursive: true });
    const p1 = join(oldDir, 'a.mp4');
    const p2 = join(newDir, 'a.mp4');
    const buf = Buffer.alloc(4096, 0x41);
    await writeVideoFile(p1, buf, 1700000000000);
    const fp = await computeFingerprint(p1, buf.length);
    const oldId = insertVideo({
      path: p1,
      folder: oldDir,
      filename: 'a.mp4',
      size: buf.length,
      mtime_ms: 1700000000000,
      duration: 30,
      width: 100,
      height: 200,
      codec: 'h264',
      content_fingerprint: fp
    });
    insertThumbnails(
      Array.from({ length: 8 }, (_, i) => ({
        video_id: oldId,
        frame_index: i,
        time_offset: i,
        file_path: `/thumbs/${fp}/thumb_${String(i + 1).padStart(3, '0')}.jpg`
      }))
    );

    writeFileSync(p2, buf);
    utimesSync(p2, Math.floor(1700000000000 / 1000), (1700000000000 % 1000) * 1_000_000);

    const meta = { size: buf.length, mtime_ms: 1700000000000, folder: newDir, filename: 'a.mp4' };
    const indexes = buildIndexes();
    const outcome = await _reconcile({ path: p2, meta, ...indexes });
    expect(outcome.kind).toBe('moved');
    expect(outcome.id).toBe(oldId);
  });

  it('replaces a row when the file at the same path has different content', async () => {
    const p = join(dir, 'a.mp4');
    const bufOld = Buffer.alloc(4096, 0x41);
    const bufNew = Buffer.alloc(4096, 0x42);
    await writeVideoFile(p, bufOld, 1700000000000);
    const oldFp = await computeFingerprint(p, bufOld.length);
    const oldId = insertVideo({
      path: p,
      folder: dir,
      filename: 'a.mp4',
      size: bufOld.length,
      mtime_ms: 1700000000000,
      duration: 30,
      width: 100,
      height: 200,
      codec: 'h264',
      content_fingerprint: oldFp
    });
    recordView(oldId, 9_000);

    // Replace contents on disk, bump mtime.
    writeFileSync(p, bufNew);
    utimesSync(p, Math.floor(1700000005000 / 1000), (1700000005000 % 1000) * 1_000_000);

    const meta = { size: bufNew.length, mtime_ms: 1700000005000, folder: dir, filename: 'a.mp4' };
    const indexes = buildIndexes();
    const outcome = await _reconcile({ path: p, meta, ...indexes });
    expect(outcome.kind).toBe('replaced');
    // The old row is gone, but SQLite may reuse the id. Verify via
    // state, not id.
    const fresh = getVideoById(outcome.id)!;
    expect(fresh).toBeTruthy();
    expect(fresh.view_count).toBe(0); // stats reset
    expect(fresh.view_time_ms).toBe(0);
    expect(fresh.content_fingerprint).not.toBe(oldFp);
    expect(fresh.content_fingerprint).not.toBeNull();
    // And the old fingerprint no longer maps to any row.
    expect(getVideoByFingerprint(oldFp)).toBeNull();
  });

  it('migrates and drops a stale pre-migration row at the destination', async () => {
    const p = join(dir, 'a.mp4');
    const buf = Buffer.alloc(4096, 0x41);
    await writeVideoFile(p, buf, 1700000000000);
    const fp = await computeFingerprint(p, buf.length);
    // A row at a different path with the same fingerprint (already migrated once).
    const movedId = insertVideo({
      path: join(dir, 'old', 'a.mp4'),
      folder: join(dir, 'old'),
      filename: 'a.mp4',
      size: buf.length,
      mtime_ms: 1700000000000,
      duration: 30,
      width: 100,
      height: 200,
      codec: 'h264',
      content_fingerprint: fp
    });
    // A stale row at the current path with a NULL fingerprint (pre-migration).
    const staleId = insertVideo({
      path: p,
      folder: dir,
      filename: 'a.mp4',
      size: 1,
      mtime_ms: 1,
      duration: null,
      width: null,
      height: null,
      codec: null,
      content_fingerprint: null
    });

    const meta = { size: buf.length, mtime_ms: 1700000000000, folder: dir, filename: 'a.mp4' };
    const indexes = buildIndexes();
    const outcome = await _reconcile({ path: p, meta, ...indexes });
    expect(outcome.kind).toBe('moved');
    expect(outcome.id).toBe(movedId);
    expect(getVideoById(staleId)).toBeNull();
    expect(getVideoById(movedId)?.path).toBe(p);
  });

  it('finds an existing row by fingerprint even with a NULL-fingerprint shadow', async () => {
    const p = join(dir, 'a.mp4');
    const buf = Buffer.alloc(4096, 0x41);
    await writeVideoFile(p, buf, 1700000000000);
    const fp = await computeFingerprint(p, buf.length);
    // Existing row somewhere else with the same content.
    const canonicalId = insertVideo({
      path: join(dir, 'elsewhere', 'a.mp4'),
      folder: join(dir, 'elsewhere'),
      filename: 'a.mp4',
      size: buf.length,
      mtime_ms: 1700000000000,
      duration: 30,
      width: 100,
      height: 200,
      codec: 'h264',
      content_fingerprint: fp
    });
    recordView(canonicalId, 12_000);

    const meta = { size: buf.length, mtime_ms: 1700000000000, folder: dir, filename: 'a.mp4' };
    const indexes = buildIndexes();
    const outcome = await _reconcile({ path: p, meta, ...indexes });
    expect(outcome.kind).toBe('moved');
    expect(outcome.id).toBe(canonicalId);
    const moved = getVideoById(canonicalId)!;
    expect(moved.path).toBe(p);
    expect(moved.view_count).toBe(1);
    expect(moved.view_time_ms).toBe(12_000);
  });

  it('reuses cached fingerprint from the row when size+mtime are unchanged', async () => {
    const p = join(dir, 'a.mp4');
    const buf = Buffer.alloc(4096, 0x41);
    await writeVideoFile(p, buf, 1700000000000);
    // Pre-insert a row with a "stamped" fingerprint. If the scanner
    // doesn't honor the cache, the actual computeFingerprint would yield
    // a different hash and we'd land in a different branch.
    const stampedFp = 'stamped-fp-1234';
    const id = insertVideo({
      path: p,
      folder: dir,
      filename: 'a.mp4',
      size: buf.length,
      mtime_ms: 1700000000000,
      duration: null,
      width: null,
      height: null,
      codec: null,
      content_fingerprint: stampedFp
    });
    const meta = { size: buf.length, mtime_ms: 1700000000000, folder: dir, filename: 'a.mp4' };
    const indexes = buildIndexes();
    const outcome = await _reconcile({ path: p, meta, ...indexes });
    expect(outcome.kind).toBe('refreshed');
    expect(outcome.fingerprint).toBe(stampedFp);
    expect(getVideoById(id)?.content_fingerprint).toBe(stampedFp);
  });

  it('drops stale pre-migration rows in byFingerprint when replaced', async () => {
    const p = join(dir, 'a.mp4');
    const buf = Buffer.alloc(4096, 0x41);
    await writeVideoFile(p, buf, 1700000000000);
    const fp = await computeFingerprint(p, buf.length);
    // Pre-existing row with NULL fingerprint and old size/mtime.
    insertVideo({
      path: p,
      folder: dir,
      filename: 'a.mp4',
      size: 1,
      mtime_ms: 1,
      duration: null,
      width: null,
      height: null,
      codec: null,
      content_fingerprint: null
    });
    // ... and a row at another path with this fingerprint (representing
    // the same content as we're about to find on disk).
    insertVideo({
      path: join(dir, 'elsewhere', 'a.mp4'),
      folder: join(dir, 'elsewhere'),
      filename: 'a.mp4',
      size: buf.length,
      mtime_ms: 1700000000000,
      duration: 30,
      width: 100,
      height: 200,
      codec: 'h264',
      content_fingerprint: fp
    });

    const meta = { size: buf.length, mtime_ms: 1700000000000, folder: dir, filename: 'a.mp4' };
    const indexes = buildIndexes();
    const outcome = await _reconcile({ path: p, meta, ...indexes });
    expect(outcome.kind).toBe('moved');
    expect(getVideoByFingerprint(fp)?.path).toBe(p);
  });
});
