// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

vi.mock('electron', () => ({
  app: {
    isPackaged: true,
    getPath: (_name: string) => process.env['QF_TEST_USER_DATA'] ?? '/tmp'
  }
}));

import {
  initDb,
  closeDb,
  listAllVideos,
  listRoots,
  listVideos,
  getAllUserTagNames,
  getTagsForVideo,
  getVideoById,
  recordView
} from './db';
import {
  DEMO_MOVIES,
  DEMO_ROOT_FAMILY,
  DEMO_ROOT_MOVIES,
  DEMO_TAGS,
  demoMtimeForIndex,
  demoScanResult,
  demoThumbUrl,
  demoThumbsForIndex,
  isDemoMode,
  seedDemoLibrary
} from './demo';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'qf-demo-'));
  process.env['QF_TEST_USER_DATA'] = dir;
  initDb({ dbPath: join(dir, 'demo.db'), thumbsDir: join(dir, 'thumbs') });
});

afterEach(() => {
  closeDb();
  delete process.env['QF_TEST_USER_DATA'];
  rmSync(dir, { recursive: true, force: true });
});

describe('isDemoMode', () => {
  const OLD_ENV = process.env['QF_DEMO'];
  afterEach(() => {
    if (OLD_ENV === undefined) delete process.env['QF_DEMO'];
    else process.env['QF_DEMO'] = OLD_ENV;
  });

  it('is true with QF_DEMO=1', () => {
    process.env['QF_DEMO'] = '1';
    expect(isDemoMode([], process.env)).toBe(true);
  });

  it("is true with QF_DEMO='true'", () => {
    process.env['QF_DEMO'] = 'true';
    expect(isDemoMode([], process.env)).toBe(true);
  });

  it('is true with a --demo argv entry', () => {
    delete process.env['QF_DEMO'];
    expect(isDemoMode(['electron', '.', '--demo'], process.env)).toBe(true);
  });

  it('is false without flag or env', () => {
    delete process.env['QF_DEMO'];
    expect(isDemoMode(['electron', '.'], process.env)).toBe(false);
  });
});

describe('demo dataset invariants', () => {
  it('has 20 movies with unique filenames, real runtimes, and known tags', () => {
    expect(DEMO_MOVIES).toHaveLength(20);
    const filenames = DEMO_MOVIES.map((m) => `${m.title} (${m.year}).mp4`);
    expect(new Set(filenames).size).toBe(20);
    for (const m of DEMO_MOVIES) {
      expect(m.durationSec).toBeGreaterThan(3600);
      expect(m.width).toBeGreaterThan(0);
      expect(m.height).toBeGreaterThan(0);
      expect(m.tags.length).toBeGreaterThanOrEqual(1);
      for (const t of m.tags) {
        expect((DEMO_TAGS as readonly string[])).toContain(t);
      }
      expect([DEMO_ROOT_MOVIES, DEMO_ROOT_FAMILY]).toContain(m.root);
    }
  });

  it('derives no junk auto-tags from the demo titles', () => {
    // Mirrors the rule in src/renderer/src/utils/tags.ts (extractTags):
    // only 2+-word phrases appearing in 2+ filenames become tags. So no
    // adjacent significant-word pair may repeat across demo titles.
    // (Imported indirectly — the node tsconfig excludes renderer sources.)
    const STOP = new Set(['the', 'a', 'an', 'and', 'of', 'in', 'on']);
    const bigrams = new Map<string, string>();
    for (const m of DEMO_MOVIES) {
      const toks = m.title
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter((t) => t && !/^\d+$/.test(t) && !STOP.has(t));
      for (let i = 0; i + 1 < toks.length; i++) {
        const bg = `${toks[i]} ${toks[i + 1]}`;
        const clash = bigrams.get(bg);
        expect(clash, `bigram "${bg}" repeats in "${m.title}" and "${clash}"`).toBeUndefined();
        bigrams.set(bg, m.title);
      }
    }
  });

  it('gives every video 8 distinct https placeholder thumbs', () => {
    for (let i = 0; i < DEMO_MOVIES.length; i++) {
      const urls = demoThumbsForIndex(i);
      expect(urls).toHaveLength(8);
      expect(new Set(urls).size).toBe(8);
      for (const u of urls) {
        expect(u.startsWith('https://images.unsplash.com/')).toBe(true);
      }
    }
    expect(demoThumbUrl('photo-123')).toContain('w=480&h=270');
  });

  it('spreads mtimes across Today..Older and never into the future', () => {
    const now = Date.now();
    const d = new Date(now);
    const startOfToday = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    // Index 0 lands in the Today bucket by construction.
    expect(demoMtimeForIndex(0, now)).toBeGreaterThanOrEqual(startOfToday);
    for (let i = 0; i < DEMO_MOVIES.length; i++) {
      const m = demoMtimeForIndex(i, now);
      expect(m).toBeLessThanOrEqual(now);
      expect(m).toBeGreaterThan(now - 401 * 24 * 60 * 60 * 1000);
    }
  });
});

