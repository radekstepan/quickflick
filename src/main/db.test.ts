// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';

vi.mock('electron', () => ({
  app: {
    isPackaged: true,
    getPath: (_name: string) => process.env['QF_TEST_USER_DATA'] ?? '/tmp'
  }
}));

import {
  initDb,
  closeDb,
  insertVideo,
  migrateVideoPath,
  deleteVideo,
  getVideoByPath,
  getVideoByFingerprint,
  getVideoById,
  refreshVideoScan,
  setContentFingerprint,
  recordView,
  setVideoTag,
  removeStaleVideos,
  insertThumbnails,
  getThumbsForVideo,
  backupCacheDbIfNewDay,
  migrateLegacyCacheDb
} from './db';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'qf-db-'));
  process.env['QF_TEST_USER_DATA'] = dir;
  initDb({ dbPath: join(dir, 'cache.db'), thumbsDir: join(dir, 'thumbs') });
});

afterEach(() => {
  closeDb();
  delete process.env['QF_TEST_USER_DATA'];
  rmSync(dir, { recursive: true, force: true });
});

describe('insertVideo / getVideoByPath / getVideoByFingerprint', () => {
  it('inserts a new video and looks it up by path and by fingerprint', () => {
    const id = insertVideo({
      path: '/a/b/c.mp4',
      folder: '/a/b',
      filename: 'c.mp4',
      size: 1000,
      mtime_ms: 1700000000000,
      duration: null,
      width: null,
      height: null,
      codec: null,
      content_fingerprint: 'abc123'
    });
    const byPath = getVideoByPath('/a/b/c.mp4');
    const byFp = getVideoByFingerprint('abc123');
    expect(byPath?.id).toBe(id);
    expect(byPath?.content_fingerprint).toBe('abc123');
    expect(byPath?.view_count).toBe(0);
    expect(byPath?.view_time_ms).toBe(0);
    expect(byPath?.thumb_status).toBe('pending');
    expect(byFp?.id).toBe(id);
  });

  it('enforces UNIQUE on content_fingerprint', () => {
    insertVideo({
      path: '/a/b/c.mp4',
      folder: '/a/b',
      filename: 'c.mp4',
      size: 1000,
      mtime_ms: 1,
      duration: null,
      width: null,
      height: null,
      codec: null,
      content_fingerprint: 'dup'
    });
    expect(() =>
      insertVideo({
        path: '/a/b/d.mp4',
        folder: '/a/b',
        filename: 'd.mp4',
        size: 1000,
        mtime_ms: 1,
        duration: null,
        width: null,
        height: null,
        codec: null,
        content_fingerprint: 'dup'
      })
    ).toThrow();
  });

  it('allows NULL fingerprints and multiple rows with null', () => {
    insertVideo({
      path: '/a/b/c.mp4',
      folder: '/a/b',
      filename: 'c.mp4',
      size: 1000,
      mtime_ms: 1,
      duration: null,
      width: null,
      height: null,
      codec: null,
      content_fingerprint: null
    });
    expect(() =>
      insertVideo({
        path: '/a/b/d.mp4',
        folder: '/a/b',
        filename: 'd.mp4',
        size: 1000,
        mtime_ms: 1,
        duration: null,
        width: null,
        height: null,
        codec: null,
        content_fingerprint: null
      })
    ).not.toThrow();
  });
});

describe('migrateVideoPath', () => {
  it('preserves view_count, view_time_ms, codec, duration, thumb_status', () => {
    const id = insertVideo({
      path: '/a/old.mp4',
      folder: '/a',
      filename: 'old.mp4',
      size: 1000,
      mtime_ms: 1,
      duration: 12.5,
      width: 1920,
      height: 1080,
      codec: 'h264',
      content_fingerprint: 'fp1'
    });
    recordView(id, 5_000);
    recordView(id, 3_000);
    setVideoTag(id, 'favorite');

    migrateVideoPath(id, {
      path: '/b/new.mp4',
      folder: '/b',
      filename: 'new.mp4',
      size: 1000,
      mtime_ms: 2,
      content_fingerprint: 'fp1'
    });

    const updated = getVideoById(id)!;
    expect(updated.path).toBe('/b/new.mp4');
    expect(updated.folder).toBe('/b');
    expect(updated.filename).toBe('new.mp4');
    expect(updated.size).toBe(1000);
    expect(updated.mtime_ms).toBe(2);
    expect(updated.content_fingerprint).toBe('fp1');
    expect(updated.view_count).toBe(2);
    expect(updated.view_time_ms).toBe(8_000);
    expect(updated.duration).toBe(12.5);
    expect(updated.codec).toBe('h264');
    expect(updated.thumb_status).toBe('pending');
  });
});

