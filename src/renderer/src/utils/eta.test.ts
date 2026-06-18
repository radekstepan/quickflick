import { describe, it, expect } from 'vitest';
import { estimateEtaMs, formatEta, type EtaSample } from './eta';

describe('estimateEtaMs', () => {
  it('returns null with fewer than 2 samples', () => {
    expect(estimateEtaMs([], 10)).toBeNull();
    expect(estimateEtaMs([{ time: 0, processed: 0 }], 10)).toBeNull();
  });

  it('returns null when nothing remains', () => {
    const samples: EtaSample[] = [
      { time: 0, processed: 0 },
      { time: 1000, processed: 5 }
    ];
    expect(estimateEtaMs(samples, 0)).toBeNull();
  });

  it('estimates based on average rate', () => {
    // 5 items in 5000ms = 1000ms/item
    const samples: EtaSample[] = [
      { time: 0, processed: 0 },
      { time: 5000, processed: 5 }
    ];
    expect(estimateEtaMs(samples, 10)).toBe(10_000);
  });

  it('uses only the first and last samples (rolling window)', () => {
    // First sample at t=0, processed=0
    // Last sample at t=10s, processed=10 (2 items/sec)
    const samples: EtaSample[] = [
      { time: 0, processed: 0 },
      { time: 1000, processed: 1 },
      { time: 5000, processed: 5 },
      { time: 10_000, processed: 10 }
    ];
    // rate = 10 items / 10s = 1 item/sec, 5 remaining = 5000ms
    expect(estimateEtaMs(samples, 5)).toBe(5000);
  });

  it('returns null when time has not advanced', () => {
    const samples: EtaSample[] = [
      { time: 0, processed: 0 },
      { time: 0, processed: 5 }
    ];
    expect(estimateEtaMs(samples, 5)).toBeNull();
  });

  it('returns null when processed count has not advanced', () => {
    const samples: EtaSample[] = [
      { time: 0, processed: 5 },
      { time: 5000, processed: 5 }
    ];
    expect(estimateEtaMs(samples, 5)).toBeNull();
  });
});

describe('formatEta', () => {
  it('returns ~0s for negative or invalid input', () => {
    expect(formatEta(-100)).toBe('~0s');
    expect(formatEta(NaN)).toBe('~0s');
  });

  it('formats seconds under a minute', () => {
    expect(formatEta(0)).toBe('~0s');
    expect(formatEta(30_000)).toBe('~30s');
    expect(formatEta(59_000)).toBe('~59s');
  });

  it('formats minutes and seconds', () => {
    expect(formatEta(60_000)).toBe('~1m');
    expect(formatEta(65_000)).toBe('~1m 5s');
    expect(formatEta(125_000)).toBe('~2m 5s');
  });

  it('formats hours and minutes', () => {
    expect(formatEta(3_600_000)).toBe('~1h 0m');
    expect(formatEta(3_900_000)).toBe('~1h 5m');
    expect(formatEta(7_200_000)).toBe('~2h 0m');
  });
});
