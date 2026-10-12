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
  insertVideo,
  setVideoTag,
  removeVideoTag,
  deleteTagGlobally,
  getTagsForVideo,
  getExclusionsForVideo,
  getGlobalExcludedTagNames,
  getAllUserTagNames
} from './db';

let dir: string;

function addVideo(path: string, fingerprint: string | null = null): number {
  return insertVideo({
    path,
    folder: '/vids',
    filename: path.split('/').pop()!,
    size: 1000,
    mtime_ms: 1,
    duration: null,
    width: null,
    height: null,
    codec: null,
    content_fingerprint: fingerprint
  });
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'qf-tagdel-'));
  process.env['QF_TEST_USER_DATA'] = dir;
  initDb({ dbPath: join(dir, 'cache.db'), thumbsDir: join(dir, 'thumbs') });
});

afterEach(() => {
  closeDb();
  delete process.env['QF_TEST_USER_DATA'];
  rmSync(dir, { recursive: true, force: true });
});

describe('removeVideoTag', () => {
  it('deletes the explicit row AND records a per-video exclusion', () => {
    const id = addVideo('/vids/beach party.mp4');
    setVideoTag(id, 'Beach Party');
    expect(getTagsForVideo(id)).toEqual(['Beach Party']);

    removeVideoTag(id, 'Beach Party');

    // Explicit row gone (so rescan/reload can't resurrect it via user tags)…
    expect(getTagsForVideo(id)).toEqual([]);
    // …and the auto-match from the filename is suppressed.
    expect(getExclusionsForVideo(id)).toEqual(['Beach Party']);
  });

  it('is case-insensitive', () => {
    const id = addVideo('/vids/beach.mp4');
    setVideoTag(id, 'beach');
    removeVideoTag(id, 'Beach');
    expect(getTagsForVideo(id)).toEqual([]);
    // Exactly one exclusion, no case-variant duplicates.
    expect(getExclusionsForVideo(id)).toHaveLength(1);
  });

  it('does not create duplicate exclusions on repeat remove', () => {
    const id = addVideo('/vids/beach.mp4');
    removeVideoTag(id, 'Beach');
    removeVideoTag(id, 'beach');
    expect(getExclusionsForVideo(id)).toHaveLength(1);
  });
});

describe('setVideoTag', () => {
  it('clears the per-video exclusion when re-adding', () => {
    const id = addVideo('/vids/beach.mp4');
    removeVideoTag(id, 'Beach');
    expect(getExclusionsForVideo(id)).toHaveLength(1);
    setVideoTag(id, 'beach');
    expect(getTagsForVideo(id)).toHaveLength(1);
    expect(getExclusionsForVideo(id)).toEqual([]);
  });

  it('normalises case-variant duplicates to a single row', () => {
    const id = addVideo('/vids/beach.mp4');
    setVideoTag(id, 'beach');
    setVideoTag(id, 'Beach');
    expect(getTagsForVideo(id)).toHaveLength(1);
  });
});

describe('deleteTagGlobally', () => {
  it('removes the tag from every video and records a global exclusion', () => {
    const a = addVideo('/vids/a.mp4');
    const b = addVideo('/vids/b.mp4');
    setVideoTag(a, 'Beach');
    setVideoTag(b, 'BEACH');

    deleteTagGlobally('beach');

    expect(getTagsForVideo(a)).toEqual([]);
    expect(getTagsForVideo(b)).toEqual([]);
    expect(getAllUserTagNames()).toEqual([]);
    expect(getGlobalExcludedTagNames()).toEqual(['beach']);
  });

  it('is idempotent', () => {
    const a = addVideo('/vids/a.mp4');
    setVideoTag(a, 'Beach');
    deleteTagGlobally('Beach');
    deleteTagGlobally('BEACH');
    expect(getGlobalExcludedTagNames()).toHaveLength(1);
  });
});