describe('refreshVideoScan', () => {
  it('updates size, mtime, scanned_at only', () => {
    const id = insertVideo({
      path: '/a/b.mp4',
      folder: '/a',
      filename: 'b.mp4',
      size: 1000,
      mtime_ms: 1,
      duration: 5,
      width: 100,
      height: 200,
      codec: 'h264',
      content_fingerprint: 'fp'
    });
    recordView(id, 1_000);

    refreshVideoScan(id, { size: 2000, mtime_ms: 99 });

    const updated = getVideoById(id)!;
    expect(updated.size).toBe(2000);
    expect(updated.mtime_ms).toBe(99);
    expect(updated.view_count).toBe(1);
    expect(updated.view_time_ms).toBe(1_000);
    expect(updated.codec).toBe('h264');
  });
});

describe('setContentFingerprint', () => {
  it('backfills a NULL fingerprint on an existing row', () => {
    const id = insertVideo({
      path: '/a/b.mp4',
      folder: '/a',
      filename: 'b.mp4',
      size: 1,
      mtime_ms: 1,
      duration: null,
      width: null,
      height: null,
      codec: null,
      content_fingerprint: null
    });
    expect(getVideoById(id)?.content_fingerprint).toBeNull();
    setContentFingerprint(id, 'fp-new');
    expect(getVideoById(id)?.content_fingerprint).toBe('fp-new');
    expect(getVideoByFingerprint('fp-new')?.id).toBe(id);
  });
});

describe('deleteVideo (cascade)', () => {
  it('cascades to thumbnails', () => {
    const id = insertVideo({
      path: '/a/b.mp4',
      folder: '/a',
      filename: 'b.mp4',
      size: 1,
      mtime_ms: 1,
      duration: null,
      width: null,
      height: null,
      codec: null,
      content_fingerprint: 'fp'
    });
    insertThumbnails(
      Array.from({ length: 3 }, (_, i) => ({
        video_id: id,
        frame_index: i,
        time_offset: i,
        file_path: `/thumbs/${id}/${i}.jpg`
      }))
    );
    expect(getThumbsForVideo(id)).toHaveLength(3);
    deleteVideo(id);
    expect(getVideoById(id)).toBeNull();
    expect(getThumbsForVideo(id)).toHaveLength(0);
  });
});

describe('removeStaleVideos', () => {
  it('removes rows whose path is not in validPaths', () => {
    insertVideo({
      path: '/a/keep.mp4',
      folder: '/a',
      filename: 'keep.mp4',
      size: 1,
      mtime_ms: 1,
      duration: null,
      width: null,
      height: null,
      codec: null,
      content_fingerprint: 'k'
    });
    insertVideo({
      path: '/a/gone.mp4',
      folder: '/a',
      filename: 'gone.mp4',
      size: 1,
      mtime_ms: 1,
      duration: null,
      width: null,
      height: null,
      codec: null,
      content_fingerprint: 'g'
    });
    const removed = removeStaleVideos(new Set(['/a/keep.mp4']));
    expect(removed).toBe(1);
    expect(getVideoByPath('/a/keep.mp4')).not.toBeNull();
    expect(getVideoByPath('/a/gone.mp4')).toBeNull();
  });
});

