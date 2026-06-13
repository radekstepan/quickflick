import { useMemo, useState } from 'react';
import { Toolbar, ScanProgressOverlay } from './components/Toolbar';
import { Sidebar } from './components/Sidebar';
import { VideoGrid } from './components/VideoGrid';
import { EmptyState } from './components/EmptyState';
import { FfmpegMissing } from './components/FfmpegMissing';
import { useLibrary } from './hooks/useLibrary';

export default function App() {
  const lib = useLibrary();
  const [selectedRoot, setSelectedRoot] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [ffmpegDismissed, setFfmpegDismissed] = useState(false);

  const filtered = useMemo(() => {
    let rows = lib.videos;
    if (selectedRoot) {
      rows = rows.filter(
        (v) => v.folder === selectedRoot || v.folder.startsWith(`${selectedRoot}/`)
      );
    }
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      rows = rows.filter((v) => v.filename.toLowerCase().includes(q));
    }
    return rows;
  }, [lib.videos, selectedRoot, search]);

  if (lib.loading) {
    return (
      <div className="empty">
        <div className="empty-title">Loading…</div>
      </div>
    );
  }

  return (
    <div className="app">
      <div className="titlebar">QuickFlick</div>

      <Toolbar
        roots={lib.roots}
        isScanning={lib.isScanning}
        onAdd={lib.addFolder}
        onRescan={lib.rescan}
        onRetryThumbs={lib.retryFailedThumbs}
        onResetAllThumbs={lib.resetAllThumbs}
        thumbFailures={lib.thumbFailures}
        search={search}
        onSearchChange={setSearch}
      />

      <Sidebar
        roots={lib.roots}
        videos={lib.videos}
        selectedRoot={selectedRoot}
        onSelectRoot={setSelectedRoot}
        onRemoveRoot={lib.removeFolder}
      />

      <div className="main">
        <ScanProgressOverlay progress={lib.scanProgress} />
        {lib.videos.length === 0 || filtered.length === 0 ? (
          <EmptyState
            hasLibrary={lib.roots.length > 0}
            videoCount={lib.videos.length}
            onPick={lib.addFolder}
            onRescan={lib.rescan}
          />
        ) : (
          <VideoGrid videos={filtered} onOpen={lib.openVideo} />
        )}
      </div>

      {lib.ffmpeg && !lib.ffmpeg.ok && !ffmpegDismissed ? (
        <FfmpegMissing
          status={lib.ffmpeg}
          onDismiss={() => setFfmpegDismissed(true)}
        />
      ) : null}
    </div>
  );
}
