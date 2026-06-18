import { describe, it, expect } from 'vitest';
import { codecBreakdown, trimError, formatFailure } from './Toolbar';
import type { ThumbnailFailure } from '@shared/types';

describe('codecBreakdown', () => {
  it('returns empty string for no failures', () => {
    expect(codecBreakdown([])).toBe('');
  });

  it('groups failures by codec', () => {
    const failures: ThumbnailFailure[] = [
      { path: 'a.mp4', codec: 'h264', codecTag: null, decodersTried: [], error: '', attempts: [] },
      { path: 'b.mp4', codec: 'h264', codecTag: null, decodersTried: [], error: '', attempts: [] },
      { path: 'c.mov', codec: 'hevc', codecTag: null, decodersTried: [], error: '', attempts: [] }
    ];
    const result = codecBreakdown(failures);
    expect(result).toContain('h264 × 2');
    expect(result).toContain('hevc × 1');
  });

  it('handles null codec as unknown', () => {
    const failures: ThumbnailFailure[] = [
      { path: 'a.mp4', codec: null, codecTag: null, decodersTried: [], error: '', attempts: [] }
    ];
    expect(codecBreakdown(failures)).toBe('unknown × 1');
  });
});

describe('trimError', () => {
  it('returns short string as-is', () => {
    expect(trimError('short error')).toBe('short error');
  });

  it('truncates long strings with ellipsis', () => {
    const long = 'a'.repeat(250);
    const result = trimError(long);
    expect(result.length).toBe(201);
    expect(result.endsWith('…')).toBe(true);
  });

  it('respects custom max length', () => {
    const result = trimError('abcdefghij', 5);
    expect(result).toBe('abcde…');
  });

  it('returns string unchanged when exactly at max', () => {
    const exact = 'a'.repeat(200);
    expect(trimError(exact, 200)).toBe(exact);
  });
});

describe('formatFailure', () => {
  it('formats header with codec and tag', () => {
    const f: ThumbnailFailure = {
      path: '/foo/clip.mp4',
      codec: 'h264',
      codecTag: 'avc1',
      decodersTried: [],
      error: 'failed',
      attempts: []
    };
    const result = formatFailure(f);
    expect(result).toContain('/foo/clip.mp4');
    expect(result).toContain('h264');
    expect(result).toContain('avc1');
  });

  it('uses ? when codec is null', () => {
    const f: ThumbnailFailure = {
      path: '/foo/clip.mp4',
      codec: null,
      codecTag: null,
      decodersTried: [],
      error: 'failed',
      attempts: []
    };
    const result = formatFailure(f);
    expect(result).toContain('?');
  });

  it('includes error message when no attempts', () => {
    const f: ThumbnailFailure = {
      path: '/foo/clip.mp4',
      codec: 'h264',
      codecTag: null,
      decodersTried: [],
      error: 'something went wrong',
      attempts: []
    };
    const result = formatFailure(f);
    expect(result).toContain('something went wrong');
  });

  it('lists attempts with bullets', () => {
    const f: ThumbnailFailure = {
      path: '/foo/clip.mp4',
      codec: 'hevc',
      codecTag: null,
      decodersTried: [],
      error: 'all failed',
      attempts: [
        { label: 'h264_fastseek_vt', error: 'decode error' },
        { label: 'h264_fastseek_sw', error: 'timeout' }
      ]
    };
    const result = formatFailure(f);
    expect(result).toContain('• h264_fastseek_vt');
    expect(result).toContain('decode error');
    expect(result).toContain('• h264_fastseek_sw');
    expect(result).toContain('timeout');
  });
});
