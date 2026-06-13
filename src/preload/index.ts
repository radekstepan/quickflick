import { contextBridge, ipcRenderer } from 'electron';
import type {
  Api,
  ListOptions,
  RemoveRootResult,
  ScanProgress,
  FfmpegStatus,
  ScanResult,
  VideoWithThumbs,
  MenuCommand
} from '../shared/types';

const api: Api = {
  pickFolder: () => ipcRenderer.invoke('library:pickFolder') as Promise<string | null>,
  addRoot: (p) => ipcRenderer.invoke('library:addRoot', p) as Promise<void>,
  getRoots: () => ipcRenderer.invoke('library:getRoots') as Promise<string[]>,
  removeRoot: (p) => ipcRenderer.invoke('library:removeRoot', p) as Promise<RemoveRootResult>,
  rescan: () => ipcRenderer.invoke('library:rescan') as Promise<ScanResult>,
  retryFailedThumbs: () => ipcRenderer.invoke('library:retryFailedThumbs') as Promise<ScanResult>,
  resetAllThumbs: () => ipcRenderer.invoke('library:resetAllThumbs') as Promise<ScanResult>,
  listVideos: (opts?: ListOptions) =>
    ipcRenderer.invoke('library:listVideos', opts) as Promise<VideoWithThumbs[]>,
  openVideo: (id) => ipcRenderer.invoke('video:open', id),
  revealVideo: (id) => ipcRenderer.invoke('video:reveal', id),
  onScanProgress: (cb) => {
    const listener = (_e: unknown, p: ScanProgress) => cb(p);
    ipcRenderer.on('scan:progress', listener);
    return () => ipcRenderer.removeListener('scan:progress', listener);
  },
  onMenuCommand: (cb) => {
    const listener = (_e: unknown, cmd: MenuCommand) => cb(cmd);
    ipcRenderer.on('menu:command', listener);
    return () => ipcRenderer.removeListener('menu:command', listener);
  },
  onVideosDiscovered: (cb) => {
    const listener = (_e: unknown, rows: VideoWithThumbs[]) => cb(rows);
    ipcRenderer.on('library:videosDiscovered', listener);
    return () => ipcRenderer.removeListener('library:videosDiscovered', listener);
  },
  onVideoThumbed: (cb) => {
    const listener = (_e: unknown, row: VideoWithThumbs) => cb(row);
    ipcRenderer.on('library:videoThumbed', listener);
    return () => ipcRenderer.removeListener('library:videoThumbed', listener);
  },
  getFfmpegStatus: () => ipcRenderer.invoke('ffmpeg:status') as Promise<FfmpegStatus>,
  showItemInFolder: (_path: string) => Promise.resolve()
};

contextBridge.exposeInMainWorld('api', api);
