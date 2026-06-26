import { useEffect, useState, useCallback, useMemo } from 'react';
import { api } from '../api';
import type {
  FfmpegStatus,
  OpenResult,
  ScanProgress,
  ScanResult,
  SceneProgress,
  SceneProgressEvent,
  ThumbnailFailure,
  VideoWithThumbs
} from '@shared/types';
import { extractTagsWithFolders, type Tag } from '../utils/tags';
import { showOpenToast } from '../components/OpenToast';

export interface LibraryState {
  roots: string[];
  videos: VideoWithThumbs[];
  tags: Tag[];
  hiddenTags: ReadonlySet<string>;
  ffmpeg: FfmpegStatus | null;
  loading: boolean;
  isScanning: boolean;
  scanProgress: ScanProgress | null;
  thumbFailures: ThumbnailFailure[];
  sceneProgress: { videoId: number; progress: SceneProgress } | null;
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
  setVideoTag: (videoId: number, tagName: string) => Promise<void>;
  removeVideoTag: (videoId: number, tagName: string) => Promise<void>;
  detectScenes: (id: number) => Promise<void>;
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

export function useLibrary(): LibraryState {
  const [roots, setRoots] = useState<string[]>([]);
  const [videos, setVideos] = useState<VideoWithThumbs[]>([]);
  const [hiddenTags, setHiddenTags] = useState<Set<string>>(() => loadHiddenTags());
  const [ffmpeg, setFfmpeg] = useState<FfmpegStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [isScanning, setIsScanning] = useState(false);
  const [scanProgress, setScanProgress] = useState<ScanProgress | null>(null);
  const [thumbFailures, setThumbFailures] = useState<ThumbnailFailure[]>([]);
  const [sceneProgress, setSceneProgress] = useState<{ videoId: number; progress: SceneProgress } | null>(null);
  const [userTagNames, setUserTagNames] = useState<string[]>([]);

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
    const [rows, userTags] = await Promise.all([api.listVideos(), api.getAllUserTagNames()]);
    setVideos(rows);
    setUserTagNames(userTags);
  }, []);

  const setVideoTag = useCallback(async (videoId: number, tagName: string) => {
    const lc = tagName.toLowerCase();
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
    await api.setVideoTag(videoId, tagName);
  }, []);

  const removeVideoTag = useCallback(async (videoId: number, tagName: string) => {
    const lc = tagName.toLowerCase();
    setVideos((prev) => {
      const idx = prev.findIndex((v) => v.id === videoId);
      if (idx === -1) return prev;
      const cur = prev[idx];
      const next = prev.slice();
      const hadUser = cur.tags.some((t) => t.toLowerCase() === lc);
      if (hadUser) {
        next[idx] = {
          ...cur,
          tags: cur.tags.filter((t) => t.toLowerCase() !== lc)
        };
      } else {
        next[idx] = {
          ...cur,
          excludedTags: cur.excludedTags.some((t) => t.toLowerCase() === lc)
            ? cur.excludedTags
            : [...cur.excludedTags, tagName].sort((a, b) => a.localeCompare(b))
        };
      }
      return next;
    });
    await api.removeVideoTag(videoId, tagName);
  }, []);

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

  const detectScenes = useCallback(async (id: number) => {
    try {
      await api.detectScenes(id);
      await reload();
    } catch (e) {
      console.error('Scene detection failed:', e);
    }
  }, [reload]);

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
      const [rs, ffm, userTags] = await Promise.all([
        api.getRoots(),
        api.getFfmpegStatus(),
        api.getAllUserTagNames()
      ]);
      if (!mounted) return;
      setRoots(rs);
      setFfmpeg(ffm);
      setUserTagNames(userTags);
      setLoading(false);
      if (rs.length > 0) {
        const rows = await api.listVideos();
        if (mounted) setVideos(rows);
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    const unsub = api.onScanProgress((p) => setScanProgress(p));
    return unsub;
  }, []);

  const tags = useMemo(() => {
    const auto = extractTagsWithFolders(
      videos.map((v) => ({ filename: v.filename, folder: v.folder })),
      roots
    );
    const byName = new Map<string, Tag>();
    for (const t of auto) byName.set(t.name, t);
    for (const name of userTagNames) {
      const lc = name.toLowerCase();
      const existing = byName.get(name);
      if (existing) {
        const userCount = videos.filter((v) =>
          (v.tags ?? []).some((t) => t.toLowerCase() === lc)
        ).length;
        if (userCount > existing.count) {
          byName.set(name, { name, count: userCount });
        }
      } else {
        const userCount = videos.filter((v) =>
          (v.tags ?? []).some((t) => t.toLowerCase() === lc)
        ).length;
        byName.set(name, { name, count: userCount });
      }
    }
    return Array.from(byName.values())
      .filter((t) => !hiddenTags.has(t.name))
      .sort((a, b) => a.name.localeCompare(b.name) || b.count - a.count);
  }, [videos, roots, hiddenTags, userTagNames]);

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
    const unsubScene = api.onSceneProgress((event: SceneProgressEvent) => {
      if (event.progress.kind === 'done' || event.progress.kind === 'error') {
        setSceneProgress(null);
        if (event.progress.kind === 'error') {
          showOpenToast(`Scene detection failed: ${event.progress.message}`);
        }
        return;
      }
      setSceneProgress(event);
    });
    return () => {
      unsubDiscovered();
      unsubThumbed();
      unsubViewed();
      unsubScene();
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
    hiddenTags,
    ffmpeg,
    loading,
    isScanning,
    scanProgress,
    thumbFailures,
    sceneProgress,
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
    setVideoTag,
    removeVideoTag,
    detectScenes
  };
}
