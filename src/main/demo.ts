import {
  addRoot,
  insertVideo,
  insertThumbnails,
  listAllVideos,
  markThumbStatus,
  recordView,
  setVideoTag
} from './db';
import type { ScanResult } from '../shared/types';

// `yarn dev --demo` boots the app with a fake in-memory library so real
// content (filenames, thumbnails, tags) is never shown — useful for
// screenshots, recordings, and testing on machines without a library.
// Nothing here touches the real database, the real thumbnail cache, or any
// real media file: the DB lives in `:memory:` (see index.ts) and every
// thumbnail `file_path` is a remote Unsplash placeholder URL.

export const DEMO_ROOT_MOVIES = '/Users/demo/Movies';
export const DEMO_ROOT_FAMILY = '/Users/demo/Family';

export const DEMO_TAGS = [
  'Action',
  'Adventure',
  'Animation',
  'Classic',
  'Comedy',
  'Crime',
  'Drama',
  'Family',
  'Horror',
  'Music',
  'Romance',
  'Sci-Fi',
  'Thriller'
] as const;

// Verified (HTTP 200) Unsplash photo IDs, requested as 16:9 crops so they
// look like real extracted thumbnails. Each demo video is assigned 8
// distinct URLs so hover-cycling works.
const UNSPLASH_POOL = [
  'photo-1489599849927-2ee91cede3ba',
  'photo-1478720568477-152d9b164e26',
  'photo-1440404653325-ab127d49abc1',
  'photo-1536440136628-849c177e76a1',
  'photo-1518676590629-3dcbd9c5a5c9',
  'photo-1542204165-65bf26472b9b',
  'photo-1517604931442-7e0c8ed2963c',
  'photo-1524985069026-dd778a71c7b4',
  'photo-1598899134739-24c46f58b8c0',
  'photo-1616530940355-351fabd9524b',
  'photo-1446776811953-b23d57bd21aa',
  'photo-1451187580459-43490279c0fa',
  'photo-1462331940025-496dfbfc7564',
  'photo-1419242902214-272b3f66ee7a',
  'photo-1470071459604-3b5ec3a7fe05',
  'photo-1506905925346-21bda4d32df4',
  'photo-1519681393784-d120267933ba',
  'photo-1477959858617-67f85cf4f1df',
  'photo-1449824913935-59a10b8d2000',
  'photo-1444723121867-7a241cacace9',
  'photo-1502134249126-9f3755a50d78',
  'photo-1444703686981-a3abbc4d4fe3',
  'photo-1465101162946-4377e57745c3',
  'photo-1524712245354-2c4e5e7121c0',
  'photo-1574267432553-4b4628081c31',
  'photo-1512149177596-f817c7ef5d4c',
  'photo-1585951237318-9ea5e175b891'
];

export function demoThumbUrl(photoId: string): string {
  return `https://images.unsplash.com/${photoId}?auto=format&fit=crop&w=480&h=270&q=60`;
}

// 8 distinct placeholder URLs per video, rotating through the pool.
export function demoThumbsForIndex(index: number): string[] {
  const out: string[] = [];
  const start = (index * 8) % UNSPLASH_POOL.length;
  for (let k = 0; k < 8; k++) {
    out.push(demoThumbUrl(UNSPLASH_POOL[(start + k) % UNSPLASH_POOL.length]!));
  }
  return out;
}

export interface DemoMovie {
  title: string;
  year: number;
  /** Runtime in seconds (real-world values). */
  durationSec: number;
  width: number;
  height: number;
  codec: string;
  root: typeof DEMO_ROOT_MOVIES | typeof DEMO_ROOT_FAMILY;
  tags: string[];
  views: number;
}

