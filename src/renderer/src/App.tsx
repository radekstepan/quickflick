import { useEffect, useMemo, useState } from 'react';
import { Toolbar, ScanProgressOverlay } from './components/Toolbar';
import { Sidebar } from './components/Sidebar';
import { VideoGrid } from './components/VideoGrid';
import { GroupedVideoGrid, type VideoGroup } from './components/GroupedVideoGrid';
import { EmptyState } from './components/EmptyState';
import { FfmpegMissing } from './components/FfmpegMissing';
import { useLibrary } from './hooks/useLibrary';
import { videoMatchesTag, getMatchingTags } from './utils/tags';
import type { SortKey } from './components/SortDropdown';
import type { VideoWithThumbs } from '@shared/types';

function formatSearchInput(raw: string): string {
  return raw
    .replace(/[-_.]+/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => (/^\d+$/.test(w) ? w : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(' ');
}

function normalizeForSearch(s: string): string {
  return s.toLowerCase().replace(/[-_.]+/g, ' ');
}

function byFilename(a: VideoWithThumbs, b: VideoWithThumbs): number {
  return a.filename.localeCompare(b.filename);
}

const SORT_KEY_STORAGE = 'qf:sortKey';

function loadSortKey(): SortKey {
  try {
    const raw = localStorage.getItem(SORT_KEY_STORAGE);
    if (raw === 'name' || raw === 'tags') return raw;
  } catch {
    // ignore
  }
  return 'name';
}

function saveSortKey(key: SortKey): void {
  try {
    localStorage.setItem(SORT_KEY_STORAGE, key);
  } catch {
    // ignore quota / disabled storage
  }
}

export default function App() {
  const lib = useLibrary();
  const [selectedRoot, setSelectedRoot] = useState<string | null>(null);
  const [selectedTag, setSelectedTag] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [ffmpegDismissed, setFfmpegDismissed] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>(loadSortKey);

  useEffect(() => {
    saveSortKey(sortKey);
  }, [sortKey]);

  const filtered = useMemo(() => {
    let rows = lib.videos;
    if (selectedRoot) {
      rows = rows.filter(
        (v) => v.folder === selectedRoot || v.folder.startsWith(`${selectedRoot}/`)
      );
    }
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      rows = rows.filter((v) => normalizeForSearch(v.filename).includes(q));
    }
    if (selectedTag) {
      rows = rows.filter((v) => videoMatchesTag(v, selectedTag, lib.roots));
    }
    return rows;
  }, [lib.videos, selectedRoot, selectedTag, search, lib.roots]);

  const sortedByName = useMemo(
    () => [...filtered].sort(byFilename),
    [filtered]
  );

  const groupsByTag = useMemo<VideoGroup[]>(() => {
    if (lib.tags.length === 0) {
      return [{ tag: null, videos: [...filtered].sort(byFilename) }];
    }
    const buckets = new Map<string, VideoWithThumbs[]>();
    for (const t of lib.tags) buckets.set(t.name, []);
    const untagged: VideoWithThumbs[] = [];
    for (const v of filtered) {
      const matches = getMatchingTags(v, lib.tags, lib.roots);
      if (matches.length === 0) {
        untagged.push(v);
        continue;
      }
      for (const name of matches) {
        const bucket = buckets.get(name);
        if (bucket) bucket.push(v);
      }
    }
    const out: VideoGroup[] = [];
    const tagNames = Array.from(buckets.keys()).sort((a, b) => a.localeCompare(b));
    for (const name of tagNames) {
      const videos = buckets.get(name)!;
      if (videos.length === 0) continue;
      videos.sort(byFilename);
      out.push({ tag: name, videos });
    }
    if (untagged.length > 0) {
      untagged.sort(byFilename);
      out.push({ tag: null, videos: untagged });
    }
    return out;
  }, [filtered, lib.tags, lib.roots]);

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
        onSearchChange={(s) => setSearch(formatSearchInput(s))}
        sortKey={sortKey}
        onSortChange={setSortKey}
      />

      <Sidebar
        roots={lib.roots}
        videos={lib.videos}
        tags={lib.tags}
        selectedRoot={selectedRoot}
        selectedTag={selectedTag}
        onSelectRoot={setSelectedRoot}
        onSelectTag={setSelectedTag}
        onRemoveRoot={lib.removeFolder}
        onHideTag={lib.hideTag}
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
        ) : sortKey === 'tags' ? (
          <GroupedVideoGrid
            groups={groupsByTag}
            roots={lib.roots}
            onOpen={lib.openVideo}
          />
        ) : (
          <VideoGrid videos={sortedByName} roots={lib.roots} onOpen={lib.openVideo} />
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
