import type { ScanProgress } from '@shared/types';

interface Props {
  library: string | null;
  isScanning: boolean;
  onPick: () => void;
  onRescan: () => void;
  search: string;
  onSearchChange: (s: string) => void;
}

export function Toolbar({ library, isScanning, onPick, onRescan, search, onSearchChange }: Props) {
  return (
    <div className="toolbar">
      <div className={`toolbar-path ${!library ? 'empty' : ''}`}>
        {library ?? 'No library selected'}
      </div>
      <button className="btn" onClick={onPick} disabled={isScanning}>
        Pick folder
      </button>
      <button
        className="btn primary"
        onClick={onRescan}
        disabled={!library || isScanning}
        title="Rescan the library"
      >
        {isScanning ? <span className="spinner" /> : null}
        {isScanning ? 'Scanning…' : 'Rescan'}
      </button>
      <input
        className="search"
        type="search"
        placeholder="Search filename…"
        value={search}
        onChange={(e) => onSearchChange(e.target.value)}
        disabled={!library}
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
