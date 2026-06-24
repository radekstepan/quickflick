import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Toolbar, ScanProgressOverlay } from './components/Toolbar';
import { Sidebar } from './components/Sidebar';
import { VideoGrid } from './components/VideoGrid';
import { GroupedVideoGrid, type VideoGroup } from './components/GroupedVideoGrid';
import { EmptyState } from './components/EmptyState';
import { FfmpegMissing } from './components/FfmpegMissing';
import { GearButton } from './components/GearButton';
import { ThemeButton } from './components/ThemeButton';
import { SettingsModal } from './components/SettingsModal';
import { OpenToastHost } from './components/OpenToast';
import { useLibrary } from './hooks/useLibrary';
import { useSettings } from './hooks/useSettings';
import { videoMatchesTag, getMatchingTags, type Tag } from './utils/tags';
import { displayName } from './utils/displayName';
import type { SortKey } from './components/SortDropdown';
import type { VideoWithThumbs } from '@shared/types';

export function formatSearchInput(raw: string): string {
  return raw
    .replace(/[-_.]+/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => (/^\d+$/.test(w) ? w : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(' ');
}

export function normalizeForSearch(s: string): string {
  return s.toLowerCase().replace(/[-_.]+/g, ' ');
}

const VALID_SORT_KEYS: ReadonlySet<SortKey> = new Set([
  'name',
  'tags',
  'newest',
  'oldest',
  'popularity',
  'popularity_asc'
]);

const SORT_KEY_STORAGE = 'qf:sortKey';
const SELECTED_ROOT_STORAGE = 'qf:selectedRoot';
const SELECTED_TAG_STORAGE = 'qf:selectedTag';
const FILTER_UNTAGGED_STORAGE = 'qf:filterUntagged';
const SEARCH_STORAGE = 'qf:search';

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

function loadStoredString(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function loadStoredBoolean(key: string, fallback: boolean): boolean {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return fallback;
    return raw === '1';
  } catch {
    return fallback;
  }
}

function saveStoredString(key: string, value: string | null): void {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // ignore quota / disabled storage
  }
}

function saveStoredBoolean(key: string, value: boolean): void {
  try {
    localStorage.setItem(key, value ? '1' : '0');
  } catch {
    // ignore
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

function byPopularity(dir: 'asc' | 'desc'): Sorter {
  return (a, b) => {
    const av = a.view_count ?? 0;
    const bv = b.view_count ?? 0;
    if (av !== bv) return dir === 'desc' ? bv - av : av - bv;
    const at = a.view_time_ms ?? 0;
    const bt = b.view_time_ms ?? 0;
    if (at === bt) return 0;
    return dir === 'desc' ? bt - at : at - bt;
  };
}

function pickSorter(key: SortKey, roots: string[]): Sorter {
  switch (key) {
    case 'newest':
      return byMtime('desc');
    case 'oldest':
      return byMtime('asc');
    case 'popularity':
      return byPopularity('desc');
    case 'popularity_asc':
      return byPopularity('asc');
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
  const settingsState = useSettings();
  const [selectedRoot, setSelectedRoot] = useState<string | null>(() => loadStoredString(SELECTED_ROOT_STORAGE));
  const [selectedTag, setSelectedTag] = useState<string | null>(() => loadStoredString(SELECTED_TAG_STORAGE));
  const [filterUntagged, setFilterUntagged] = useState<boolean>(() => loadStoredBoolean(FILTER_UNTAGGED_STORAGE, false));
  const [search, setSearch] = useState<string>(() => loadStoredString(SEARCH_STORAGE) ?? '');
  const [ffmpegDismissed, setFfmpegDismissed] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>(loadSortKey);
  // Timestamp captured when the user picks a sort. Used by buildDateGroups
  // so the bucket boundaries (Today / Yesterday / This week / ...) don't
  // drift if the app stays open across midnight. Refreshed whenever
  // sortKey changes.
  const [sortAppliedAt, setSortAppliedAt] = useState<number>(() => Date.now());

  const handleSelectTag = useCallback((name: string | null) => {
    setSelectedTag(name);
    setFilterUntagged(false);
  }, []);

  const handleSelectUntagged = useCallback(() => {
    setFilterUntagged((prev) => !prev);
    setSelectedTag(null);
  }, []);

  const clearFilters = useCallback(() => {
    setSelectedRoot(null);
    setSelectedTag(null);
    setFilterUntagged(false);
    setSearch('');
  }, []);

  const untaggedCount = useMemo(() => {
    if (lib.tags.length === 0) return lib.videos.length;
    const seen = new Set<number>();
    let n = 0;
    for (const v of lib.videos) {
      if (seen.has(v.id)) continue;
      if (getMatchingTags(v, lib.tags, lib.roots).length === 0) {
        seen.add(v.id);
        n++;
      }
    }
    return n;
  }, [lib.videos, lib.tags, lib.roots]);

  // Frozen display order: captured once when lib.videos first becomes
  // non-empty, and re-captured when the user picks a new sort key. Click
  // events, rescans, and filter changes do NOT update this order during
  // the current session. The new order takes effect on next app launch.
  // View counts and view time on cards update live via the
  // video:viewed IPC event regardless of which sort is active.
  const [frozenOrder, setFrozenOrder] = useState<number[] | null>(null);
  const capturedSortKeyRef = useRef<SortKey | null>(null);
  const initialCapturedRef = useRef(false);

  useEffect(() => {
    saveSortKey(sortKey);
  }, [sortKey]);

  useEffect(() => {
    saveStoredString(SELECTED_ROOT_STORAGE, selectedRoot);
  }, [selectedRoot]);

  useEffect(() => {
    saveStoredString(SELECTED_TAG_STORAGE, selectedTag);
  }, [selectedTag]);

  useEffect(() => {
    saveStoredBoolean(FILTER_UNTAGGED_STORAGE, filterUntagged);
  }, [filterUntagged]);

  useEffect(() => {
    saveStoredString(SEARCH_STORAGE, search);
  }, [search]);

  useEffect(() => {
    setSortAppliedAt(Date.now());
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

  // If the persisted tag no longer exists in the current tag set, clear it.
  useEffect(() => {
    if (selectedTag === null) return;
    if (lib.tags.length > 0 && !lib.tags.some((t) => t.name === selectedTag)) {
      setSelectedTag(null);
    }
  }, [lib.tags, selectedTag]);

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

  // Sync frozen order with lib.videos on rescan: drop missing IDs and
  // merge newly-discovered IDs at the correct mtime position when the
  // active sort is mtime-based (newest/oldest). For other sorts, append
  // to the end — intra-bucket order isn't strictly defined for them.
  useEffect(() => {
    if (frozenOrder === null) return;
    const libIds = new Set(lib.videos.map((v) => v.id));
    const known = new Set(frozenOrder);
    const kept = frozenOrder.filter((id) => libIds.has(id));
    const added = lib.videos.filter((v) => !known.has(v.id));
    if (kept.length === frozenOrder.length && added.length === 0) return;

    if (sortKey === 'newest' || sortKey === 'oldest') {
      const videosById = new Map(lib.videos.map((v) => [v.id, v]));
      const dir = sortKey === 'newest' ? -1 : 1;
      added.sort((a, b) => dir * (a.mtime_ms - b.mtime_ms));
      const merged: number[] = [];
      let addedIdx = 0;
      for (const id of kept) {
        const keptV = videosById.get(id);
        const keptMtime = keptV?.mtime_ms ?? 0;
        while (addedIdx < added.length) {
          const addedV = added[addedIdx];
          if (dir * (addedV.mtime_ms - keptMtime) < 0) {
            merged.push(addedV.id);
            addedIdx++;
          } else {
            break;
          }
        }
        merged.push(id);
      }
      while (addedIdx < added.length) {
        merged.push(added[addedIdx++].id);
      }
      setFrozenOrder(merged);
    } else {
      setFrozenOrder([...kept, ...added.map((v) => v.id)]);
    }
  }, [lib.videos, frozenOrder, sortKey]);

  const videosById = useMemo(
    () => new Map(lib.videos.map((v) => [v.id, v])),
    [lib.videos]
  );

  // Cards always show the live view_count from lib.videos, which is
  // patched in place by the video:viewed IPC event after the user
  // returns to the app. The popularity sort freezes the ORDER so the
  // grid doesn't shuffle mid-session, but the per-card "X views · Ym"
  // badge ticks up immediately.
  const getDisplayViewCount = useCallback(
    (_id: number, fallback: number): number => fallback,
    []
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
      if (filterUntagged && getMatchingTags(v, lib.tags, lib.roots).length > 0) return false;
      return true;
    });
  }, [frozenOrder, videosById, selectedRoot, selectedTag, filterUntagged, search, lib.roots, lib.tags]);

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

  const groupsByDate = useMemo<VideoGroup[]>(() => {
    if (sortKey !== 'newest' && sortKey !== 'oldest') return [];
    return buildDateGroups(displayVideos, sortKey, sortAppliedAt);
  }, [displayVideos, sortKey, sortAppliedAt]);

  // Single source of truth for the grouped view: non-null when the
  // current sort key is one of the grouping sorts (tags, newest, oldest).
  const groups = useMemo<VideoGroup[] | null>(() => {
    if (sortKey === 'tags') return groupsByTag;
    if (sortKey === 'newest' || sortKey === 'oldest') return groupsByDate;
    return null;
  }, [sortKey, groupsByTag, groupsByDate]);

  const hasActiveFilter =
    selectedRoot !== null || selectedTag !== null || filterUntagged || search.trim() !== '';

  const resetScrollKey = `${sortKey}|${selectedRoot}|${selectedTag}|${filterUntagged}|${search}`;

  if (lib.loading) {
    return (
      <div className="empty">
        <div className="empty-title">Loading…</div>
      </div>
    );
  }

  return (
    <div className="app">
      <div className="titlebar">
        <span>QuickFlick</span>
        <div className="titlebar-right">
          <ThemeButton />
          <GearButton onClick={() => setSettingsOpen(true)} />
        </div>
      </div>

      <Toolbar
        hasRoots={lib.roots.length > 0}
        isScanning={lib.isScanning}
        onAdd={lib.addFolder}
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
        untaggedCount={untaggedCount}
        selectedRoot={selectedRoot}
        selectedTag={selectedTag}
        filterUntagged={filterUntagged}
        isScanning={lib.isScanning}
        onSelectRoot={setSelectedRoot}
        onSelectTag={handleSelectTag}
        onSelectUntagged={handleSelectUntagged}
        onRemoveRoot={lib.removeFolder}
        onRescan={lib.rescan}
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
            onClearFilters={clearFilters}
            hasActiveFilter={hasActiveFilter && lib.videos.length > 0}
          />
        ) : groups ? (
          <GroupedVideoGrid
            groups={groups}
            roots={lib.roots}
            tags={lib.tags}
            onOpen={lib.openVideo}
            onOpened={lib.onVideoOpened}
            getViewCount={getDisplayViewCount}
            onAddTag={lib.setVideoTag}
            onRemoveTag={lib.removeVideoTag}
            resetScrollKey={resetScrollKey}
          />
        ) : (
          <VideoGrid
            videos={displayVideos}
            roots={lib.roots}
            tags={lib.tags}
            onOpen={lib.openVideo}
            onOpened={lib.onVideoOpened}
            getViewCount={getDisplayViewCount}
            onAddTag={lib.setVideoTag}
            onRemoveTag={lib.removeVideoTag}
            resetScrollKey={resetScrollKey}
          />
        )}
      </div>

      {lib.ffmpeg && !lib.ffmpeg.ok && !ffmpegDismissed ? (
        <FfmpegMissing
          status={lib.ffmpeg}
          onDismiss={() => setFfmpegDismissed(true)}
        />
      ) : null}

      {settingsOpen && settingsState.settings && settingsState.players ? (
        <SettingsModal
          settings={settingsState.settings}
          players={settingsState.players}
          onClose={() => setSettingsOpen(false)}
          onSetDefaultPlayer={settingsState.setDefaultPlayer}
          onPlayersChanged={settingsState.refreshPlayers}
        />
      ) : null}

      <OpenToastHost />
    </div>
  );
}

export function buildTagGroups(
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

const DATE_BUCKETS_NEWEST = ['Today', 'Yesterday', 'This week', 'This month', 'Older', 'Unknown'] as const;
const DATE_BUCKETS_OLDEST = ['Older', 'This month', 'This week', 'Yesterday', 'Today', 'Unknown'] as const;

export function getDateBucket(mtimeMs: number, now: Date): string {
  if (!mtimeMs || mtimeMs <= 0) return 'Unknown';
  const mtime = new Date(mtimeMs);
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startOfYesterday = startOfToday - 24 * 60 * 60 * 1000;
  const startOfWeek = startOfToday - 7 * 24 * 60 * 60 * 1000;
  const startOfMonth = startOfToday - 30 * 24 * 60 * 60 * 1000;
  if (mtimeMs >= startOfToday) return 'Today';
  if (mtimeMs >= startOfYesterday) return 'Yesterday';
  if (mtimeMs >= startOfWeek) return 'This week';
  if (mtimeMs >= startOfMonth) return 'This month';
  return 'Older';
}

export function buildDateGroups(
  videos: VideoWithThumbs[],
  sortKey: 'newest' | 'oldest',
  frozenAt: number
): VideoGroup[] {
  const order = sortKey === 'newest' ? DATE_BUCKETS_NEWEST : DATE_BUCKETS_OLDEST;
  const now = new Date(frozenAt);
  const buckets = new Map<string, VideoWithThumbs[]>();
  for (const name of order) buckets.set(name, []);
  for (const v of videos) {
    const name = getDateBucket(v.mtime_ms, now);
    buckets.get(name)!.push(v);
  }
  const out: VideoGroup[] = [];
  for (const name of order) {
    const bucket = buckets.get(name)!;
    if (bucket.length === 0) continue;
    out.push({ tag: name, videos: bucket });
  }
  return out;
}
