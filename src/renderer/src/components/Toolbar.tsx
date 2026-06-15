import type { ScanProgress, ThumbnailFailure } from '@shared/types';
import { SortDropdown, type SortKey } from './SortDropdown';

interface Props {
  roots: string[];
  isScanning: boolean;
  onAdd: () => void;
  onRescan: () => void;
  onRetryThumbs: () => void;
  onResetAllThumbs: () => void;
  thumbFailures: ThumbnailFailure[];
  search: string;
  onSearchChange: (s: string) => void;
  sortKey: SortKey;
  onSortChange: (next: SortKey) => void;
}

function basename(p: string): string {
  const parts = p.split('/').filter(Boolean);
  return parts[parts.length - 1] ?? p;
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
  roots,
  isScanning,
  onAdd,
  onRescan,
  onRetryThumbs,
  onResetAllThumbs,
  thumbFailures,
  search,
  onSearchChange,
  sortKey,
  onSortChange
}: Props) {
  const label = roots.length === 0
    ? 'No library selected'
    : roots.length === 1
    ? basename(roots[0])
    : `${roots.length} folders`;

  const failureTooltip = thumbFailures.length
    ? `${thumbFailures.length} file(s) failed thumbnail generation. Click to retry.\n` +
      `Codecs: ${codecBreakdown(thumbFailures)}\n\n` +
      thumbFailures.map(formatFailure).join('\n\n')
    : '';

  return (
    <div className="toolbar">
      <div className={`toolbar-path ${roots.length === 0 ? 'empty' : ''}`} title={roots.join('\n')}>
        {label}
      </div>
      <button className="btn" onClick={onAdd} disabled={isScanning}>
        Add folder
      </button>
      <button
        className="btn primary"
        onClick={onRescan}
        disabled={roots.length === 0 || isScanning}
        title="Rescan the library"
      >
        {isScanning ? <span className="spinner" /> : null}
        {isScanning ? 'Scanning…' : 'Rescan'}
      </button>
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
      <SortDropdown value={sortKey} onChange={onSortChange} disabled={roots.length === 0} />
      <input
        className="search"
        type="search"
        placeholder="Search filename…"
        value={search}
        onChange={(e) => onSearchChange(e.target.value)}
        disabled={roots.length === 0}
      />
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
      <span>{label}</span>
      {progress.currentFile ? (
        <span className="file" title={progress.currentFile}>
          {progress.currentFile.split('/').pop()}
        </span>
      ) : null}
    </div>
  );
}
