import { useEffect, useRef, useState, useCallback, useMemo, useTransition } from 'react';
import { api } from '../api';
import type {
  FfmpegStatus,
  OpenResult,
  ScanProgress,
  ScanResult,
  ThumbnailFailure,
  VideoWithThumbs
} from '@shared/types';
import { extractTagsWithFolders, countVideosByTag, type Tag } from '../utils/tags';
import { showOpenToast } from '../components/OpenToast';

export interface LibraryState {
  roots: string[];
  videos: VideoWithThumbs[];
  tags: Tag[];
  /** Transition-consistent tag list with counts. Referentially stable across
   *  delete clicks (which only touch the urgent intent states below), so
   *  aggregate memos keyed on it skip the urgent render. */
  baseTags: Tag[];
  /** Display names for pickers. Memoized once here instead of per-card. */
  tagNames: string[];
  hiddenTags: ReadonlySet<string>;
  globalExcludedTags: string[];
  /** Globally deleted names, applied urgently (same frame as the click). */
  removedTagNames: ReadonlySet<string>;
  /** Per-video optimistic tag edits, applied urgently. Entries are stable
   *  per video; cleared on reload (DB truth wins, failures roll back). */
  pendingEdits: ReadonlyMap<number, PendingVideoEdit>;
  ffmpeg: FfmpegStatus | null;
  loading: boolean;
  isScanning: boolean;
  scanProgress: ScanProgress | null;
  thumbFailures: ThumbnailFailure[];
  addFolder: () => Promise<void>;
  removeFolder: (path: string) => Promise<void>;
  rescan: () => Promise<void>;
  retryFailedThumbs: () => Promise<void>;
  resetAllThumbs: () => Promise<void>;
  reload: () => Promise<void>;
  openVideo: (id: number) => Promise<OpenResult>;
  onVideoOpened: (result: OpenResult) => void;
  hideTag: (name: string) => void;
  unhideTag: (name: string) => void;
  unhideAllTags: () => void;
  deleteTagGlobally: (name: string) => void;
  isTagUpdatePending: boolean;
  setVideoTag: (videoId: number, tagName: string) => Promise<void>;
  removeVideoTag: (videoId: number, tagName: string) => Promise<void>;
}

function isSubPathOrEqual(child: string, parent: string): boolean {
  if (child === parent) return true;
  return child.startsWith(parent + '/');
}

const HIDDEN_TAGS_KEY = 'qf:hiddenTags';

function loadHiddenTags(): Set<string> {
  try {
    const raw = localStorage.getItem(HIDDEN_TAGS_KEY);
    if (!raw) return new Set();
    const arr: unknown = JSON.parse(raw);
    if (!Array.isArray(arr)) return new Set();
    return new Set(arr.filter((x): x is string => typeof x === 'string'));
  } catch {
    return new Set();
  }
}

function saveHiddenTags(set: Set<string>): void {
  try {
    localStorage.setItem(HIDDEN_TAGS_KEY, JSON.stringify(Array.from(set)));
  } catch {
    // ignore quota / disabled storage
  }
}

/** Urgent per-video optimistic tag edit. Holds full replacement arrays so
 *  cards can render the intended state without waiting for the
 *  transitioned videos patch. Pure merge helper below is unit-tested. */
export interface PendingVideoEdit {
  tags: string[];
  excludedTags: string[];
}

export function applyPendingToVideo<T extends { tags: string[]; excludedTags: string[] }>(
  video: T,
  pending: PendingVideoEdit | undefined
): T {
  if (!pending) return video;
  if (video.tags === pending.tags && video.excludedTags === pending.excludedTags) return video;
  return { ...video, tags: pending.tags, excludedTags: pending.excludedTags };
}

