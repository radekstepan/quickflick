import { describe, it, expect } from 'vitest';
import {
  matchesTag,
  normaliseTagName,
  getSubfolderSegments,
  findRoot,
  videoMatchesTag,
  getMatchingTags,
  countVideosByTag,
  extractTags,
  extractTagsWithFolders,
  type Tag
} from './tags';

describe('normaliseTagName', () => {
  it('trims whitespace', () => {
    expect(normaliseTagName('  hello  ')).toBe('Hello');
  });

  it('collapses internal whitespace', () => {
    expect(normaliseTagName('hello   world')).toBe('Hello World');
  });

  it('title-cases each word', () => {
    expect(normaliseTagName('hello WORLD')).toBe('Hello WORLD');
  });

  it('handles empty string', () => {
    expect(normaliseTagName('')).toBe('');
  });
});

describe('matchesTag', () => {
  it('matches consecutive tokens', () => {
    expect(matchesTag('beach vacation 2024.mp4', 'beach vacation')).toBe(true);
  });

  it('skips filterable tokens (stopwords) between matches', () => {
    expect(matchesTag('beach the vacation.mp4', 'beach vacation')).toBe(true);
  });

  it('skips numeric tokens', () => {
    expect(matchesTag('beach 2024 vacation.mp4', 'beach vacation')).toBe(true);
  });

  it('returns false when tokens are out of order', () => {
    expect(matchesTag('vacation beach 2024.mp4', 'beach vacation')).toBe(false);
  });

  it('is case-insensitive', () => {
    expect(matchesTag('BEACH Vacation.mp4', 'beach vacation')).toBe(true);
  });

  it('returns false for empty tag', () => {
    expect(matchesTag('beach.mp4', '')).toBe(false);
  });

  it('handles underscores and dots as separators', () => {
    expect(matchesTag('beach.vacation.2024.mp4', 'beach vacation')).toBe(true);
  });
});

describe('getSubfolderSegments', () => {
  it('returns empty for root folder', () => {
    expect(getSubfolderSegments('/Users/foo', '/Users/foo')).toEqual([]);
  });

  it('returns single segment for direct child', () => {
    expect(getSubfolderSegments('/Users/foo/Clips', '/Users/foo')).toEqual(['Clips']);
  });

  it('returns all segments for nested folder', () => {
    expect(getSubfolderSegments('/Users/foo/Clips/2024/Summer', '/Users/foo')).toEqual([
      'Clips',
      '2024',
      'Summer'
    ]);
  });

  it('treats folder as relative when not under root', () => {
    expect(getSubfolderSegments('/Other/Path', '/Users/foo')).toEqual(['Other', 'Path']);
  });
});

describe('findRoot', () => {
  it('finds matching root', () => {
    expect(findRoot('/Users/foo/Clips/2024', ['/Users/foo'])).toBe('/Users/foo');
  });

  it('finds exact match', () => {
    expect(findRoot('/Users/foo', ['/Users/foo'])).toBe('/Users/foo');
  });

  it('returns null when no root matches', () => {
    expect(findRoot('/Other/Path', ['/Users/foo'])).toBeNull();
  });

  it('returns first matching root from multiple', () => {
    expect(findRoot('/Users/foo/x', ['/Users/bar', '/Users/foo'])).toBe('/Users/foo');
  });
});

describe('videoMatchesTag', () => {
  it('matches via explicit user tag', () => {
    expect(
      videoMatchesTag(
        { filename: 'random.mp4', folder: '/foo', tags: ['Beach'] },
        'beach',
        ['/foo']
      )
    ).toBe(true);
  });

  it('returns false when in excluded tags', () => {
    expect(
      videoMatchesTag(
        { filename: 'beach.mp4', folder: '/foo', excludedTags: ['Beach'] },
        'beach',
        ['/foo']
      )
    ).toBe(false);
  });

  it('user tag overrides filename mismatch', () => {
    expect(
      videoMatchesTag(
        { filename: 'unrelated.mp4', folder: '/foo', tags: ['Beach'] },
        'beach',
        ['/foo']
      )
    ).toBe(true);
  });

  it('matches via filename tokens', () => {
    expect(videoMatchesTag({ filename: 'beach vacation.mp4', folder: '/foo' }, 'beach', ['/foo'])).toBe(
      true
    );
  });

  it('matches via subfolder segment', () => {
    expect(
      videoMatchesTag({ filename: 'clip.mp4', folder: '/foo/Beach/Summer' }, 'beach', ['/foo'])
    ).toBe(true);
  });

  it('returns false when no match anywhere', () => {
    expect(
      videoMatchesTag({ filename: 'unrelated.mp4', folder: '/foo/Other' }, 'beach', ['/foo'])
    ).toBe(false);
  });
});

