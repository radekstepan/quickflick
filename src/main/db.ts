import Database from 'better-sqlite3';
import { app } from 'electron';
import { join, dirname } from 'node:path';
import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync, unlinkSync } from 'node:fs';
import { thumbsDirFor } from './thumbnailer';
import type { VideoBase, Thumbnail, VideoWithThumbs, SortKey } from '../shared/types';

export type ThumbStatus = 'pending' | 'ok' | 'failed';

const DB_FILENAME = 'library.db';
const LEGACY_DB_FILENAME = 'cache.db';
const BACKUP_RETAIN = 7;

let db: Database.Database | null = null;
let thumbsDirOverride: string | null = null;

export function getDbDir(): string {
  if (!app.isPackaged) {
    return join(process.cwd(), 'db');
  }
  return app.getPath('userData');
}

export function getLegacyDbPath(): string {
  return join(app.getPath('userData'), LEGACY_DB_FILENAME);
}

// One-shot migration: if the new library.db is absent at the target dir but
// the legacy cache.db exists at userData, copy it (and WAL/SHM sidecars) into
// place. Runs once per fresh install of the renamed file. Never deletes the
// source — the user can clean it up manually after verifying.
export function migrateLegacyCacheDb(targetDir: string = getDbDir()): void {
  const target = join(targetDir, DB_FILENAME);
  if (existsSync(target)) return;
  const source = getLegacyDbPath();
  if (!existsSync(source)) return;
  mkdirSync(targetDir, { recursive: true });
  copyDatabaseFile(source, target, LEGACY_DB_FILENAME, DB_FILENAME);
}

function copyDatabaseFile(source: string, target: string, sourceName: string, targetName: string): void {
  // Checkpoint first so the on-disk main file is self-contained. Without
  // this, a WAL-mode DB would be copied without the in-flight WAL writes
  // and the copy would be missing recent data.
  const checkpoint = new Database(source);
  try {
    checkpoint.pragma('wal_checkpoint(TRUNCATE)');
  } finally {
    checkpoint.close();
  }
  copyFileSync(source, target);
  for (const sidecar of [`${sourceName}-wal`, `${sourceName}-shm`]) {
    const src = join(dirname(source), sidecar);
    if (existsSync(src)) {
      const ext = sidecar.slice(sourceName.length + 1);
      copyFileSync(src, join(dirname(target), `${targetName}-${ext}`));
    }
  }
}

export function getDbPath(): string {
  const dir = getDbDir();
  migrateLegacyCacheDb(dir);
  mkdirSync(dir, { recursive: true });
  return join(dir, DB_FILENAME);
}

export function backupCacheDbIfNewDay(dir: string = getDbDir(), now: Date = new Date()): void {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  const today = `${y}-${m}-${day}`;
  const dbPath = join(dir, DB_FILENAME);
  const todayBackup = join(dir, `${today}.${DB_FILENAME}.bak`);

  if (existsSync(todayBackup)) {
    pruneBackups(dir);
    return;
  }
  if (!existsSync(dbPath)) {
    pruneBackups(dir);
    return;
  }

  copyDatabaseFile(dbPath, todayBackup, DB_FILENAME, DB_FILENAME);

  pruneBackups(dir);
}

function pruneBackups(dir: string): void {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  const backups = entries.filter((e) => e.endsWith(`.${DB_FILENAME}.bak`)).sort().reverse();
  for (const old of backups.slice(BACKUP_RETAIN)) {
    try {
      unlinkSync(join(dir, old));
    } catch {
      // best effort
    }
  }
}