// Titles are intentionally pairwise-distinct at the bigram level so the
// filename n-gram auto-tagger derives no junk tags — only the explicit
// tags below show up.
export const DEMO_MOVIES: DemoMovie[] = [
  { title: 'The Godfather', year: 1972, durationSec: 10500, width: 1920, height: 1080, codec: 'h264', root: DEMO_ROOT_MOVIES, tags: ['Crime', 'Drama', 'Classic'], views: 0 },
  { title: 'The Dark Knight', year: 2008, durationSec: 9120, width: 3840, height: 2160, codec: 'hevc', root: DEMO_ROOT_MOVIES, tags: ['Action', 'Crime', 'Drama'], views: 12 },
  { title: 'Pulp Fiction', year: 1994, durationSec: 9240, width: 1920, height: 1080, codec: 'h264', root: DEMO_ROOT_MOVIES, tags: ['Crime', 'Drama'], views: 7 },
  { title: 'Inception', year: 2010, durationSec: 8880, width: 1920, height: 1080, codec: 'h264', root: DEMO_ROOT_MOVIES, tags: ['Action', 'Sci-Fi', 'Thriller'], views: 0 },
  { title: 'Interstellar', year: 2014, durationSec: 10140, width: 3840, height: 2160, codec: 'hevc', root: DEMO_ROOT_MOVIES, tags: ['Adventure', 'Drama', 'Sci-Fi'], views: 23 },
  { title: 'Spirited Away', year: 2001, durationSec: 7500, width: 1920, height: 1080, codec: 'h264', root: DEMO_ROOT_FAMILY, tags: ['Animation', 'Adventure', 'Family'], views: 9 },
  { title: 'Toy Story', year: 1995, durationSec: 4860, width: 1920, height: 1080, codec: 'h264', root: DEMO_ROOT_FAMILY, tags: ['Animation', 'Family', 'Comedy'], views: 15 },
  { title: 'Jurassic Park', year: 1993, durationSec: 7620, width: 1920, height: 1080, codec: 'h264', root: DEMO_ROOT_MOVIES, tags: ['Adventure', 'Sci-Fi'], views: 0 },
  { title: 'The Matrix', year: 1999, durationSec: 8160, width: 1920, height: 1080, codec: 'h264', root: DEMO_ROOT_MOVIES, tags: ['Action', 'Sci-Fi'], views: 18 },
  { title: 'Forrest Gump', year: 1994, durationSec: 8520, width: 1920, height: 1080, codec: 'h264', root: DEMO_ROOT_MOVIES, tags: ['Drama', 'Romance'], views: 5 },
  { title: 'Titanic', year: 1997, durationSec: 11640, width: 1920, height: 1080, codec: 'h264', root: DEMO_ROOT_MOVIES, tags: ['Drama', 'Romance'], views: 11 },
  { title: 'Gladiator', year: 2000, durationSec: 9300, width: 1920, height: 1080, codec: 'h264', root: DEMO_ROOT_MOVIES, tags: ['Action', 'Adventure', 'Drama'], views: 3 },
  { title: 'Casablanca', year: 1942, durationSec: 6120, width: 1440, height: 1080, codec: 'h264', root: DEMO_ROOT_MOVIES, tags: ['Drama', 'Romance', 'Classic'], views: 0 },
  { title: 'Psycho', year: 1960, durationSec: 6540, width: 1440, height: 1080, codec: 'h264', root: DEMO_ROOT_MOVIES, tags: ['Horror', 'Thriller', 'Classic'], views: 6 },
  { title: 'Alien', year: 1979, durationSec: 7020, width: 1920, height: 1080, codec: 'h264', root: DEMO_ROOT_MOVIES, tags: ['Horror', 'Sci-Fi'], views: 14 },
  { title: 'Amelie', year: 2001, durationSec: 7320, width: 1920, height: 1080, codec: 'h264', root: DEMO_ROOT_MOVIES, tags: ['Comedy', 'Romance'], views: 4 },
  { title: 'Whiplash', year: 2014, durationSec: 6360, width: 1920, height: 1080, codec: 'h264', root: DEMO_ROOT_MOVIES, tags: ['Drama', 'Music'], views: 8 },
  { title: 'Parasite', year: 2019, durationSec: 7920, width: 3840, height: 2160, codec: 'hevc', root: DEMO_ROOT_MOVIES, tags: ['Drama', 'Thriller'], views: 19 },
  { title: 'Coco', year: 2017, durationSec: 6300, width: 1920, height: 1080, codec: 'h264', root: DEMO_ROOT_FAMILY, tags: ['Animation', 'Family', 'Music'], views: 21 },
  { title: 'The Lion King', year: 1994, durationSec: 5280, width: 1920, height: 1080, codec: 'h264', root: DEMO_ROOT_FAMILY, tags: ['Animation', 'Family', 'Classic'], views: 2 }
];

