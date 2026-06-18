import { describe, it, expect } from 'vitest';
import { formatSearchInput, normalizeForSearch, getDateBucket } from './App';
import type { VideoWithThumbs } from '@shared/types';

describe('formatSearchInput', () => {
  it('converts dashes to spaces', () => {
    expect(formatSearchInput('hello-world')).toBe('Hello World');
  });

  it('converts underscores to spaces', () => {
    expect(formatSearchInput('hello_world')).toBe('Hello World');
  });

  it('converts dots to spaces', () => {
    expect(formatSearchInput('hello.world')).toBe('Hello World');
  });

  it('title-cases words', () => {
    expect(formatSearchInput('beach vacation')).toBe('Beach Vacation');
  });

  it('preserves numeric tokens without title-casing', () => {
    expect(formatSearchInput('trip 2024 summer')).toBe('Trip 2024 Summer');
  });

  it('collapses multiple separators', () => {
    expect(formatSearchInput('hello---world')).toBe('Hello World');
  });

  it('removes empty segments', () => {
    expect(formatSearchInput('  hello   ')).toBe('Hello');
  });

  it('handles empty input', () => {
    expect(formatSearchInput('')).toBe('');
  });
});

describe('normalizeForSearch', () => {
  it('lowercases the string', () => {
    expect(normalizeForSearch('HELLO')).toBe('hello');
  });

  it('replaces dashes with spaces', () => {
    expect(normalizeForSearch('hello-world')).toBe('hello world');
  });

  it('replaces underscores with spaces', () => {
    expect(normalizeForSearch('hello_world')).toBe('hello world');
  });

  it('replaces dots with spaces', () => {
    expect(normalizeForSearch('hello.world')).toBe('hello world');
  });

  it('handles empty input', () => {
    expect(normalizeForSearch('')).toBe('');
  });
});

describe('getDateBucket', () => {
  const now = new Date(2026, 5, 17, 14, 0, 0); // Jun 17, 2026 14:00

  it('returns Unknown for 0', () => {
    expect(getDateBucket(0, now)).toBe('Unknown');
  });

  it('returns Unknown for negative', () => {
    expect(getDateBucket(-1, now)).toBe('Unknown');
  });

  it('returns Today for current day', () => {
    const mtime = new Date(2026, 5, 17, 10, 0, 0).getTime();
    expect(getDateBucket(mtime, now)).toBe('Today');
  });

  it('returns Today for later today', () => {
    const mtime = new Date(2026, 5, 17, 23, 59, 0).getTime();
    expect(getDateBucket(mtime, now)).toBe('Today');
  });

  it('returns Yesterday for previous day', () => {
    const mtime = new Date(2026, 5, 16, 10, 0, 0).getTime();
    expect(getDateBucket(mtime, now)).toBe('Yesterday');
  });

  it('returns This week for 3 days ago', () => {
    const mtime = new Date(2026, 5, 14, 10, 0, 0).getTime();
    expect(getDateBucket(mtime, now)).toBe('This week');
  });

  it('returns This week for 7 days ago (boundary)', () => {
    // Now is Jun 17; startOfWeek = Jun 17 - 7 days = Jun 10
    const mtime = new Date(2026, 5, 10, 23, 59, 0).getTime();
    expect(getDateBucket(mtime, now)).toBe('This week');
  });

  it('returns This month for 8 days ago', () => {
    const mtime = new Date(2026, 5, 9, 10, 0, 0).getTime();
    expect(getDateBucket(mtime, now)).toBe('This month');
  });

  it('returns This month for 30 days ago (boundary)', () => {
    // Now is Jun 17; startOfMonth = Jun 17 - 30 days = May 18
    const mtime = new Date(2026, 4, 18, 10, 0, 0).getTime();
    expect(getDateBucket(mtime, now)).toBe('This month');
  });

  it('returns Older for 31 days ago', () => {
    const mtime = new Date(2026, 4, 17, 10, 0, 0).getTime();
    expect(getDateBucket(mtime, now)).toBe('Older');
  });
});

describe('buildDateGroups', () => {
  it('groups videos by date bucket', async () => {
    const { buildDateGroups } = await import('./App');
    const now = new Date(2026, 5, 17, 14, 0, 0).getTime();
    const videos: VideoWithThumbs[] = [
      mkVideo(1, new Date(2026, 5, 17, 10, 0, 0).getTime()),
      mkVideo(2, new Date(2026, 5, 16, 10, 0, 0).getTime()),
      mkVideo(3, new Date(2026, 4, 1, 10, 0, 0).getTime())
    ];
    const groups = buildDateGroups(videos, 'newest', now);
    const today = groups.find((g) => g.tag === 'Today');
    const yesterday = groups.find((g) => g.tag === 'Yesterday');
    const older = groups.find((g) => g.tag === 'Older');
    expect(today?.videos.map((v) => v.id)).toEqual([1]);
    expect(yesterday?.videos.map((v) => v.id)).toEqual([2]);
    expect(older?.videos.map((v) => v.id)).toEqual([3]);
  });

  it('reverses order for oldest sort', async () => {
    const { buildDateGroups } = await import('./App');
    const now = new Date(2026, 5, 17, 14, 0, 0).getTime();
    const videos: VideoWithThumbs[] = [
      mkVideo(1, new Date(2026, 5, 17, 10, 0, 0).getTime()),
      mkVideo(2, new Date(2026, 4, 1, 10, 0, 0).getTime())
    ];
    const groups = buildDateGroups(videos, 'oldest', now);
    expect(groups[0]?.tag).toBe('Older');
    expect(groups[groups.length - 1]?.tag).toBe('Today');
  });

  it('skips empty buckets', async () => {
    const { buildDateGroups } = await import('./App');
    const now = new Date(2026, 5, 17, 14, 0, 0).getTime();
    const videos: VideoWithThumbs[] = [
      mkVideo(1, new Date(2026, 5, 17, 10, 0, 0).getTime())
    ];
    const groups = buildDateGroups(videos, 'newest', now);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.tag).toBe('Today');
  });
});

function mkVideo(id: number, mtime_ms: number): VideoWithThumbs {
  return {
    id,
    path: `/foo/clip${id}.mp4`,
    folder: '/foo',
    filename: `clip${id}.mp4`,
    size: 1000,
    mtime_ms,
    duration: 60,
    width: 1920,
    height: 1080,
    scanned_at: 0,
    codec: 'h264',
    thumb_status: 'ok',
    view_count: 0,
    tags: [],
    excludedTags: [],
    thumbnails: []
  };
}