export function getThumbsDir(): string {
  if (thumbsDirOverride) return thumbsDirOverride;
  // macOS: ~/Library/Caches/QuickFlick (no space in path; conventional cache location).
  // Auto-cleaned by macOS under disk pressure — perfect for regenerable thumbnails.
  const dir = app.getPath('cache' as 'userData');
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function initDb(opts: { dbPath?: string; thumbsDir?: string } = {}): void {
  if (opts.thumbsDir) thumbsDirOverride = opts.thumbsDir;
  const dbPath = opts.dbPath ?? getDbPath();
  if (!opts.dbPath) {
    backupCacheDbIfNewDay(getDbDir());
  }
  db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('foreign_keys = ON');

  // Create non-videos tables (idempotent).
  db.exec(`
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

  // Bring the videos table to the current schema.
  ensureVideosSchema();

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
}

function ensureVideosSchema(): void {
  if (!hasTable(db!, 'videos')) {
    createVideosTable();
    ensureVideosIndexes();
    return;
  }
  if (hasColumn(db!, 'videos', 'content_fingerprint')) {
    // Already on the new schema. Make sure indexes exist.
    ensureVideosIndexes();
    return;
  }
  // Old schema detected. Backfill any columns that older versions of the
  // app would have added one at a time, then rebuild the table with the
  // current shape (path no longer UNIQUE, content_fingerprint added).
  if (!hasColumn(db!, 'videos', 'codec')) {
    db!.exec('ALTER TABLE videos ADD COLUMN codec TEXT');
  }
  if (!hasColumn(db!, 'videos', 'thumb_status')) {
    db!.exec("ALTER TABLE videos ADD COLUMN thumb_status TEXT NOT NULL DEFAULT 'pending'");
  }
  if (!hasColumn(db!, 'videos', 'view_count')) {
    db!.exec('ALTER TABLE videos ADD COLUMN view_count INTEGER NOT NULL DEFAULT 0');
  }
  if (!hasColumn(db!, 'videos', 'view_time_ms')) {
    db!.exec('ALTER TABLE videos ADD COLUMN view_time_ms INTEGER NOT NULL DEFAULT 0');
  }

  db!.pragma('foreign_keys = OFF');
  const tx = db!.transaction(() => {
    db!.exec('ALTER TABLE videos RENAME TO videos_old');
    createVideosTable();
    db!.exec(`
      INSERT INTO videos (
        id, path, folder, filename, size, mtime_ms, duration, width, height,
        scanned_at, codec, thumb_status, view_count, view_time_ms
      )
      SELECT
        id, path, folder, filename, size, mtime_ms, duration, width, height,
        scanned_at, codec, thumb_status, view_count, view_time_ms
      FROM videos_old
    `);
    db!.exec('DROP TABLE videos_old');
  });
  tx();
  db!.pragma('foreign_keys = ON');
  ensureVideosIndexes();
}

function createVideosTable(): void {
  db!.exec(`
    CREATE TABLE videos (
      id          INTEGER PRIMARY KEY,
      path        TEXT NOT NULL,
      folder      TEXT NOT NULL,
      filename    TEXT NOT NULL,
      size        INTEGER NOT NULL,
      mtime_ms    INTEGER NOT NULL,
      duration    REAL,
      width       INTEGER,
      height      INTEGER,
      scanned_at  INTEGER NOT NULL,
      codec       TEXT,
      thumb_status TEXT NOT NULL DEFAULT 'pending',
      view_count  INTEGER NOT NULL DEFAULT 0,
      view_time_ms INTEGER NOT NULL DEFAULT 0,
      content_fingerprint TEXT
    )
  `);
}

function ensureVideosIndexes(): void {
  db!.exec(`
    CREATE INDEX IF NOT EXISTS idx_videos_folder   ON videos(folder);
    CREATE INDEX IF NOT EXISTS idx_videos_filename ON videos(filename);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_videos_fingerprint
      ON videos(content_fingerprint) WHERE content_fingerprint IS NOT NULL
  `);
}

function hasTable(db: Database.Database, name: string): boolean {
  const row = db
    .prepare("SELECT 1 AS x FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(name) as { x: number } | undefined;
  return row !== undefined;
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

// Insert a brand-new video row. Use this when the scanner encounters content
// that has never been seen before (no row by path, no row by fingerprint).
export function insertVideo(
  v: Omit<VideoBase, 'id' | 'scanned_at' | 'thumb_status' | 'view_count' | 'view_time_ms' | 'content_fingerprint'> & {
    content_fingerprint: string | null;
  }
): number {
  const row = getDb()
    .prepare(`
      INSERT INTO videos (
        path, folder, filename, size, mtime_ms, duration, width, height,
        codec, scanned_at, content_fingerprint
      )
      VALUES (
        @path, @folder, @filename, @size, @mtime_ms, @duration, @width, @height,
        @codec, @scanned_at, @content_fingerprint
      )
      RETURNING id
    `)
    .get({ ...v, scanned_at: Date.now() }) as { id: number };
  return row.id;
}

// Update the mutable fields of an existing video row (path, folder, filename,
// size, mtime_ms, scanned_at, content_fingerprint). Preserves view stats,
// codec, duration, width, height, and thumb_status.
export function migrateVideoPath(
  id: number,
  fields: {
    path: string;
    folder: string;
    filename: string;
    size: number;
    mtime_ms: number;
    content_fingerprint: string | null;
  }
): void {
  getDb()
    .prepare(`
      UPDATE videos
      SET path = @path,
          folder = @folder,
          filename = @filename,
          size = @size,
          mtime_ms = @mtime_ms,
          scanned_at = @scanned_at,
          content_fingerprint = @content_fingerprint
      WHERE id = @id
    `)
    .run({ ...fields, id, scanned_at: Date.now() });
}

// Refresh only the per-scan metadata (size, mtime, scanned_at) when the same
// file content is seen again at the same path. Used for "unchanged" rows.
export function refreshVideoScan(
  id: number,
  fields: { size: number; mtime_ms: number }
): void {
  getDb()
    .prepare('UPDATE videos SET size = ?, mtime_ms = ?, scanned_at = ? WHERE id = ?')
    .run(fields.size, fields.mtime_ms, Date.now(), id);
}

// Set the content fingerprint on a row that was inserted before this
// migration, so future scans can recognise the file across paths.
export function setContentFingerprint(id: number, fingerprint: string | null): void {
  getDb()
    .prepare('UPDATE videos SET content_fingerprint = ? WHERE id = ?')
    .run(fingerprint, id);
}

// Update probed metadata fields (duration, width, height, codec) without
// disturbing view stats or thumb_status. Used after ffprobe runs in the
// scanner.
export function setProbeMetadata(
  id: number,
  fields: { duration: number | null; width: number | null; height: number | null; codec: string | null }
): void {
  getDb()
    .prepare(
      'UPDATE videos SET duration = ?, width = ?, height = ?, codec = ? WHERE id = ?'
    )
    .run(fields.duration, fields.width, fields.height, fields.codec, id);
}

// Delete a video row and its cascaded thumbnails. The on-disk thumb dir is
// NOT cleaned up here (callers can do it via removeThumbsForPaths or leave
// it for macOS cache GC).
export function deleteVideo(id: number): void {
  getDb().prepare('DELETE FROM videos WHERE id = ?').run(id);
}

// Legacy upsert kept for any caller that doesn't have a fingerprint handy.
// Path is no longer UNIQUE in the schema, so this is a plain INSERT (caller
// is responsible for routing to insertVideo / migrateVideoPath as appropriate).
export function upsertVideo(
  v: Omit<VideoBase, 'id' | 'scanned_at' | 'thumb_status' | 'view_count' | 'view_time_ms' | 'content_fingerprint'> & {
    content_fingerprint?: string | null;
  }
): number {
  const row = getDb()
    .prepare(`
      INSERT INTO videos (path, folder, filename, size, mtime_ms, duration, width, height, codec, scanned_at, content_fingerprint)
      VALUES (@path, @folder, @filename, @size, @mtime_ms, @duration, @width, @height, @codec, @scanned_at, @content_fingerprint)
      RETURNING id
    `)
    .get({
      ...v,
      content_fingerprint: v.content_fingerprint ?? null,
      scanned_at: Date.now()
    }) as { id: number };
  return row.id;
}

export function markThumbStatus(id: number, status: ThumbStatus): void {
  getDb().prepare('UPDATE videos SET thumb_status = ? WHERE id = ?').run(status, id);
}

export function recordView(id: number, viewTimeMs: number): { view_count: number; view_time_ms: number } | null {
  const row = getDb()
    .prepare(
      'UPDATE videos SET view_count = view_count + 1, view_time_ms = view_time_ms + ? WHERE id = ? RETURNING view_count, view_time_ms'
    )
    .get(Math.max(0, Math.floor(viewTimeMs)), id) as
    | { view_count: number; view_time_ms: number }
    | undefined;
  return row ?? null;
}

export function getVideoDurationSec(id: number): number | null {
  const row = getDb()
    .prepare('SELECT duration FROM videos WHERE id = ?')
    .get(id) as { duration: number | null } | undefined;
  return row?.duration ?? null;
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

export function getVideoById(id: number): VideoBase | null {
  const row = getDb()
    .prepare('SELECT * FROM videos WHERE id = ?')
    .get(id) as VideoBase | undefined;
  return row ?? null;
}

export function getVideoByPath(path: string): VideoBase | null {
  const row = getDb()
    .prepare('SELECT * FROM videos WHERE path = ?')
    .get(path) as VideoBase | undefined;
  return row ?? null;
}

export function getVideoByFingerprint(fingerprint: string): VideoBase | null {
  const row = getDb()
    .prepare('SELECT * FROM videos WHERE content_fingerprint = ?')
    .get(fingerprint) as VideoBase | undefined;
  return row ?? null;
}

export function getVideoWithRelations(id: number): VideoWithThumbs | null {
  const base = getVideoById(id);
  if (!base) return null;
  return hydrateVideoWithRelations(base);
}

function hydrateVideoWithRelations(base: VideoBase): VideoWithThumbs {
  const tagRows = getDb()
    .prepare('SELECT tag_name FROM video_tags WHERE video_id = ? ORDER BY tag_name')
    .all(base.id) as { tag_name: string }[];
  const excludedRows = getDb()
    .prepare(
      'SELECT tag_name FROM video_excluded_tags WHERE video_id = ? ORDER BY tag_name'
    )
    .all(base.id) as { tag_name: string }[];
  const thumbnails = getThumbsForVideo(base.id);
  return {
    ...base,
    tags: tagRows.map((r) => r.tag_name),
    excludedTags: excludedRows.map((r) => r.tag_name),
    thumbnails
  };
}

export function listVideosInFolder(folder: string): VideoBase[] {
  return getDb()
    .prepare('SELECT * FROM videos WHERE folder = ? OR folder LIKE ? ORDER BY filename')
    .all(folder, `${folder}/%`) as VideoBase[];
}

export function listAllVideos(): VideoBase[] {
  return getDb().prepare('SELECT * FROM videos ORDER BY filename').all() as VideoBase[];
}

export function listAllFolders(): string[] {
  const rows = getDb()
    .prepare("SELECT DISTINCT folder FROM videos ORDER BY folder")
    .all() as { folder: string }[];
  return rows.map((r) => r.folder);
}

export function listVideos(opts: { folder?: string; search?: string; sort?: SortKey } = {}): VideoWithThumbs[] {
  const sort = opts.sort ?? 'name';
  const sortDir = sort === 'mtime_asc' || sort === 'viewCount_asc' || sort === 'popularity_asc' ? 'ASC' : 'DESC';
  const orderClause = (() => {
    switch (sort) {
      case 'name':
        return `ORDER BY filename ${sortDir} NULLS LAST`;
      case 'mtime':
      case 'mtime_asc':
        return `ORDER BY mtime_ms ${sortDir} NULLS LAST`;
      case 'size':
        return `ORDER BY size ${sortDir} NULLS LAST`;
      case 'duration':
        return `ORDER BY duration ${sortDir} NULLS LAST`;
      case 'viewCount':
      case 'viewCount_asc':
        return `ORDER BY view_count ${sortDir} NULLS LAST`;
      case 'popularity':
        return `ORDER BY view_count DESC, view_time_ms DESC NULLS LAST`;
      case 'popularity_asc':
        return `ORDER BY view_count ASC, view_time_ms ASC NULLS LAST`;
    }
  })();

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
    .prepare(`SELECT * FROM videos ${whereClause} ${orderClause}`)
    .all(params) as VideoBase[];

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
  getDb().prepare('DELETE FROM video_excluded_tags WHERE video_id = ? AND tag_name = ?').run(videoId, tagName);
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
