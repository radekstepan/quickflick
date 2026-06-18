export function formatViewTime(ms: number): string {
  if (!ms || !Number.isFinite(ms) || ms <= 0) return '';
  const totalMs = Math.floor(ms);
  if (totalMs < 60_000) {
    return `${Math.max(1, Math.round(totalMs / 1000))}s`;
  }
  if (totalMs < 3_600_000) {
    return `${Math.round(totalMs / 60_000)}m`;
  }
  const hours = Math.floor(totalMs / 3_600_000);
  const minutes = Math.round((totalMs - hours * 3_600_000) / 60_000);
  if (minutes === 0) return `${hours}h`;
  if (minutes === 60) return `${hours + 1}h`;
  return `${hours}h ${minutes}m`;
}

export function formatViewsWithTime(viewCount: number, viewTimeMs: number): string {
  const views = viewCount === 1 ? '1 view' : `${viewCount} views`;
  const time = formatViewTime(viewTimeMs);
  if (!time) return views;
  return `${views} · ${time}`;
}
