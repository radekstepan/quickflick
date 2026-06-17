import type { ScanProgress, ThumbnailFailure } from '@shared/types';
import { SortDropdown, type SortKey } from './SortDropdown';

interface Props {
  hasRoots: boolean;
  isScanning: boolean;
  onAdd: () => void;
  onRetryThumbs: () => void;
  onResetAllThumbs: () => void;
  thumbFailures: ThumbnailFailure[];
  search: string;
  onSearchChange: (s: string) => void;
  sortKey: SortKey;
  onSortChange: (next: SortKey) => void;
}

function codecBreakdown(failures: ThumbnailFailure[]): string {
  const counts = new Map<string, number>();
  for (const f of failures) {
    const key = f.codec ?? 'unknown';
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .map(([codec, n]) => `${codec} × ${n}`)
    .join(', ');
}

function trimError(msg: string, max = 200): string {
  if (msg.length <= max) return msg;
  return msg.slice(0, max) + '…';
}

function formatFailure(f: ThumbnailFailure): string {
  const header = `${f.path} (${f.codec ?? '?'}${f.codecTag ? ` / ${f.codecTag}` : ''})`;
  if (!f.attempts || f.attempts.length === 0) {
    return `${header}\n  ${trimError(f.error)}`;
  }
  const items = f.attempts
    .map((a) => `  • ${a.label}\n    ${trimError(a.error)}`)
    .join('\n');
  return `${header}\n${items}`;
}

export function Toolbar({
  hasRoots,
  isScanning,
  onAdd,
  onRetryThumbs,
  onResetAllThumbs,
  thumbFailures,
  search,
  onSearchChange,
  sortKey,
  onSortChange
}: Props) {
  const failureTooltip = thumbFailures.length
    ? `${thumbFailures.length} file(s) failed thumbnail generation. Click to retry.\n` +
      `Codecs: ${codecBreakdown(thumbFailures)}\n\n` +
      thumbFailures.map(formatFailure).join('\n\n')
    : '';

  return (
    <div className="toolbar">
      <SortDropdown value={sortKey} onChange={onSortChange} disabled={!hasRoots} />
      <div className="search-wrap">
        <svg className="search-icon" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <circle cx="11" cy="11" r="7" />
          <path d="M21 21l-4.3-4.3" />
        </svg>
        <input
          className="search"
          type="search"
          placeholder="Search filename & folder…"
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          disabled={!hasRoots}
        />
      </div>
      <div className="toolbar-actions">
        {thumbFailures.length > 0 ? (
          <div className="thumb-failure-group">
            <button
              className="btn thumb-failures"
              onClick={onRetryThumbs}
              disabled={isScanning}
              title={failureTooltip}
            >
              {thumbFailures.length} failed
            </button>
            <button
              className="thumb-reset-link"
              onClick={onResetAllThumbs}
              disabled={isScanning}
              title="Wipe all thumbnail files and regenerate from scratch"
            >
              Reset all
            </button>
          </div>
        ) : null}
        <button className="btn primary" onClick={onAdd} disabled={isScanning}>
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M12 5v14M5 12h14" />
          </svg>
          Add folder
        </button>
      </div>
    </div>
  );
}

export function ScanProgressOverlay({ progress }: { progress: ScanProgress | null }) {
  if (!progress || progress.phase === 'done') return null;
  const label =
    progress.phase === 'walking'
      ? `Walking… ${progress.processed} found`
      : progress.phase === 'probing'
      ? `Probing ${progress.processed}/${progress.total}`
      : `Thumbnails ${progress.processed}/${progress.total}`;
  return (
    <div className="scan-progress">
      <span className="spinner" />
      <span className="scan-progress-label">{label}</span>
      {progress.currentFile ? (
        <>
          <span className="scan-progress-divider" />
          <span className="file" title={progress.currentFile}>
            {progress.currentFile.split('/').pop()}
          </span>
        </>
      ) : null}
    </div>
  );
}
