import { describe, it, expect } from 'vitest';
import { formatDuration, formatSize, formatViews } from './VideoCard';

describe('formatDuration', () => {
  it('returns empty string for null', () => {
    expect(formatDuration(null)).toBe('');
  });

  it('returns empty string for zero', () => {
    expect(formatDuration(0)).toBe('');
  });

  it('returns empty string for NaN', () => {
    expect(formatDuration(NaN)).toBe('');
  });

  it('returns empty string for Infinity', () => {
    expect(formatDuration(Infinity)).toBe('');
  });

  it('formats minutes:seconds', () => {
    expect(formatDuration(90)).toBe('1:30');
  });

  it('formats with hours', () => {
    expect(formatDuration(3725)).toBe('1:02:05');
  });

  it('pads minutes and seconds', () => {
    expect(formatDuration(65)).toBe('1:05');
  });

  it('rounds to nearest second', () => {
    expect(formatDuration(59.6)).toBe('1:00');
  });
});

describe('formatSize', () => {
  it('formats bytes', () => {
    expect(formatSize(500)).toBe('500 B');
  });

  it('formats kilobytes', () => {
    expect(formatSize(2048)).toBe('2.0 KB');
  });

  it('formats megabytes', () => {
    expect(formatSize(5 * 1024 * 1024)).toBe('5.0 MB');
  });

  it('formats gigabytes', () => {
    expect(formatSize(2.5 * 1024 * 1024 * 1024)).toBe('2.50 GB');
  });

  it('uses one decimal for KB/MB', () => {
    expect(formatSize(1536)).toBe('1.5 KB');
  });
});

describe('formatViews', () => {
  it('uses singular for 1', () => {
    expect(formatViews(1)).toBe('1 view');
  });

  it('uses plural for 0', () => {
    expect(formatViews(0)).toBe('0 views');
  });

  it('uses plural for >1', () => {
    expect(formatViews(42)).toBe('42 views');
  });
});
