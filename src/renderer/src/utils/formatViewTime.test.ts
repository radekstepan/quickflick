import { describe, it, expect } from 'vitest';
import { formatViewTime, formatViewsWithTime } from './formatViewTime';

describe('formatViewTime', () => {
  it('returns empty string for zero', () => {
    expect(formatViewTime(0)).toBe('');
  });

  it('returns empty string for negative', () => {
    expect(formatViewTime(-100)).toBe('');
  });

  it('returns empty string for NaN', () => {
    expect(formatViewTime(NaN)).toBe('');
  });

  it('returns empty string for Infinity', () => {
    expect(formatViewTime(Infinity)).toBe('');
  });

  it('formats sub-minute as seconds, minimum 1s', () => {
    expect(formatViewTime(1)).toBe('1s');
    expect(formatViewTime(45_000)).toBe('45s');
  });

  it('rounds sub-minute to nearest second', () => {
    expect(formatViewTime(5500)).toBe('6s');
  });

  it('formats sub-hour as minutes', () => {
    expect(formatViewTime(60_000)).toBe('1m');
    expect(formatViewTime(23 * 60_000)).toBe('23m');
  });

  it('rounds minutes to nearest minute', () => {
    expect(formatViewTime(90_000)).toBe('2m');
  });

  it('formats hours with non-zero minutes', () => {
    expect(formatViewTime(60 * 60_000 + 12 * 60_000)).toBe('1h 12m');
  });

  it('formats hours without trailing minutes when minutes are 0', () => {
    expect(formatViewTime(2 * 60 * 60_000)).toBe('2h');
  });

  it('rolls up minutes >= 60 into an extra hour', () => {
    expect(formatViewTime(60 * 60_000 + 60 * 60_000 - 1)).toBe('2h');
  });
});

describe('formatViewsWithTime', () => {
  it('shows singular view', () => {
    expect(formatViewsWithTime(1, 0)).toBe('1 view');
  });

  it('shows plural views with no time', () => {
    expect(formatViewsWithTime(0, 0)).toBe('0 views');
    expect(formatViewsWithTime(42, 0)).toBe('42 views');
  });

  it('appends minutes with a dot separator', () => {
    expect(formatViewsWithTime(5, 23 * 60_000)).toBe('5 views · 23m');
  });

  it('appends hours and minutes', () => {
    expect(formatViewsWithTime(3, 60 * 60_000 + 12 * 60_000)).toBe('3 views · 1h 12m');
  });

  it('omits the time suffix when viewTime is zero', () => {
    expect(formatViewsWithTime(7, 0)).toBe('7 views');
  });
});
