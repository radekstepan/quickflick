import Database from 'better-sqlite3';
import { app } from 'electron';
import { join } from 'node:path';
import { mkdirSync, readdirSync, rmSync } from 'node:fs';
import { thumbsDirFor } from './thumbnailer';
import type { Video, Thumbnail, VideoWithThumbs, SortKey } from '../shared/types';

export type ThumbStatus = 'pending' | 'ok' | 'failed';

let db: Database.Database | null = null;

export function getDbPath(): string {
  const dir = app.getPath('userData');
  mkdirSync(dir, { recursive: true });
  return join(dir, 'cache.db');
}

export function getThumbsDir(): string {
  // macOS: ~/Library/Caches/QuickFlick (no space in path; conventional cache location).
  // Auto-cleaned by macOS under disk pressure — perfect for regenerable thumbnails.
  const dir = app.getPath('cache' as 'userData');
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function initDb(): void {
  const dbPath = getDbPath();
  db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('foreign_keys = ON');

  db.exec(`
    CREATE TABLE IF NOT EXISTS videos (
      id          INTEGER PRIMARY KEY,
      path        TEXT UNIQUE NOT NULL,
      folder      TEXT NOT NULL,
      filename    TEXT NOT NULL,
      size        INTEGER NOT NULL,
      mtime_ms    INTEGER NOT NULL,
      duration    REAL,
      width       INTEGER,
      height      INTEGER,
      scanned_at  INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_videos_folder   ON videos(folder);
    CREATE INDEX IF NOT EXISTS idx_videos_filename ON videos(filename);

    CREATE TABLE IF NOT EXISTS thumbnails (
      id          INTEGER PRIMARY KEY,
      video_id    INTEGER NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
      frame_index INTEGER NOT NULL,
      time_offset REAL    NOT NULL,
      file_path   TEXT    NOT NULL,
      UNIQUE(video_id, frame_index)
    );
    CREATE INDEX IF NOT EXISTS idx_thumbnails_video ON thumbnails(video_id);

    CREATE TABLE IF NOT EXISTS library_roots (
      path     TEXT PRIMARY KEY,
      added_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS video_tags (
      video_id   INTEGER NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
      tag_name   TEXT    NOT NULL,
      created_at INTEGER NOT NULL,
      PRIMARY KEY (video_id, tag_name)
    );
    CREATE INDEX IF NOT EXISTS idx_video_tags_name ON video_tags(tag_name);

    CREATE TABLE IF NOT EXISTS video_excluded_tags (
      video_id   INTEGER NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
      tag_name   TEXT    NOT NULL,
      created_at INTEGER NOT NULL,
      PRIMARY KEY (video_id, tag_name)
    );
    CREATE INDEX IF NOT EXISTS idx_video_excluded_tags_name ON video_excluded_tags(tag_name);

    CREATE TABLE IF NOT EXISTS kv (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);

  // Migrate legacy single-library kv entry into library_roots.
  const rootCount = (db.prepare('SELECT COUNT(*) AS c FROM library_roots').get() as { c: number }).c;
  if (rootCount === 0) {
    const legacy = db
      .prepare("SELECT value FROM kv WHERE key = 'library'")
      .get() as { value: string } | undefined;
    if (legacy?.value) {
      db.prepare('INSERT OR IGNORE INTO library_roots(path, added_at) VALUES (?, ?)').run(
        legacy.value,
        Date.now()
      );
      db.prepare("DELETE FROM kv WHERE key = 'library'").run();
    }
  }

  // Add per-video thumb tracking columns if missing.
  if (!hasColumn(db, 'videos', 'codec')) {
    db.exec('ALTER TABLE videos ADD COLUMN codec TEXT');
  }
  if (!hasColumn(db, 'videos', 'thumb_status')) {
    db.exec("ALTER TABLE videos ADD COLUMN thumb_status TEXT NOT NULL DEFAULT 'pending'");
  }
  if (!hasColumn(db, 'videos', 'view_count')) {
    db.exec('ALTER TABLE videos ADD COLUMN view_count INTEGER NOT NULL DEFAULT 0');
  }
}

function hasColumn(db: Database.Database, table: string, column: string): boolean {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  return rows.some((r) => r.name === column);
}

export function closeDb(): void {
  if (db) {
    db.close();
    db = null;
  }
}

function getDb(): Database.Database {
  if (!db) throw new Error('DB not initialized');
  return db;
}

export function listRoots(): string[] {
  const rows = getDb()
    .prepare('SELECT path FROM library_roots ORDER BY added_at, path')
    .all() as { path: string }[];
  return rows.map((r) => r.path);
}

export function addRoot(path: string): void {
  getDb()
    .prepare('INSERT OR IGNORE INTO library_roots(path, added_at) VALUES (?, ?)')
    .run(path, Date.now());
}

export function removeRoot(path: string): void {
  getDb().prepare('DELETE FROM library_roots WHERE path = ?').run(path);
}

export function countVideosByRoot(root: string): number {
  const row = getDb()
    .prepare("SELECT COUNT(*) AS c FROM videos WHERE folder = ? OR folder LIKE ? || '/%'")
    .get(root, root) as { c: number };
  return row.c;
}

export function removeVideosByRoot(root: string): { removed: number; paths: string[] } {
  const rows = getDb()
    .prepare("SELECT id, path FROM videos WHERE folder = ? OR folder LIKE ? || '/%'")
    .all(root, root) as { id: number; path: string }[];
  if (rows.length === 0) return { removed: 0, paths: [] };
  const tx = getDb().transaction((ids: number[]) => {
    const del = getDb().prepare('DELETE FROM videos WHERE id = ?');
    for (const id of ids) del.run(id);
  });
  tx(rows.map((r) => r.id));
  return { removed: rows.length, paths: rows.map((r) => r.path) };
}

export function removeThumbsForPaths(paths: string[]): number {
  let n = 0;
  for (const p of paths) {
    try {
      rmSync(thumbsDirFor(p), { recursive: true, force: true });
      n++;
    } catch {
      // ignore — best effort cleanup
    }
  }
  return n;
}

export function upsertVideo(
  v: Omit<Video, 'id' | 'scanned_at' | 'thumb_status' | 'view_count'>
): number {
  const stmt = getDb().prepare(`
    INSERT INTO videos (path, folder, filename, size, mtime_ms, duration, width, height, codec, scanned_at)
    VALUES (@path, @folder, @filename, @size, @mtime_ms, @duration, @width, @height, @codec, @scanned_at)
    ON CONFLICT(path) DO UPDATE SET
      folder = excluded.folder,
      filename = excluded.filename,
      size = excluded.size,
      mtime_ms = excluded.mtime_ms,
      duration = excluded.duration,
      width = excluded.width,
      height = excluded.height,
      codec = excluded.codec,
      scanned_at = excluded.scanned_at,
      thumb_status = CASE
        WHEN videos.size != excluded.size
          OR videos.mtime_ms != excluded.mtime_ms
        THEN 'pending'
        ELSE videos.thumb_status
      END
    RETURNING id
  `);
  const row = stmt.get({ ...v, scanned_at: Date.now() }) as { id: number };
  return row.id;
}

export function markThumbStatus(id: number, status: ThumbStatus): void {
  getDb().prepare('UPDATE videos SET thumb_status = ? WHERE id = ?').run(status, id);
}

export function incrementViewCount(id: number): number {
  const row = getDb()
    .prepare('UPDATE videos SET view_count = view_count + 1 WHERE id = ? RETURNING view_count')
    .get(id) as { view_count: number } | undefined;
  return row?.view_count ?? 0;
}

export function resetFailedThumbs(): number {
  const result = getDb()
    .prepare("UPDATE videos SET thumb_status = 'pending' WHERE thumb_status = 'failed'")
    .run();
  return result.changes;
}

export function resetAllThumbs(): { deletedDirs: number; resetRows: number } {
  const dir = getThumbsDir();
  let deletedDirs = 0;
  try {
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const e of entries) {
      if (e.isDirectory()) {
        try {
          rmSync(join(dir, e.name), { recursive: true, force: true });
          deletedDirs++;
        } catch {
          // best effort
        }
      }
    }
  } catch {
    // dir doesn't exist yet — nothing to do
  }
  const result = getDb()
    .prepare("UPDATE videos SET thumb_status = 'pending' WHERE thumb_status != 'pending'")
    .run();
  return { deletedDirs, resetRows: result.changes };
}

export function getVideoById(id: number): Video | null {
  const row = getDb().prepare('SELECT * FROM videos WHERE id = ?').get(id) as Video | undefined;
  return row ?? null;
}

export function getVideoByPath(path: string): Video | null {
  const row = getDb().prepare('SELECT * FROM videos WHERE path = ?').get(path) as Video | undefined;
  return row ?? null;
}

export function listVideosInFolder(folder: string): Video[] {
  return getDb()
    .prepare('SELECT * FROM videos WHERE folder = ? OR folder LIKE ? ORDER BY filename')
    .all(folder, `${folder}/%`) as Video[];
}

export function listAllVideos(): Video[] {
  return getDb().prepare('SELECT * FROM videos ORDER BY filename').all() as Video[];
}

export function listAllFolders(): string[] {
  const rows = getDb()
    .prepare("SELECT DISTINCT folder FROM videos ORDER BY folder")
    .all() as { folder: string }[];
  return rows.map((r) => r.folder);
}

export function listVideos(opts: { folder?: string; search?: string; sort?: SortKey } = {}): VideoWithThumbs[] {
  const sort = opts.sort ?? 'name';
  const sortCol = {
    name: 'filename',
    mtime: 'mtime_ms',
    mtime_asc: 'mtime_ms',
    size: 'size',
    duration: 'duration',
    viewCount: 'view_count',
    viewCount_asc: 'view_count'
  }[sort];
  const sortDir = sort === 'mtime_asc' || sort === 'viewCount_asc' ? 'ASC' : 'DESC';

  const where: string[] = [];
  const params: Record<string, unknown> = {};

  if (opts.folder) {
    where.push('(folder = @folder OR folder LIKE @folderPrefix)');
    params['folder'] = opts.folder;
    params['folderPrefix'] = `${opts.folder}/%`;
  }
  if (opts.search && opts.search.trim()) {
    where.push('LOWER(filename) LIKE @search');
    params['search'] = `%${opts.search.trim().toLowerCase()}%`;
  }

  const whereClause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const rows = getDb()
    .prepare(`SELECT * FROM videos ${whereClause} ORDER BY ${sortCol} ${sortDir} NULLS LAST`)
    .all(params) as Video[];

  if (rows.length === 0) return [];

  const ids = rows.map((r) => r.id);
  const placeholders = ids.map(() => '?').join(',');
  const thumbs = getDb()
    .prepare(`SELECT * FROM thumbnails WHERE video_id IN (${placeholders}) ORDER BY video_id, frame_index`)
    .all(...ids) as Thumbnail[];

  const byVideo = new Map<number, Thumbnail[]>();
  for (const t of thumbs) {
    const arr = byVideo.get(t.video_id) ?? [];
    arr.push(t);
    byVideo.set(t.video_id, arr);
  }

  const tagRows = getDb()
    .prepare(
      `SELECT video_id, tag_name FROM video_tags WHERE video_id IN (${placeholders}) ORDER BY tag_name`
    )
    .all(...ids) as { video_id: number; tag_name: string }[];

  const tagsByVideo = new Map<number, string[]>();
  for (const t of tagRows) {
    const arr = tagsByVideo.get(t.video_id) ?? [];
    arr.push(t.tag_name);
    tagsByVideo.set(t.video_id, arr);
  }

  const excludedRows = getDb()
    .prepare(
      `SELECT video_id, tag_name FROM video_excluded_tags WHERE video_id IN (${placeholders}) ORDER BY tag_name`
    )
    .all(...ids) as { video_id: number; tag_name: string }[];

  const excludedByVideo = new Map<number, string[]>();
  for (const t of excludedRows) {
    const arr = excludedByVideo.get(t.video_id) ?? [];
    arr.push(t.tag_name);
    excludedByVideo.set(t.video_id, arr);
  }

  return rows.map((v) => ({
    ...v,
    thumbnails: byVideo.get(v.id) ?? [],
    tags: tagsByVideo.get(v.id) ?? [],
    excludedTags: excludedByVideo.get(v.id) ?? []
  }));
}

export function removeStaleVideos(validPaths: Set<string>): number {
  const all = getDb().prepare('SELECT id, path FROM videos').all() as { id: number; path: string }[];
  const toRemove = all.filter((r) => !validPaths.has(r.path));
  if (toRemove.length === 0) return 0;
  const stmt = getDb().prepare('DELETE FROM videos WHERE id = ?');
  const tx = getDb().transaction((ids: number[]) => {
    for (const id of ids) stmt.run(id);
  });
  tx(toRemove.map((r) => r.id));
  return toRemove.length;
}

export function insertThumbnails(rows: Omit<Thumbnail, 'id'>[]): void {
  if (rows.length === 0) return;
  const stmt = getDb().prepare(`
    INSERT INTO thumbnails (video_id, frame_index, time_offset, file_path)
    VALUES (@video_id, @frame_index, @time_offset, @file_path)
    ON CONFLICT(video_id, frame_index) DO UPDATE SET
      time_offset = excluded.time_offset,
      file_path = excluded.file_path
  `);
  const tx = getDb().transaction((batch: Omit<Thumbnail, 'id'>[]) => {
    for (const r of batch) stmt.run(r);
  });
  tx(rows);
}

export function deleteThumbnailsForVideo(videoId: number): number {
  const result = getDb()
    .prepare('DELETE FROM thumbnails WHERE video_id = ?')
    .run(videoId);
  return result.changes;
}

export function getThumbsForVideo(videoId: number): Thumbnail[] {
  return getDb()
    .prepare('SELECT * FROM thumbnails WHERE video_id = ? ORDER BY frame_index')
    .all(videoId) as Thumbnail[];
}

export function setVideoTag(videoId: number, tagName: string): void {
  const db = getDb();
  const tx = db.transaction((id: number, name: string) => {
    db.prepare(
      `INSERT INTO video_tags (video_id, tag_name, created_at)
       VALUES (?, ?, ?)
       ON CONFLICT(video_id, tag_name) DO NOTHING`
    ).run(id, name, Date.now());
    db.prepare('DELETE FROM video_excluded_tags WHERE video_id = ? AND tag_name = ?').run(id, name);
  });
  tx(videoId, tagName);
}

export function removeVideoTag(videoId: number, tagName: string): void {
  const db = getDb();
  const exists = db
    .prepare('SELECT 1 AS x FROM video_tags WHERE video_id = ? AND tag_name = ?')
    .get(videoId, tagName) as { x: number } | undefined;
  if (exists) {
    db.prepare('DELETE FROM video_tags WHERE video_id = ? AND tag_name = ?').run(videoId, tagName);
  } else {
    db.prepare(
      `INSERT INTO video_excluded_tags (video_id, tag_name, created_at)
       VALUES (?, ?, ?)
       ON CONFLICT(video_id, tag_name) DO NOTHING`
    ).run(videoId, tagName, Date.now());
  }
}

export function setVideoExclusion(videoId: number, tagName: string): void {
  getDb()
    .prepare(
      `INSERT INTO video_excluded_tags (video_id, tag_name, created_at)
       VALUES (?, ?, ?)
       ON CONFLICT(video_id, tag_name) DO NOTHING`
    )
    .run(videoId, tagName, Date.now());
}

export function removeVideoExclusion(videoId: number, tagName: string): void {
  getDb()
    .prepare('DELETE FROM video_excluded_tags WHERE video_id = ? AND tag_name = ?')
    .run(videoId, tagName);
}

export function getTagsForVideo(videoId: number): string[] {
  return (
    getDb()
      .prepare('SELECT tag_name FROM video_tags WHERE video_id = ? ORDER BY tag_name')
      .all(videoId) as { tag_name: string }[]
  ).map((r) => r.tag_name);
}

export function getAllUserTagNames(): string[] {
  return (
    getDb()
      .prepare('SELECT DISTINCT tag_name FROM video_tags ORDER BY tag_name')
      .all() as { tag_name: string }[]
  ).map((r) => r.tag_name);
}
