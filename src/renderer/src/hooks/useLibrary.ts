import { useEffect, useState, useCallback } from 'react';
import { api } from '../api';
import type { FfmpegStatus, ScanProgress, ScanResult, VideoWithThumbs } from '@shared/types';

export interface LibraryState {
  library: string | null;
  videos: VideoWithThumbs[];
  ffmpeg: FfmpegStatus | null;
  loading: boolean;
  isScanning: boolean;
  scanProgress: ScanProgress | null;
  pickFolder: () => Promise<void>;
  rescan: () => Promise<void>;
  reload: () => Promise<void>;
  openVideo: (id: number) => Promise<void>;
}

export function useLibrary(): LibraryState {
  const [library, setLibraryState] = useState<string | null>(null);
  const [videos, setVideos] = useState<VideoWithThumbs[]>([]);
  const [ffmpeg, setFfmpeg] = useState<FfmpegStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [isScanning, setIsScanning] = useState(false);
  const [scanProgress, setScanProgress] = useState<ScanProgress | null>(null);

  const reload = useCallback(async () => {
    const rows = await api.listVideos();
    setVideos(rows);
  }, []);

  const pickFolder = useCallback(async () => {
    const picked = await api.pickFolder();
    if (picked) {
      setLibraryState(picked);
      setVideos([]);
    }
  }, []);

  const rescan = useCallback(async () => {
    if (isScanning) return;
    setIsScanning(true);
    setScanProgress({ phase: 'walking', processed: 0, total: 0 });
    try {
      const result = await api.rescan();
      console.log('Scan result:', result);
      await reload();
    } catch (e) {
      console.error('Scan failed:', e);
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
      const [lib, ffm] = await Promise.all([api.getLibrary(), api.getFfmpegStatus()]);
      if (!mounted) return;
      setLibraryState(lib);
      setFfmpeg(ffm);
      setLoading(false);
      if (lib) {
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
    library,
    videos,
    ffmpeg,
    loading,
    isScanning,
    scanProgress,
    pickFolder,
    rescan,
    reload,
    openVideo
  };
}
