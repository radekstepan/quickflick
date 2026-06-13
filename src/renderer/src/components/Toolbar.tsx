import type { ScanProgress } from '@shared/types';

interface Props {
  roots: string[];
  isScanning: boolean;
  onAdd: () => void;
  onRescan: () => void;
  onRetryThumbs: () => void;
  thumbFailures: string[];
  search: string;
  onSearchChange: (s: string) => void;
}

function basename(p: string): string {
  const parts = p.split('/').filter(Boolean);
  return parts[parts.length - 1] ?? p;
}

export function Toolbar({
  roots,
  isScanning,
  onAdd,
  onRescan,
  onRetryThumbs,
  thumbFailures,
  search,
  onSearchChange
}: Props) {
  const label = roots.length === 0
    ? 'No library selected'
    : roots.length === 1
    ? basename(roots[0])
    : `${roots.length} folders`;
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
        <button
          className="btn thumb-failures"
          onClick={onRetryThumbs}
          disabled={isScanning}
          title={`${thumbFailures.length} file(s) failed thumbnail generation. Click to retry.\n\n${thumbFailures.join('\n')}`}
        >
          {thumbFailures.length} failed
        </button>
      ) : null}
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