describe('getMatchingTags', () => {
  it('returns sorted list of matching tag names', () => {
    const tags: Tag[] = [
      { name: 'Beach', count: 1 },
      { name: 'Animal', count: 1 }
    ];
    const result = getMatchingTags(
      { filename: 'beach animal parade.mp4', folder: '/foo' },
      tags,
      ['/foo']
    );
    expect(result).toEqual(['Animal', 'Beach']);
  });

  it('excludes non-matching tags', () => {
    const tags: Tag[] = [
      { name: 'Beach', count: 1 },
      { name: 'Mountain', count: 1 }
    ];
    const result = getMatchingTags({ filename: 'beach day.mp4', folder: '/foo' }, tags, ['/foo']);
    expect(result).toEqual(['Beach']);
  });
});

describe('extractTags', () => {
  it('finds n-grams shared by multiple files', () => {
    const tags = extractTags([
      'beach vacation 2024.mp4',
      'beach vacation summer.mp4',
      'mountain trip.mp4'
    ]);
    const names = tags.map((t) => t.name);
    expect(names).toContain('Beach Vacation');
  });

  it('requires at least 2 files to match', () => {
    const tags = extractTags(['unique snowflake.mp4', 'mountain trip.mp4']);
    const names = tags.map((t) => t.name);
    expect(names).not.toContain('Unique Snowflake');
  });

  it('returns empty for no overlap', () => {
    const tags = extractTags(['completely.mp4', 'different.mp4', 'files.mp4']);
    expect(tags).toEqual([]);
  });
});

describe('extractTagsWithFolders', () => {
  it('increments counts when folder segments match existing tag', () => {
    // "beach vacation" appears in 2 filenames (forming the base tag).
    // Two more files live in a /root/Beach Vacation/ subfolder, which
    // enriches the count by matching both tokens against the segment.
    const items = [
      { filename: 'beach vacation 1.mp4', folder: '/root/Clips' },
      { filename: 'beach vacation 2.mp4', folder: '/root/Clips' },
      { filename: 'sunset.mp4', folder: '/root/Beach Vacation' },
      { filename: 'waves.mp4', folder: '/root/Beach Vacation' }
    ];
    const tags = extractTagsWithFolders(items, ['/root']);
    const beach = tags.find((t) => t.name === 'Beach Vacation');
    expect(beach).toBeDefined();
    // 2 from filename matches + 2 from folder enrichment = 4
    expect(beach?.count).toBe(4);
  });

  it('returns base tags when no folder enrichment applies', () => {
    const items = [
      { filename: 'beach vacation 1.mp4', folder: '/root/Clips' },
      { filename: 'beach vacation 2.mp4', folder: '/root/Other' }
    ];
    const tags = extractTagsWithFolders(items, ['/root']);
    const beach = tags.find((t) => t.name === 'Beach Vacation');
    expect(beach).toBeDefined();
    expect(beach?.count).toBe(2);
  });

  it('returns empty array when no tags found', () => {
    const items = [
      { filename: 'unique1.mp4', folder: '/root' },
      { filename: 'unique2.mp4', folder: '/root' }
    ];
    expect(extractTagsWithFolders(items, ['/root'])).toEqual([]);
  });
});

