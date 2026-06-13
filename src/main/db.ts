import Database from 'better-sqlite3';
import { app } from 'electron';
import { join } from 'node:path';
import { mkdirSync } from 'node:fs';
import type { Video, Thumbnail, VideoWithThumbs, SortKey } from '../shared/types';

let db: Database.Database | null = null;

export function getDbPath(): string {
  const dir = app.getPath('userData');
  mkdirSync(dir, { recursive: true });
  return join(dir, 'cache.db');
}

export function getThumbsDir(): string {
  const dir = join(app.getPath('userData'), 'thumbs');
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

    CREATE TABLE IF NOT EXISTS kv (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);
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

export function getLibrary(): string | null {
  const row = getDb().prepare("SELECT value FROM kv WHERE key = 'library'").get() as { value: string } | undefined;
  return row?.value ?? null;
}

export function setLibrary(path: string): void {
  getDb()
    .prepare("INSERT INTO kv(key, value) VALUES('library', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
    .run(path);
}

export function upsertVideo(v: Omit<Video, 'id' | 'scanned_at'>): number {
  const stmt = getDb().prepare(`
    INSERT INTO videos (path, folder, filename, size, mtime_ms, duration, width, height, scanned_at)
    VALUES (@path, @folder, @filename, @size, @mtime_ms, @duration, @width, @height, @scanned_at)
    ON CONFLICT(path) DO UPDATE SET
      folder = excluded.folder,
      filename = excluded.filename,
      size = excluded.size,
      mtime_ms = excluded.mtime_ms,
      duration = excluded.duration,
      width = excluded.width,
      height = excluded.height,
      scanned_at = excluded.scanned_at
    RETURNING id
  `);
  const row = stmt.get({ ...v, scanned_at: Date.now() }) as { id: number };
  return row.id;
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
    size: 'size',
    duration: 'duration'
  }[sort];
  const sortDir = sort === 'mtime' ? 'DESC' : 'ASC';

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

  return rows.map((v) => ({ ...v, thumbnails: byVideo.get(v.id) ?? [] }));
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

export function getThumbsForVideo(videoId: number): Thumbnail[] {
  return getDb()
    .prepare('SELECT * FROM thumbnails WHERE video_id = ? ORDER BY frame_index')
    .all(videoId) as Thumbnail[];
}
