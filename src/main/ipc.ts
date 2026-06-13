import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron';
import { realpath } from 'node:fs/promises';
import { getLibrary, setLibrary, listVideos, getVideoById, listAllFolders, getThumbsDir } from './db';
import { checkFfmpeg, checkFfprobe } from './ffmpeg';
import { scanLibrary } from './scanner';
import { thumbUrl } from './thumbnailer';
import type { ListOptions, ScanProgress, ScanResult } from '../shared/types';

let mainWindow: BrowserWindow | null = null;

export function setMainWindow(win: BrowserWindow): void {
  mainWindow = win;
}

export function getMainWindow(): BrowserWindow | null {
  return mainWindow;
}

function emitProgress(p: ScanProgress): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('scan:progress', p);
  }
}

export function registerIpc(): void {
  ipcMain.handle('library:pickFolder', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory'],
      title: 'Pick your video library folder'
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    const picked = result.filePaths[0];
    let real;
    try {
      real = await realpath(picked);
    } catch {
      real = picked;
    }
    setLibrary(real);
    return real;
  });

  ipcMain.handle('library:setLibrary', async (_e, p: string) => {
    setLibrary(p);
  });

  ipcMain.handle('library:getLibrary', async () => {
    return getLibrary();
  });

  ipcMain.handle('library:rescan', async (): Promise<ScanResult> => {
    return await scanLibrary(emitProgress);
  });

  ipcMain.handle('library:listVideos', async (_e, opts?: ListOptions) => {
    const rows = listVideos(opts ?? {});
    const td = getThumbsDir();
    return rows.map((v) => ({
      ...v,
      thumbnails: v.thumbnails.map((t) => ({
        ...t,
        url: thumbUrl(t.file_path, td)
      }))
    }));
  });

  ipcMain.handle('library:listFolders', async () => {
    return listAllFolders();
  });

  ipcMain.handle('video:open', async (_e, id: number) => {
    const v = getVideoById(id);
    if (!v) throw new Error('Video not found');
    const result = await shell.openPath(v.path);
    if (result) throw new Error(result);
  });

  ipcMain.handle('video:reveal', async (_e, id: number) => {
    const v = getVideoById(id);
    if (!v) return;
    shell.showItemInFolder(v.path);
  });

  ipcMain.handle('ffmpeg:status', async () => {
    const [ff, fp] = await Promise.all([checkFfmpeg(), checkFfprobe()]);
    if (!ff.ok) return { ok: false, installHint: ff.installHint };
    if (!fp.ok) return { ok: false, installHint: fp.installHint };
    return { ok: true, version: ff.version };
  });

  ipcMain.on('scan:progress:subscribe', (event) => {
    // The renderer subscribes by calling onScanProgress; the actual
    // delivery uses webContents.send. This handler is just a no-op
    // marker so the channel exists.
  });
}