describe('schema migration', () => {
  it('rebuilds an old-schema videos table on init', () => {
    // Simulate an old DB by closing the current DB, opening a fresh one
    // with the old schema, then re-running initDb.
    closeDb();

    const oldPath = join(dir, 'cache.db');
    rmSync(oldPath, { force: true });
    const oldDb = new Database(oldPath);
    oldDb.exec(`
      CREATE TABLE videos (
        id INTEGER PRIMARY KEY,
        path TEXT UNIQUE NOT NULL,
        folder TEXT NOT NULL,
        filename TEXT NOT NULL,
        size INTEGER NOT NULL,
        mtime_ms INTEGER NOT NULL,
        duration REAL,
        width INTEGER,
        height INTEGER,
        scanned_at INTEGER NOT NULL
      );
      INSERT INTO videos (path, folder, filename, size, mtime_ms, scanned_at)
      VALUES ('/old/x.mp4', '/old', 'x.mp4', 999, 12345, 1700000000000);
    `);
    oldDb.close();

    initDb({ dbPath: oldPath, thumbsDir: join(dir, 'thumbs') });

    const migrated = getVideoByPath('/old/x.mp4');
    expect(migrated).not.toBeNull();
    expect(migrated?.size).toBe(999);
    expect(migrated?.mtime_ms).toBe(12345);
    expect(migrated?.content_fingerprint).toBeNull();
    expect(migrated?.view_count).toBe(0);
    expect(migrated?.thumb_status).toBe('pending');

    // Verify UNIQUE on path is gone by inserting a second row at the same
    // path with a NULL fingerprint — should succeed since neither path nor
    // (null) fingerprint has a unique constraint.
    insertVideo({
      path: '/old/x.mp4',
      folder: '/old',
      filename: 'x.mp4',
      size: 100,
      mtime_ms: 12345,
      duration: null,
      width: null,
      height: null,
      codec: null,
      content_fingerprint: null
    });
    expect(getVideoByPath('/old/x.mp4')).not.toBeNull();
  });

  it('backfills stats columns if missing on the old table', () => {
    closeDb();
    const oldPath = join(dir, 'cache.db');
    rmSync(oldPath, { force: true });
    const oldDb = new Database(oldPath);
    oldDb.exec(`
      CREATE TABLE videos (
        id INTEGER PRIMARY KEY,
        path TEXT UNIQUE NOT NULL,
        folder TEXT NOT NULL,
        filename TEXT NOT NULL,
        size INTEGER NOT NULL,
        mtime_ms INTEGER NOT NULL,
        duration REAL,
        width INTEGER,
        height INTEGER,
        scanned_at INTEGER NOT NULL
      );
      INSERT INTO videos (path, folder, filename, size, mtime_ms, scanned_at)
      VALUES ('/old/y.mp4', '/old', 'y.mp4', 100, 1, 2);
    `);
    oldDb.close();

    initDb({ dbPath: oldPath, thumbsDir: join(dir, 'thumbs') });

    const v = getVideoByPath('/old/y.mp4')!;
    expect(v.view_count).toBe(0);
    expect(v.view_time_ms).toBe(0);
    expect(v.thumb_status).toBe('pending');
    expect(v.content_fingerprint).toBeNull();
  });
});

describe('backupCacheDbIfNewDay', () => {
  // Use a dedicated, isolated directory for the backup tests so we don't
  // collide with the `library.db` already created by the outer beforeEach.
  let backupDir: string;

  beforeEach(() => {
    backupDir = mkdtempSync(join(tmpdir(), 'qf-backup-'));
  });

  afterEach(() => {
    rmSync(backupDir, { recursive: true, force: true });
  });

  function seedDb(dir: string): void {
    const db = new Database(join(dir, 'library.db'));
    db.exec('CREATE TABLE t (x INTEGER)');
    db.close();
  }

  it('creates a YYYY-MM-DD.library.db.bak file on first run', () => {
    seedDb(backupDir);
    const noon = new Date(2026, 5, 22, 12, 0, 0); // 2026-06-22 local

    backupCacheDbIfNewDay(backupDir, noon);

    expect(existsSync(join(backupDir, '2026-06-22.library.db.bak'))).toBe(true);
  });

  it('does not create a second backup on the same day', () => {
    seedDb(backupDir);
    const noon = new Date(2026, 5, 22, 12, 0, 0);

    backupCacheDbIfNewDay(backupDir, noon);
    backupCacheDbIfNewDay(backupDir, noon);

    const backups = readdirSync(backupDir).filter((e) => e.endsWith('.library.db.bak'));
    expect(backups).toHaveLength(1);
  });

  it('creates a new backup when the date advances', () => {
    seedDb(backupDir);

    backupCacheDbIfNewDay(backupDir, new Date(2026, 5, 22, 12, 0, 0));
    backupCacheDbIfNewDay(backupDir, new Date(2026, 5, 23, 12, 0, 0));

    expect(existsSync(join(backupDir, '2026-06-22.library.db.bak'))).toBe(true);
    expect(existsSync(join(backupDir, '2026-06-23.library.db.bak'))).toBe(true);
  });

  it('is a no-op when no library.db exists yet', () => {
    expect(() => backupCacheDbIfNewDay(backupDir, new Date(2026, 5, 22))).not.toThrow();
    expect(readdirSync(backupDir).filter((e) => e.endsWith('.library.db.bak'))).toEqual([]);
  });

  it('prunes to the 7 most recent backups', () => {
    seedDb(backupDir);
    // Pre-create 10 fake backups spanning 10 days, oldest first.
    for (let i = 1; i <= 10; i++) {
      const day = String(i).padStart(2, '0');
      writeFileSync(join(backupDir, `2026-06-${day}.library.db.bak`), '');
    }

    backupCacheDbIfNewDay(backupDir, new Date(2026, 5, 22, 12, 0, 0));

    const backups = readdirSync(backupDir)
      .filter((e) => e.endsWith('.library.db.bak'))
      .sort();
    // 7 retained (the 7 newest) + the 4 oldest (06-01..06-04) get deleted.
    expect(backups).toHaveLength(7);
    expect(backups).toEqual([
      '2026-06-05.library.db.bak',
      '2026-06-06.library.db.bak',
      '2026-06-07.library.db.bak',
      '2026-06-08.library.db.bak',
      '2026-06-09.library.db.bak',
      '2026-06-10.library.db.bak',
      '2026-06-22.library.db.bak'
    ]);
  });
});