const DAY_MS = 24 * 60 * 60 * 1000;

// Day offsets from "today" per (index % 10). Covers every date bucket the
// UI groups by: Today, Yesterday, This week, This month, Older.
const MTIME_DAY_OFFSETS = [0, 1, 3, 5, 12, 20, 45, 90, 200, 400];

// Deterministic mtime for a demo row. Day-granular (plus a per-index
// intra-day jitter) so the "newest"/"oldest" date groups always light up.
export function demoMtimeForIndex(index: number, now: number = Date.now()): number {
  const d = new Date(now);
  const startOfToday = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const dayOffset = MTIME_DAY_OFFSETS[index % MTIME_DAY_OFFSETS.length]!;
  if (dayOffset === 0) {
    // An hour ago — still today except in the first hour after midnight,
    // where we clamp to just after midnight (still today).
    if (now - startOfToday > 3600_000) return now - 3600_000;
    return startOfToday + Math.max(60_000, now - startOfToday - 60_000);
  }
  const jitter = (index * 7 * 3600_000) % (12 * 3600_000);
  return startOfToday - dayOffset * DAY_MS + jitter;
}

export function demoSizeForIndex(durationSec: number, index: number): number {
  return Math.round(durationSec * (200_000 + ((index * 53_000) % 120_000)));
}

export function isDemoMode(
  argv: ReadonlyArray<string> = process.argv,
  env: NodeJS.ProcessEnv = process.env
): boolean {
  const flag = env['QF_DEMO'];
  if (flag === '1' || flag?.toLowerCase() === 'true') return true;
  return argv.includes('--demo');
}

// Insert the whole fake library, including its two fake roots. No-op when
// rows already exist (e.g. a second call in the same process). Returns the
// number of videos seeded.
export function seedDemoLibrary(now: number = Date.now()): number {
  if (listAllVideos().length > 0) return 0;
  // The renderer only loads videos when at least one root exists, and the
  // Welcome page shows when there are none — so the fake roots must be
  // registered, not just referenced by the video rows.
  addRoot(DEMO_ROOT_MOVIES);
  addRoot(DEMO_ROOT_FAMILY);
  DEMO_MOVIES.forEach((m, i) => {
    const ext = i % 5 === 3 ? 'mkv' : 'mp4';
    const filename = `${m.title} (${m.year}).${ext}`;
    const id = insertVideo({
      path: `${m.root}/${filename}`,
      folder: m.root,
      filename,
      size: demoSizeForIndex(m.durationSec, i),
      mtime_ms: demoMtimeForIndex(i, now),
      duration: m.durationSec,
      width: m.width,
      height: m.height,
      codec: m.codec,
      content_fingerprint: `demo-fingerprint-${i}`
    });
    for (const tag of m.tags) setVideoTag(id, tag);
    const interval = m.durationSec / 8;
    insertThumbnails(
      demoThumbsForIndex(i).map((url, k) => ({
        video_id: id,
        frame_index: k,
        time_offset: (k + 0.5) * interval,
        file_path: url
      }))
    );
    markThumbStatus(id, 'ok');
    // Simulate watch history: ~45 min per view, capped at the runtime.
    const perViewMs = Math.min(Math.floor(m.durationSec * 1000), 2700_000);
    for (let k = 0; k < m.views; k++) recordView(id, perViewMs);
  });
  return DEMO_MOVIES.length;
}

// Instant fake scan result for demo mode — the real scanner must never run
// there (it would prune the seeded rows as stale).
export function demoScanResult(total: number): ScanResult {
  return {
    added: 0,
    updated: 0,
    removed: 0,
    total,
    failedThumbnails: [],
    prunedFolders: 0
  };
}
