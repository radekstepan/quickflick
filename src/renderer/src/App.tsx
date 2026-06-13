import { useMemo, useState } from 'react';
import { Toolbar, ScanProgressOverlay } from './components/Toolbar';
import { Sidebar } from './components/Sidebar';
import { VideoGrid } from './components/VideoGrid';
import { EmptyState } from './components/EmptyState';
import { FfmpegMissing } from './components/FfmpegMissing';
import { useLibrary } from './hooks/useLibrary';

export default function App() {
  const lib = useLibrary();
  const [selectedFolder, setSelectedFolder] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [ffmpegDismissed, setFfmpegDismissed] = useState(false);

  const filtered = useMemo(() => {
    let rows = lib.videos;
    if (selectedFolder) {
      rows = rows.filter(
        (v) => v.folder === selectedFolder || v.folder.startsWith(`${selectedFolder}/`)
      );
    }
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      rows = rows.filter((v) => v.filename.toLowerCase().includes(q));
    }
    return rows;
  }, [lib.videos, selectedFolder, search]);

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
        library={lib.library}
        isScanning={lib.isScanning}
        onPick={lib.pickFolder}
        onRescan={lib.rescan}
        search={search}
        onSearchChange={setSearch}
      />

      <Sidebar
        videos={lib.videos}
        selected={selectedFolder}
        onSelect={setSelectedFolder}
        rootPath={lib.library}
      />

      <div className="main">
        <ScanProgressOverlay progress={lib.scanProgress} />
        {lib.videos.length === 0 || filtered.length === 0 ? (
          <EmptyState
            hasLibrary={Boolean(lib.library)}
            videoCount={lib.videos.length}
            onPick={lib.pickFolder}
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
