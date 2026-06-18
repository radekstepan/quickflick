import { describe, it, expect } from 'vitest';
import { pathBasename, stemLength, displayName } from './displayName';

describe('pathBasename', () => {
  it('returns the last segment of a Unix path', () => {
    expect(pathBasename('/Users/foo/videos/clip.mp4')).toBe('clip.mp4');
  });

  it('handles trailing slashes', () => {
    expect(pathBasename('/Users/foo/videos/')).toBe('videos');
  });

  it('handles empty path', () => {
    expect(pathBasename('')).toBe('');
  });

  it('handles a single segment', () => {
    expect(pathBasename('file.mp4')).toBe('file.mp4');
  });
});

describe('stemLength', () => {
  it('returns length up to last dot', () => {
    expect(stemLength('hello.mp4')).toBe(5);
  });

  it('returns full length when no dot', () => {
    expect(stemLength('noextension')).toBe(11);
  });

  it('ignores a leading dot', () => {
    expect(stemLength('.hidden')).toBe(7);
  });

  it('handles multiple dots', () => {
    expect(stemLength('scene.one.mp4')).toBe(9);
  });
});

describe('displayName', () => {
  it('returns filename when stem is at least 5 characters', () => {
    expect(displayName('myvideo.mp4', '/Users/foo', ['/Users/foo'])).toBe('myvideo.mp4');
  });

  it('includes folder name when stem is short and not in root', () => {
    expect(displayName('a.mov', '/Users/foo/Clips', ['/Users/foo'])).toBe('Clips/a.mov');
  });

  it('returns filename only when stem is short and in root', () => {
    expect(displayName('a.mov', '/Users/foo', ['/Users/foo'])).toBe('a.mov');
  });

  it('handles exactly 5-character stem', () => {
    expect(displayName('12345.mp4', '/Users/foo', ['/Users/foo'])).toBe('12345.mp4');
  });

  it('handles 4-character stem in subfolder', () => {
    expect(displayName('1234.mp4', '/Users/foo/Sub', ['/Users/foo'])).toBe('Sub/1234.mp4');
  });

  it('includes folder when roots list is empty', () => {
    expect(displayName('a.mov', '/Users/foo/Clips', [])).toBe('Clips/a.mov');
  });
});
