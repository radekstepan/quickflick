import { useEffect, useMemo, useRef, useState } from 'react';
import { Toolbar, ScanProgressOverlay } from './components/Toolbar';
import { Sidebar } from './components/Sidebar';
import { VideoGrid } from './components/VideoGrid';
import { GroupedVideoGrid, type VideoGroup } from './components/GroupedVideoGrid';
import { EmptyState } from './components/EmptyState';
import { FfmpegMissing } from './components/FfmpegMissing';
import { useLibrary } from './hooks/useLibrary';
import { videoMatchesTag, getMatchingTags, type Tag } from './utils/tags';
import { displayName } from './utils/displayName';
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

const VALID_SORT_KEYS: ReadonlySet<SortKey> = new Set([
  'name',
  'tags',
  'newest',
  'oldest',
  'mostViews',
  'leastViews'
]);

const SORT_KEY_STORAGE = 'qf:sortKey';

function loadSortKey(): SortKey {
  try {
    const raw = localStorage.getItem(SORT_KEY_STORAGE);
    if (raw && VALID_SORT_KEYS.has(raw as SortKey)) return raw as SortKey;
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

type Sorter = (a: VideoWithThumbs, b: VideoWithThumbs) => number;

function byFilename(roots: string[]): Sorter {
  return (a, b) =>
    displayName(a.filename, a.folder, roots).localeCompare(
      displayName(b.filename, b.folder, roots)
    );
}

function byMtime(dir: 'asc' | 'desc'): Sorter {
  return (a, b) => {
    const av = a.mtime_ms ?? 0;
    const bv = b.mtime_ms ?? 0;
    if (av === bv) return 0;
    return dir === 'desc' ? bv - av : av - bv;
  };
}

function byViewCount(dir: 'asc' | 'desc'): Sorter {
  return (a, b) => {
    const av = a.view_count ?? 0;
    const bv = b.view_count ?? 0;
    if (av === bv) return 0;
    return dir === 'desc' ? bv - av : av - bv;
  };
}

function pickSorter(key: SortKey, roots: string[]): Sorter {
  switch (key) {
    case 'newest':
      return byMtime('desc');
    case 'oldest':
      return byMtime('asc');
    case 'mostViews':
      return byViewCount('desc');
    case 'leastViews':
      return byViewCount('asc');
    case 'name':
      return byFilename(roots);
    case 'tags':
      // For 'tags', the actual ordering is by group then by frozen order.
      // We still return a fallback so capture doesn't crash on empty sets.
      return byFilename(roots);
  }
}

export default function App() {
  const lib = useLibrary();
  const [selectedRoot, setSelectedRoot] = useState<string | null>(null);
  const [selectedTag, setSelectedTag] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [ffmpegDismissed, setFfmpegDismissed] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>(loadSortKey);

  // Frozen display order: captured once when lib.videos first becomes
  // non-empty, and re-captured when the user picks a new sort key. Click
  // events, rescans, and filter changes do NOT update this order during
  // the current session. The new order takes effect on next app launch.
  const [frozenOrder, setFrozenOrder] = useState<number[] | null>(null);
  const capturedSortKeyRef = useRef<SortKey | null>(null);
  const initialCapturedRef = useRef(false);

  useEffect(() => {
    saveSortKey(sortKey);
  }, [sortKey]);

  useEffect(() => {
    if (lib.roots.length === 0) {
      if (selectedRoot !== null) setSelectedRoot(null);
      return;
    }
    if (selectedRoot === null || !lib.roots.includes(selectedRoot)) {
      setSelectedRoot(lib.roots[0]);
    }
  }, [lib.roots, selectedRoot]);

  // Capture (or re-capture on sort change). Narrow deps on purpose:
  // we explicitly do NOT want this to re-run on rescan, filter, or
  // lib.videos mutation.
  useEffect(() => {
    if (lib.videos.length === 0) {
      if (frozenOrder !== null) setFrozenOrder(null);
      capturedSortKeyRef.current = null;
      initialCapturedRef.current = false;
      return;
    }
    if (initialCapturedRef.current && capturedSortKeyRef.current === sortKey) return;

    // For 'tags', capture in alphabetical-by-group order, then frozen
    // order within each group. For everything else, capture via the
    // chosen sorter.
    let captured: number[];
    if (sortKey === 'tags') {
      const groups = buildTagGroups(lib.videos, lib.tags, lib.roots);
      captured = Array.from(new Set(groups.flatMap((g) => g.videos.map((v) => v.id))));
    } else {
      const sorter = pickSorter(sortKey, lib.roots);
      captured = [...lib.videos].sort(sorter).map((v) => v.id);
    }
    setFrozenOrder(captured);
    capturedSortKeyRef.current = sortKey;
    initialCapturedRef.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lib.videos.length, sortKey]);

  // Sync frozen order with lib.videos on rescan: drop missing IDs,
  // append newly-discovered IDs to the end.
  useEffect(() => {
    if (frozenOrder === null) return;
    const libIds = new Set(lib.videos.map((v) => v.id));
    const known = new Set(frozenOrder);
    const kept = frozenOrder.filter((id) => libIds.has(id));
    const added = lib.videos.map((v) => v.id).filter((id) => !known.has(id));
    if (kept.length !== frozenOrder.length || added.length > 0) {
      setFrozenOrder([...kept, ...added]);
    }
  }, [lib.videos, frozenOrder]);

  const videosById = useMemo(
    () => new Map(lib.videos.map((v) => [v.id, v])),
    [lib.videos]
  );

  // Apply current root/search/tag filter on top of the frozen order.
  const displayIds = useMemo(() => {
    if (frozenOrder === null) return [] as number[];
    const q = search.trim().toLowerCase();
    return frozenOrder.filter((id) => {
      const v = videosById.get(id);
      if (!v) return false;
      if (selectedRoot) {
        if (v.folder !== selectedRoot && !v.folder.startsWith(`${selectedRoot}/`)) {
          return false;
        }
      }
      if (q) {
        const name = normalizeForSearch(displayName(v.filename, v.folder, lib.roots));
        if (!name.includes(q)) return false;
      }
      if (selectedTag && !videoMatchesTag(v, selectedTag, lib.roots)) return false;
      return true;
    });
  }, [frozenOrder, videosById, selectedRoot, selectedTag, search, lib.roots]);

  const displayVideos = useMemo(
    () =>
      displayIds
        .map((id) => videosById.get(id))
        .filter((v): v is VideoWithThumbs => v !== undefined),
    [displayIds, videosById]
  );

  const groupsByTag = useMemo<VideoGroup[]>(() => {
    if (lib.tags.length === 0) {
      return [{ tag: null, videos: displayVideos }];
    }
    return buildTagGroups(displayVideos, lib.tags, lib.roots);
  }, [displayVideos, lib.tags, lib.roots]);

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
        hasRoots={lib.roots.length > 0}
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
        {lib.videos.length === 0 || displayVideos.length === 0 ? (
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
            getViewCount={lib.getViewCount}
          />
        ) : (
          <VideoGrid
            videos={displayVideos}
            roots={lib.roots}
            onOpen={lib.openVideo}
            getViewCount={lib.getViewCount}
          />
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

function buildTagGroups(
  videos: VideoWithThumbs[],
  tags: ReadonlyArray<Tag>,
  roots: string[]
): VideoGroup[] {
  if (tags.length === 0) {
    return [{ tag: null, videos }];
  }
  const buckets = new Map<string, VideoWithThumbs[]>();
  const bucketSeen = new Map<string, Set<number>>();
  for (const t of tags) buckets.set(t.name, []);
  const untagged: VideoWithThumbs[] = [];
  const untaggedSeen = new Set<number>();
  for (const v of videos) {
    const matches = getMatchingTags(v, tags, roots);
    if (matches.length === 0) {
      if (untaggedSeen.has(v.id)) continue;
      untaggedSeen.add(v.id);
      untagged.push(v);
      continue;
    }
    for (const name of matches) {
      const bucket = buckets.get(name);
      if (!bucket) continue;
      let seen = bucketSeen.get(name);
      if (!seen) {
        seen = new Set<number>();
        bucketSeen.set(name, seen);
      }
      if (seen.has(v.id)) continue;
      seen.add(v.id);
      bucket.push(v);
    }
  }
  const out: VideoGroup[] = [];
  const tagNames = Array.from(buckets.keys()).sort((a, b) => a.localeCompare(b));
  for (const name of tagNames) {
    const bucket = buckets.get(name)!;
    if (bucket.length === 0) continue;
    out.push({ tag: name, videos: bucket });
  }
  if (untagged.length > 0) {
    out.push({ tag: null, videos: untagged });
  }
  return out;
}