describe('countVideosByTag', () => {
  it('returns zeros for every candidate name when there are no videos', () => {
    const counts = countVideosByTag([], ['Alura Jenson', 'Beach'], ['/root']);
    expect(counts.get('Alura Jenson')).toBe(0);
    expect(counts.get('Beach')).toBe(0);
  });

  it('returns an empty map when there are no candidate names', () => {
    const counts = countVideosByTag(
      [{ filename: 'beach.mp4', folder: '/root' }],
      [],
      ['/root']
    );
    expect(counts.size).toBe(0);
  });

  // Regression: the sidebar used to show "1" for "Alura Jenson" because
  // it only counted videos with the tag explicitly assigned, even though
  // the click filter also matched videos via folder segments. The count
  // must agree with the click filter (videoMatchesTag) so the number the
  // user sees next to the tag matches the number of videos that appear
  // when the tag is selected.
  it('counts user-assigned tag plus folder-segment auto-matches, minus exclusions', () => {
    const videos = [
      { filename: 'clip1.mp4', folder: '/lib/Alura Jenson/2024', tags: ['Alura Jenson'] },
      { filename: 'clip2.mp4', folder: '/lib/Alura Jenson/2023', excludedTags: ['Alura Jenson'] },
      { filename: 'clip3.mp4', folder: '/lib/Alura Jenson/2022' },
      { filename: 'clip4.mp4', folder: '/lib/Other' }
    ];
    const counts = countVideosByTag(videos, ['Alura Jenson'], ['/lib']);
    // 1 explicit + 1 folder auto-match (clip2 excluded, clip4 not in folder)
    expect(counts.get('Alura Jenson')).toBe(2);
  });

  it('counts filename matches as well as explicit and folder matches', () => {
    const videos = [
      { filename: 'alura jenson scene.mp4', folder: '/lib' },
      { filename: 'clip.mp4', folder: '/lib/Alura Jenson' },
      { filename: 'unrelated.mp4', folder: '/lib' }
    ];
    const counts = countVideosByTag(videos, ['Alura Jenson'], ['/lib']);
    expect(counts.get('Alura Jenson')).toBe(2);
  });

  it('does not double-count a video that matches via multiple paths', () => {
    const videos = [
      {
        filename: 'alura jenson clip.mp4',
        folder: '/lib/Alura Jenson',
        tags: ['Alura Jenson']
      }
    ];
    const counts = countVideosByTag(videos, ['Alura Jenson'], ['/lib']);
    expect(counts.get('Alura Jenson')).toBe(1);
  });

  it('respects excludedTags for auto-detected tags too', () => {
    const videos = [
      { filename: 'beach vacation 1.mp4', folder: '/root/Clips' },
      { filename: 'beach vacation 2.mp4', folder: '/root/Other' },
      { filename: 'beach day.mp4', folder: '/root/Clips', excludedTags: ['Beach Vacation'] }
    ];
    const counts = countVideosByTag(videos, ['Beach Vacation'], ['/root']);
    expect(counts.get('Beach Vacation')).toBe(2);
  });

  it('returns the same count the filter would show for each tag', () => {
    const videos = [
      { filename: 'beach day.mp4', folder: '/root' },
      { filename: 'mountain trip.mp4', folder: '/root' },
      { filename: 'beach the cat.mp4', folder: '/root', tags: ['Beach'] },
      { filename: 'clip.mp4', folder: '/root/Beach' }
    ];
    const names = ['Beach', 'Mountain'];
    const counts = countVideosByTag(videos, names, ['/root']);
    for (const name of names) {
      const expected = videos.filter((v) => videoMatchesTag(v, name, ['/root'])).length;
      expect(counts.get(name)).toBe(expected);
    }
  });
});

describe('globalExcluded', () => {
  const roots = ['/root'];

  it('suppresses auto-matches for globally deleted tags', () => {
    const video = { filename: 'beach vacation.mp4', folder: '/root/Clips' };
    expect(videoMatchesTag(video, 'Beach Vacation', roots)).toBe(true);
    expect(videoMatchesTag(video, 'Beach Vacation', roots, new Set(['beach vacation']))).toBe(false);
  });

  it('lets explicit user tags win over the global blocklist', () => {
    const video = {
      filename: 'beach vacation.mp4',
      folder: '/root/Clips',
      tags: ['Beach Vacation']
    };
    expect(videoMatchesTag(video, 'Beach Vacation', roots, new Set(['beach vacation']))).toBe(true);
  });

  it('still respects per-video exclusions', () => {
    const video = {
      filename: 'beach vacation.mp4',
      folder: '/root/Clips',
      tags: ['Beach Vacation'],
      excludedTags: ['Beach Vacation']
    };
    expect(videoMatchesTag(video, 'Beach Vacation', roots, new Set())).toBe(false);
  });

  it('zeroes counts for globally deleted auto tags', () => {
    const videos = [
      { filename: 'beach vacation 1.mp4', folder: '/root/Clips' },
      { filename: 'beach vacation 2.mp4', folder: '/root/Other' }
    ];
    const counts = countVideosByTag(videos, ['Beach Vacation'], roots, new Set(['beach vacation']));
    expect(counts.get('Beach Vacation')).toBe(0);
  });

  it('counts explicitly tagged videos despite the global blocklist', () => {
    const videos = [
      { filename: 'clip.mp4', folder: '/root/Clips', tags: ['Beach Vacation'] },
      { filename: 'other.mp4', folder: '/root/Clips' }
    ];
    const counts = countVideosByTag(videos, ['Beach Vacation'], roots, new Set(['beach vacation']));
    expect(counts.get('Beach Vacation')).toBe(1);
  });
});