export function useLibrary(): LibraryState {
  const [roots, setRoots] = useState<string[]>([]);
  const [videos, setVideos] = useState<VideoWithThumbs[]>([]);
  const [hiddenTags, setHiddenTags] = useState<Set<string>>(() => loadHiddenTags());
  const [ffmpeg, setFfmpeg] = useState<FfmpegStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [isScanning, setIsScanning] = useState(false);
  const [scanProgress, setScanProgress] = useState<ScanProgress | null>(null);
  const [thumbFailures, setThumbFailures] = useState<ThumbnailFailure[]>([]);
  const [userTagNames, setUserTagNames] = useState<string[]>([]);
  const [globalExcludedTags, setGlobalExcludedTags] = useState<string[]>([]);
  // Tags deleted via deleteTagGlobally, hidden from the displayed list on
  // the same frame as the click (see tags memo below). Entries are dropped
  // once reload() confirms the DB state, so a failed write rolls back to
  // the tag reappearing instead of diverging silently.
  const [removedTagNames, setRemovedTagNames] = useState<Set<string>>(new Set());
  const [pendingEdits, setPendingEdits] = useState<Map<number, PendingVideoEdit>>(new Map());
  // Source-state updates (videos / userTagNames / globalExcludedTags) drive
  // O(V·T) aggregate recomputes. They run inside startTransition so the
  // urgent render — intent flags only — paints instantly and the heavy work
  // lands concurrently without blocking input.
  const [isTagUpdatePending, startTagUpdate] = useTransition();

  // Ref mirrors for synchronous reads inside event handlers (refs are
  // current there, unlike stale closures over state).
  const videosRef = useRef<VideoWithThumbs[]>([]);
  videosRef.current = videos;
  const pendingEditsRef = useRef<Map<number, PendingVideoEdit>>(pendingEdits);
  pendingEditsRef.current = pendingEdits;

  // Effective per-video tag arrays: pending overlay wins over the
  // (possibly transition-lagged) videos state.
  const readLiveVideoTags = useCallback(
    (videoId: number): { tags: string[]; excludedTags: string[] } => {
      const pending = pendingEditsRef.current.get(videoId);
      if (pending) return pending;
      const v = videosRef.current.find((x) => x.id === videoId);
      return { tags: v?.tags ?? [], excludedTags: v?.excludedTags ?? [] };
    },
    []
  );

  // Lowercased global blocklist for O(1) match checks. Stable reference
  // unless the underlying list changes.
  const globalExcludedSet = useMemo(() => {
    const s = new Set<string>();
    for (const n of globalExcludedTags) s.add(n.toLowerCase());
    return s;
  }, [globalExcludedTags]);

  const hideTag = useCallback((name: string) => {
    setHiddenTags((prev) => {
      if (prev.has(name)) return prev;
      const next = new Set(prev);
      next.add(name);
      saveHiddenTags(next);
      return next;
    });
  }, []);

  const unhideTag = useCallback((name: string) => {
    setHiddenTags((prev) => {
      if (!prev.has(name)) return prev;
      const next = new Set(prev);
      next.delete(name);
      saveHiddenTags(next);
      return next;
    });
  }, []);

  const unhideAllTags = useCallback(() => {
    setHiddenTags(() => {
      const next = new Set<string>();
      saveHiddenTags(next);
      return next;
    });
  }, []);

  const reload = useCallback(async () => {
    const [rows, userTags, globalExcluded] = await Promise.all([
      api.listVideos(),
      api.getAllUserTagNames(),
      api.getGlobalExcludedTagNames()
    ]);
    setVideos(rows);
    setUserTagNames(userTags);
    setGlobalExcludedTags(globalExcluded);
    // DB truth wins: drop per-video optimistic overlays (a failed write
    // rolls back to the chip reappearing via the refreshed rows).
    setPendingEdits((prev) => (prev.size === 0 ? prev : new Map()));
    // Reconcile the instant-hide set against DB truth: drop only names
    // proven alive (explicitly present AND not globally blocked). Anything
    // globally blocked or fully gone stays hidden — this also avoids a
    // flash-back race if a reload lands before the delete IPC resolves.
    const aliveUser = new Set(userTags.map((n) => n.toLowerCase()));
    const blocked = new Set(globalExcluded.map((n) => n.toLowerCase()));
    setRemovedTagNames((prev) => {
      let changed = false;
      const next = new Set<string>();
      for (const n of prev) {
        if (aliveUser.has(n) && !blocked.has(n)) {
          changed = true;
          continue;
        }
        next.add(n);
      }
      return changed ? next : prev;
    });
  }, []);

  const setVideoTag = useCallback(async (videoId: number, tagName: string) => {
    const lc = tagName.toLowerCase();
    // Urgent: per-video optimistic overlay so the chip appears on the same
    // frame. The videos patch + userTagNames update run in the transition.
    const cur = readLiveVideoTags(videoId);
    const tags = cur.tags.some((t) => t.toLowerCase() === lc)
      ? cur.tags
      : [...cur.tags, tagName].sort((a, b) => a.localeCompare(b));
    const excludedTags = cur.excludedTags.filter((t) => t.toLowerCase() !== lc);
    setPendingEdits((prev) => {
      const next = new Map(prev);
      next.set(videoId, { tags, excludedTags });
      return next;
    });
    startTagUpdate(() => {
      setVideos((prev) => {
        const idx = prev.findIndex((v) => v.id === videoId);
        if (idx === -1) return prev;
        const cur = prev[idx];
        const hasUser = cur.tags.some((t) => t.toLowerCase() === lc);
        const hasExcluded = cur.excludedTags.some((t) => t.toLowerCase() === lc);
        if (hasUser && !hasExcluded) return prev;
        const next = prev.slice();
        next[idx] = {
          ...cur,
          tags: hasUser ? cur.tags : [...cur.tags, tagName].sort((a, b) => a.localeCompare(b)),
          excludedTags: cur.excludedTags.filter((t) => t.toLowerCase() !== lc)
        };
        return next;
      });
      setUserTagNames((prev) =>
        prev.some((n) => n.toLowerCase() === lc) ? prev : [...prev, tagName].sort()
      );
    });
    void api.setVideoTag(videoId, tagName).catch((e) => {
      console.error('setVideoTag failed:', e);
      void reload();
    });
  }, [reload, readLiveVideoTags, startTagUpdate]);

  const removeVideoTag = useCallback(async (videoId: number, tagName: string) => {
    const lc = tagName.toLowerCase();
    // Urgent: strip the explicit row AND record the per-video exclusion
    // together as an overlay, so an auto-matching tag disappears on the
    // same frame. The videos patch runs in the transition.
    const cur = readLiveVideoTags(videoId);
    const tags = cur.tags.filter((t) => t.toLowerCase() !== lc);
    const excludedTags = cur.excludedTags.some((t) => t.toLowerCase() === lc)
      ? cur.excludedTags
      : [...cur.excludedTags, tagName].sort((a, b) => a.localeCompare(b));
    setPendingEdits((prev) => {
      const next = new Map(prev);
      next.set(videoId, { tags, excludedTags });
      return next;
    });
    startTagUpdate(() => {
      setVideos((prev) => {
        const idx = prev.findIndex((v) => v.id === videoId);
        if (idx === -1) return prev;
        const curV = prev[idx];
        const next = prev.slice();
        next[idx] = {
          ...curV,
          tags: curV.tags.filter((t) => t.toLowerCase() !== lc),
          excludedTags: curV.excludedTags.some((t) => t.toLowerCase() === lc)
            ? curV.excludedTags
            : [...curV.excludedTags, tagName].sort((a, b) => a.localeCompare(b))
        };
        return next;
      });
    });
    void api.removeVideoTag(videoId, tagName).catch((e) => {
      console.error('removeVideoTag failed:', e);
      void reload();
    });
  }, [reload, readLiveVideoTags, startTagUpdate]);

  // Global delete: remove the tag from every video and suppress future
  // auto-generation. Urgent (same frame): removedTagNames hides the row,
  // and the name is stripped from any per-video pending overlays so a
  // stale overlay can't resurrect the chip. Everything else — global set,
  // userTagNames prune, videos strip — runs in the transition, so the
  // O(V·T) recounts never block the click paint.
  const deleteTagGlobally = useCallback((name: string) => {
    const lc = name.toLowerCase();
    setRemovedTagNames((prev) => {
      if (prev.has(lc)) return prev;
      const next = new Set(prev);
      next.add(lc);
      return next;
    });
    setPendingEdits((prev) => {
      let touched = false;
      const next = new Map<number, PendingVideoEdit>();
      for (const [id, entry] of prev) {
        if (
          !entry.tags.some((t) => t.toLowerCase() === lc) &&
          !entry.excludedTags.some((t) => t.toLowerCase() === lc)
        ) {
          next.set(id, entry);
          continue;
        }
        touched = true;
        next.set(id, {
          tags: entry.tags.filter((t) => t.toLowerCase() !== lc),
          excludedTags: entry.excludedTags.filter((t) => t.toLowerCase() !== lc)
        });
      }
      return touched ? next : prev;
    });
    startTagUpdate(() => {
      setGlobalExcludedTags((prev) =>
        prev.some((n) => n.toLowerCase() === lc) ? prev : [...prev, name]
      );
      setUserTagNames((prev) => prev.filter((n) => n.toLowerCase() !== lc));
      setVideos((prev) => {
        let touched = false;
        const next = prev.map((v) => {
          if (!v.tags.some((t) => t.toLowerCase() === lc)) return v;
          touched = true;
          return { ...v, tags: v.tags.filter((t) => t.toLowerCase() !== lc) };
        });
        return touched ? next : prev;
      });
    });
    void api.deleteTagGlobally(name).catch((e) => {
      console.error('deleteTagGlobally failed:', e);
      void reload();
    });
  }, [reload, startTagUpdate]);

  const addFolder = useCallback(async () => {
    const picked = await api.pickFolder();
    if (!picked) return;
    setRoots((prev) => {
      if (prev.includes(picked)) return prev;
      if (prev.some((r) => isSubPathOrEqual(picked, r))) return prev;
      if (prev.some((r) => isSubPathOrEqual(r, picked))) return prev;
      return [...prev, picked];
    });
    await api.addRoot(picked);
    void (async () => {
      setIsScanning(true);
      setScanProgress({ phase: 'walking', processed: 0, total: 0 });
      setThumbFailures([]);
      try {
        const result: ScanResult = await api.rescan();
        console.log('Scan result:', result);
        setThumbFailures(result.failedThumbnails);
        await reload();
      } catch (e) {
        console.error('Scan failed:', e);
      } finally {
        setIsScanning(false);
        setScanProgress(null);
      }
    })();
  }, [reload]);

  const removeFolder = useCallback(
    async (path: string) => {
      const result = await api.removeRoot(path);
      if (result.removedVideos > 0) {
        setRoots((prev) => prev.filter((r) => r !== path));
        await reload();
      }
    },
    [reload]
  );

  const rescan = useCallback(async () => {
    if (isScanning) return;
    setIsScanning(true);
    setScanProgress({ phase: 'walking', processed: 0, total: 0 });
    setThumbFailures([]);
    try {
      const result = await api.rescan();
      console.log('Scan result:', result);
      setThumbFailures(result.failedThumbnails);
      await reload();
    } catch (e) {
      console.error('Scan failed:', e);
    } finally {
      setIsScanning(false);
      setScanProgress(null);
    }
  }, [isScanning, reload]);

  const retryFailedThumbs = useCallback(async () => {
    if (isScanning) return;
    setIsScanning(true);
    setScanProgress({ phase: 'walking', processed: 0, total: 0 });
    setThumbFailures([]);
    try {
      const result: ScanResult = await api.retryFailedThumbs();
      console.log('Retry result:', result);
      setThumbFailures(result.failedThumbnails);
      await reload();
    } catch (e) {
      console.error('Retry failed:', e);
    } finally {
      setIsScanning(false);
      setScanProgress(null);
    }
  }, [isScanning, reload]);

  const resetAllThumbs = useCallback(async () => {
    if (isScanning) return;
    setIsScanning(true);
    setScanProgress({ phase: 'walking', processed: 0, total: 0 });
    setThumbFailures([]);
    try {
      const result: ScanResult = await api.resetAllThumbs();
      console.log('Reset all result:', result);
      setThumbFailures(result.failedThumbnails);
      await reload();
    } catch (e) {
      console.error('Reset all failed:', e);
    } finally {
      setIsScanning(false);
      setScanProgress(null);
    }
  }, [isScanning, reload]);

  const openVideo = useCallback(async (id: number): Promise<OpenResult> => {
    try {
      return await api.openVideo(id);
    } catch (e) {
      console.error('Open failed:', e);
      return { view_count: 0, usedFallback: false, error: String(e) };
    }
  }, []);

  const onVideoOpened = useCallback((result: OpenResult) => {
    if (result.usedFallback && result.error) {
      showOpenToast(
        `Couldn't open in your default player. Falling back to system default.`
      );
    }
  }, []);

  useEffect(() => {
    let mounted = true;
    (async () => {
      const [rs, ffm, userTags, globalExcluded] = await Promise.all([
        api.getRoots(),
        api.getFfmpegStatus(),
        api.getAllUserTagNames(),
        api.getGlobalExcludedTagNames()
      ]);
      if (!mounted) return;
      setRoots(rs);
      setFfmpeg(ffm);
      setUserTagNames(userTags);
      setGlobalExcludedTags(globalExcluded);
      if (rs.length > 0) {
        const rows = await api.listVideos();
        if (mounted) setVideos(rows);
      }
      if (mounted) setLoading(false);
    })();
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    const unsub = api.onScanProgress((p) => setScanProgress(p));
    return unsub;
  }, []);

  // Auto-detected tags depend only on filenames/folders/roots — never on
  // user tag edits. Cache by a cheap file-identity signature so a tag
  // add/remove (which only swaps tag arrays on video objects) skips the
  // n-gram extraction entirely instead of redoing it for the whole library
  // before every paint. New files, renames, and root changes alter the
  // signature and recompute as before.
  const autoCacheRef = useRef<{ sig: string; rootsKey: string; value: Tag[] } | null>(null);
  let autoTags: Tag[];
  {
    let sig = String(videos.length);
    for (const v of videos) {
      sig += '\n' + v.filename + '\n' + v.folder;
    }
    const rootsKey = roots.join('\n');
    const cached = autoCacheRef.current;
    if (cached && cached.sig === sig && cached.rootsKey === rootsKey) {
      autoTags = cached.value;
    } else {
      autoTags = extractTagsWithFolders(
        videos.map((v) => ({ filename: v.filename, folder: v.folder })),
        roots
      );
      autoCacheRef.current = { sig, rootsKey, value: autoTags };
    }
  }

  // Counting matches is the other expensive half. baseTags reads videos /
  // userTagNames / globalExcludedTags, which now change only inside the
  // tag-update transition (or on scan reloads), so this recount runs in a
  // concurrent render and never blocks the click paint. The urgent render
  // only reruns the cheap display filter below.
  const baseTags = useMemo(() => {
    const candidateNames = new Set<string>();
    // Auto candidates suppressed by the global blocklist — unless the
    // name also exists as an explicit user tag (explicit wins).
    const userLc = new Set(userTagNames.map((n) => n.toLowerCase()));
    for (const t of autoTags) {
      const lc = t.name.toLowerCase();
      if (globalExcludedSet.has(lc) && !userLc.has(lc)) continue;
      candidateNames.add(t.name);
    }
    for (const name of userTagNames) candidateNames.add(name);
    const counts = countVideosByTag(
      videos,
      Array.from(candidateNames),
      roots,
      globalExcludedSet
    );
    const byName = new Map<string, Tag>();
    for (const name of candidateNames) {
      byName.set(name, { name, count: counts.get(name) ?? 0 });
    }
    return Array.from(byName.values());
    // autoTags is ref-cached by file signature; dep identity is stable
    // unless the file set actually changed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoTags, userTagNames, videos, roots, globalExcludedSet]);

  // Cheap O(T) display filter over the derived list: hidden tags, the
  // instant-hide set from deleteTagGlobally, and globally-blocked tags
  // with no explicit carriers. This memo reruns on every delete click
  // with trivial cost, so the row vanishes on the same frame.
  const tags = useMemo(() => {
    return baseTags
      .filter((t) => !hiddenTags.has(t.name))
      .filter((t) => !removedTagNames.has(t.name.toLowerCase()))
      // Globally deleted tags vanish entirely — unless an explicit user
      // tag still exists (count > 0 via explicit-wins), in which case the
      // tag stays visible for the videos that carry it.
      .filter((t) => !(globalExcludedSet.has(t.name.toLowerCase()) && t.count === 0))
      .sort((a, b) => a.name.localeCompare(b.name) || b.count - a.count);
  }, [baseTags, hiddenTags, removedTagNames, globalExcludedSet]);

  // Display names for pickers, memoized once here instead of per-card.
  // Follows the same display filtering as `tags` (minus counts ordering).
  const tagNames = useMemo(() => {
    const names: string[] = [];
    for (const t of baseTags) {
      if (hiddenTags.has(t.name)) continue;
      if (removedTagNames.has(t.name.toLowerCase())) continue;
      if (globalExcludedSet.has(t.name.toLowerCase()) && t.count === 0) continue;
      names.push(t.name);
    }
    names.sort((a, b) => a.localeCompare(b));
    return names;
  }, [baseTags, hiddenTags, removedTagNames, globalExcludedSet]);

  useEffect(() => {
    const unsubDiscovered = api.onVideosDiscovered((rows) => {
      setVideos((prev) => {
        const byId = new Map(prev.map((v) => [v.id, v]));
        for (const r of rows) byId.set(r.id, r);
        return Array.from(byId.values());
      });
    });
    const unsubThumbed = api.onVideoThumbed((row) => {
      setVideos((prev) => {
        const idx = prev.findIndex((v) => v.id === row.id);
        if (idx === -1) return [...prev, row];
        const next = prev.slice();
        next[idx] = row;
        return next;
      });
    });
    const unsubViewed = api.onVideoViewed((payload) => {
      setVideos((prev) => {
        const idx = prev.findIndex((v) => v.id === payload.id);
        if (idx === -1) return prev;
        const next = prev.slice();
        next[idx] = {
          ...next[idx],
          view_count: payload.view_count,
          view_time_ms: payload.view_time_ms
        };
        return next;
      });
    });
    return () => {
      unsubDiscovered();
      unsubThumbed();
      unsubViewed();
    };
  }, []);

  // Listen for menu commands
  useEffect(() => {
    const unsub = api.onMenuCommand((cmd) => {
      if (cmd === 'rescan') {
        void rescan();
      }
    });
    return unsub;
  }, [rescan]);

  return {
    roots,
    videos,
    tags,
    baseTags,
    tagNames,
    hiddenTags,
    globalExcludedTags,
    removedTagNames,
    pendingEdits,
    isTagUpdatePending,
    ffmpeg,
    loading,
    isScanning,
    scanProgress,
    thumbFailures,
    addFolder,
    removeFolder,
    rescan,
    retryFailedThumbs,
    resetAllThumbs,
    reload,
    openVideo,
    onVideoOpened,
    hideTag,
    unhideTag,
    unhideAllTags,
    deleteTagGlobally,
    setVideoTag,
    removeVideoTag
  };
}
