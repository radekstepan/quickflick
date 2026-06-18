export interface EtaSample {
  time: number;
  processed: number;
}

export function estimateEtaMs(samples: ReadonlyArray<EtaSample>, remaining: number): number | null {
  if (samples.length < 2 || remaining <= 0) return null;
  const first = samples[0]!;
  const last = samples[samples.length - 1]!;
  const dt = last.time - first.time;
  const dp = last.processed - first.processed;
  if (dt <= 0 || dp <= 0) return null;
  const msPerItem = dt / dp;
  return Math.round(msPerItem * remaining);
}

export function formatEta(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '~0s';
  const totalSec = Math.round(ms / 1000);
  if (totalSec < 60) return `~${totalSec}s`;
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `~${h}h ${m}m`;
  if (s > 0) return `~${m}m ${s}s`;
  return `~${m}m`;
}