describe('migrateLegacyCacheDb', () => {
  // The migration copies from userData/cache.db to <target>/library.db.
  // userData is mocked via QF_TEST_USER_DATA at the top of this file. The
  // outer beforeEach opens dir/cache.db in WAL mode, so we close it and
  // remove the file before each test to give this suite a clean slate.
  let targetDir: string;

  beforeEach(() => {
    closeDb();
    for (const ext of ['', '-wal', '-shm']) {
      rmSync(join(dir, `cache.db${ext}`), { force: true });
    }
    targetDir = mkdtempSync(join(tmpdir(), 'qf-migrate-'));
  });

  afterEach(() => {
    rmSync(targetDir, { recursive: true, force: true });
  });

  function seedLegacyDb(userDataDir: string, content = 'legacy'): void {
    const db = new Database(join(userDataDir, 'cache.db'));
    db.exec(`CREATE TABLE legacy_marker (v TEXT); INSERT INTO legacy_marker VALUES ('${content}')`);
    db.pragma('wal_checkpoint(TRUNCATE)');
    db.close();
  }

  function readMarker(dbPath: string, table = 'legacy_marker'): string | null {
    const db = new Database(dbPath, { readonly: true });
    const row = db.prepare(`SELECT v FROM ${table} LIMIT 1`).get() as { v: string } | undefined;
    db.close();
    return row?.v ?? null;
  }

  it('copies userData/cache.db to <target>/library.db when target is missing', () => {
    seedLegacyDb(dir, 'hello-legacy');

    migrateLegacyCacheDb(targetDir);

    const target = join(targetDir, 'library.db');
    expect(existsSync(target)).toBe(true);
    expect(readMarker(target)).toBe('hello-legacy');
  });

  it('is a no-op when the target library.db already exists', () => {
    seedLegacyDb(dir, 'should-be-ignored');
    const target = join(targetDir, 'library.db');
    const fresh = new Database(target);
    fresh.exec(`CREATE TABLE fresh_marker (v TEXT); INSERT INTO fresh_marker VALUES ('fresh-wins')`);
    fresh.close();

    migrateLegacyCacheDb(targetDir);

    expect(readMarker(target, 'fresh_marker')).toBe('fresh-wins');
  });

  it('is a no-op when no legacy cache.db exists', () => {
    expect(() => migrateLegacyCacheDb(targetDir)).not.toThrow();
    expect(existsSync(join(targetDir, 'library.db'))).toBe(false);
  });

  it('leaves the source cache.db untouched', () => {
    seedLegacyDb(dir, 'preserved');
    const sourcePath = join(dir, 'cache.db');

    migrateLegacyCacheDb(targetDir);

    expect(existsSync(sourcePath)).toBe(true);
    expect(readMarker(sourcePath)).toBe('preserved');
  });

  it('copies WAL/SHM sidecars when present', () => {
    // Create a legacy db in WAL mode so it produces -wal / -shm sidecars.
    const db = new Database(join(dir, 'cache.db'));
    db.pragma('journal_mode = WAL');
    db.exec(`CREATE TABLE legacy_marker (v TEXT); INSERT INTO legacy_marker VALUES ('with-wal')`);
    db.pragma('wal_checkpoint(TRUNCATE)');
    db.close();
    // Re-introduce sidecar files so the migration has something to copy.
    writeFileSync(join(dir, 'cache.db-wal'), 'wal-bytes');
    writeFileSync(join(dir, 'cache.db-shm'), 'shm-bytes');

    migrateLegacyCacheDb(targetDir);

    expect(readMarker(join(targetDir, 'library.db'))).toBe('with-wal');
    expect(existsSync(join(targetDir, 'library.db-wal'))).toBe(true);
    expect(existsSync(join(targetDir, 'library.db-shm'))).toBe(true);
  });
});
