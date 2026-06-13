import { contextBridge, ipcRenderer } from 'electron';
import type { Api, ListOptions, ScanProgress, FfmpegStatus, ScanResult, VideoWithThumbs, MenuCommand } from '../shared/types';

const api: Api = {
  pickFolder: () => ipcRenderer.invoke('library:pickFolder'),
  setLibrary: (p) => ipcRenderer.invoke('library:setLibrary', p),
  getLibrary: () => ipcRenderer.invoke('library:getLibrary'),
  rescan: () => ipcRenderer.invoke('library:rescan') as Promise<ScanResult>,
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
  getFfmpegStatus: () => ipcRenderer.invoke('ffmpeg:status') as Promise<FfmpegStatus>,
  showItemInFolder: (_path: string) => Promise.resolve()
};

contextBridge.exposeInMainWorld('api', api);