describe('seedDemoLibrary', () => {
  it('seeds 20 videos with 8 thumbs and tags each, across 2 roots', () => {
    expect(seedDemoLibrary()).toBe(20);
    expect(listAllVideos()).toHaveLength(20);

    // The renderer gates everything on roots: Welcome shows when empty and
    // videos only load when at least one root exists. (Order-insensitive:
    // both rows can share the same added_at millisecond.)
    expect([...listRoots()].sort()).toEqual([DEMO_ROOT_FAMILY, DEMO_ROOT_MOVIES]);

    const rows = listVideos();
    expect(rows).toHaveLength(20);
    const folders = new Set(rows.map((r) => r.folder));
    expect(folders).toEqual(new Set([DEMO_ROOT_MOVIES, DEMO_ROOT_FAMILY]));

    for (const r of rows) {
      expect(r.thumb_status).toBe('ok');
      expect(r.thumbnails).toHaveLength(8);
      for (const t of r.thumbnails) {
        expect(t.file_path.startsWith('https://images.unsplash.com/')).toBe(true);
      }
      expect(r.tags.length).toBeGreaterThanOrEqual(1);
    }

    // Tag vocabulary matches the curated set (plus nothing else).
    const userTags = getAllUserTagNames();
    expect(new Set(userTags)).toEqual(new Set(DEMO_TAGS));

    // Spot-check: views and durations landed on the rows.
    const godfather = rows.find((r) => r.filename.startsWith('The Godfather'));
    expect(godfather?.duration).toBe(10500);
    expect(godfather?.view_count).toBe(0);
    const interstellar = rows.find((r) => r.filename.startsWith('Interstellar'));
    expect(interstellar?.view_count).toBe(23);
    expect((interstellar?.view_time_ms ?? 0)).toBeGreaterThan(0);
  });

  it('is a no-op when rows already exist', () => {
    expect(seedDemoLibrary()).toBe(20);
    expect(seedDemoLibrary()).toBe(0);
    expect(listAllVideos()).toHaveLength(20);
  });

  it('supports the demo click-to-simulate-play flow (recordView + readback)', () => {
    seedDemoLibrary();
    const row = listAllVideos().find((v) => v.filename.startsWith('Toy Story'))!;
    const before = getVideoById(row.id)!;
    const updated = recordView(row.id, 180_000)!;
    expect(updated.view_count).toBe(before.view_count + 1);
    expect(updated.view_time_ms).toBe(before.view_time_ms + 180_000);
    expect(getTagsForVideo(row.id).length).toBeGreaterThan(0);
  });
});

describe('demoScanResult', () => {
  it('returns an empty instant result with the right total', () => {
    expect(demoScanResult(20)).toEqual({
      added: 0,
      updated: 0,
      removed: 0,
      total: 20,
      failedThumbnails: [],
      prunedFolders: 0
    });
  });
});
