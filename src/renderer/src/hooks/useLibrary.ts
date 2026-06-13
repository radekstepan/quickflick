import { useEffect, useState, useCallback } from 'react';
import { api } from '../api';
import type {
  FfmpegStatus,
  ScanProgress,
  ScanResult,
  ThumbnailFailure,
  VideoWithThumbs
} from '@shared/types';

export interface LibraryState {
  roots: string[];
  videos: VideoWithThumbs[];
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
  openVideo: (id: number) => Promise<void>;
}

function isSubPathOrEqual(child: string, parent: string): boolean {
  if (child === parent) return true;
  return child.startsWith(parent + '/');
}

export function useLibrary(): LibraryState {
  const [roots, setRoots] = useState<string[]>([]);
  const [videos, setVideos] = useState<VideoWithThumbs[]>([]);
  const [ffmpeg, setFfmpeg] = useState<FfmpegStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [isScanning, setIsScanning] = useState(false);
  const [scanProgress, setScanProgress] = useState<ScanProgress | null>(null);
  const [thumbFailures, setThumbFailures] = useState<ThumbnailFailure[]>([]);

  const reload = useCallback(async () => {
    const rows = await api.listVideos();
    setVideos(rows);
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

  const openVideo = useCallback(async (id: number) => {
    try {
      await api.openVideo(id);
    } catch (e) {
      console.error('Open failed:', e);
    }
  }, []);

  useEffect(() => {
    let mounted = true;
    (async () => {
      const [rs, ffm] = await Promise.all([api.getRoots(), api.getFfmpegStatus()]);
      if (!mounted) return;
      setRoots(rs);
      setFfmpeg(ffm);
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
    return () => {
      unsubDiscovered();
      unsubThumbed();
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
    openVideo
  };
}
