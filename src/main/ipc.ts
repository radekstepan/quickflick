import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron';
import { realpath } from 'node:fs/promises';
import { basename } from 'node:path';
import {
  addRoot,
  countVideosByRoot,
  getAllUserTagNames,
  getThumbsDir,
  getVideoById,
  insertScenes,
  listAllFolders,
  listRoots,
  listVideos,
  removeRoot,
  removeThumbsForPaths,
  removeVideosByRoot,
  resetAllThumbs,
  resetFailedThumbs,
  removeVideoTag,
  setVideoTag
} from './db';
import { checkFfmpeg, checkFfprobe } from './ffmpeg';
import { probeVideo } from './probe';
import { scanLibrary } from './scanner';
import { detectScenesFFmpeg } from './scenedetect';
import { extractSceneThumbs } from './sceneThumbs';
import { thumbUrl, cacheBustThumbUrl } from './thumbnailer';
import { attachToWindow as attachViewTracker, setViewedEmitter, startView } from './viewTracker';
import {
  getSettings,
  listInstalledPlayers,
  listKnownPlayers,
  openWithPlayer,
  setAccentColor,
  setDefaultPlayer,
  setSceneSampleRate,
  setTheme
} from './settings';
import type {
  AccentColor,
  ListOptions,
  OpenResult,
  PickedApp,
  PlayerChoice,
  ScanProgress,
  ScanResult,
  SceneProgress,
  SceneSampleRate,
  Theme,
  VideoViewedEvent,
  VideoWithThumbs
} from '../shared/types';

let mainWindow: BrowserWindow | null = null;

export function setMainWindow(win: BrowserWindow): void {
  mainWindow = win;
  attachViewTracker(win);
  setViewedEmitter(emitVideoViewed);
}

export function getMainWindow(): BrowserWindow | null {
  return mainWindow;
}

function emitProgress(p: ScanProgress): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('scan:progress', p);
  }
}

function emitVideosDiscovered(rows: VideoWithThumbs[]): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('library:videosDiscovered', rows);
  }
}

function emitVideoThumbed(row: VideoWithThumbs): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('library:videoThumbed', row);
  }
}

function emitVideoViewed(payload: VideoViewedEvent): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('video:viewed', payload);
  }
}

export function registerIpc(): void {
  ipcMain.handle('library:pickFolder', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory'],
      title: 'Pick a folder to add to your library'
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    const picked = result.filePaths[0];
    try {
      return await realpath(picked);
    } catch {
      return picked;
    }
  });

  ipcMain.handle('library:addRoot', async (_e, p: string) => {
    addRoot(p);
  });

  ipcMain.handle('library:getRoots', async () => {
    return listRoots();
  });

  ipcMain.handle('library:removeRoot', async (_e, p: string): Promise<{ removedVideos: number }> => {
    const count = countVideosByRoot(p);
    if (count > 0) {
      const win = getMainWindow();
      const options = {
        type: 'warning' as const,
        buttons: ['Remove', 'Cancel'],
        defaultId: 1,
        cancelId: 1,
        message: `Remove "${basename(p)}" from your library?`,
        detail: `${count} video${count === 1 ? '' : 's'} will be forgotten. Files on disk are not touched.`
      };
      const choice = win
        ? await dialog.showMessageBox(win, options)
        : await dialog.showMessageBox(options);
      if (choice.response !== 0) {
        return { removedVideos: 0 };
      }
    }
    const { removed, paths } = removeVideosByRoot(p);
    removeThumbsForPaths(paths);
    removeRoot(p);
    return { removedVideos: removed };
  });

  ipcMain.handle('library:rescan', async (): Promise<ScanResult> => {
    return await scanLibrary(emitProgress, emitVideosDiscovered, emitVideoThumbed);
  });

  ipcMain.handle('library:retryFailedThumbs', async (): Promise<ScanResult> => {
    const resetCount = resetFailedThumbs();
    if (resetCount === 0) {
      return { added: 0, updated: 0, removed: 0, total: 0, failedThumbnails: [], prunedFolders: 0 };
    }
    return await scanLibrary(emitProgress, emitVideosDiscovered, emitVideoThumbed);
  });

  ipcMain.handle('library:resetAllThumbs', async (): Promise<ScanResult> => {
    resetAllThumbs();
    return await scanLibrary(emitProgress, emitVideosDiscovered, emitVideoThumbed);
  });

  ipcMain.handle('library:listVideos', async (_e, opts?: ListOptions) => {
    const rows = listVideos(opts ?? {});
    const td = getThumbsDir();
    return rows.map((v) => ({
      ...v,
      thumbnails: v.thumbnails.map((t) => ({
        ...t,
        url: cacheBustThumbUrl(thumbUrl(t.file_path, td), v.scanned_at)
      }))
    }));
  });

  ipcMain.handle('library:listFolders', async () => {
    return listAllFolders();
  });

  ipcMain.handle('video:open', async (_e, id: number): Promise<OpenResult> => {
    const v = getVideoById(id);
    if (!v) throw new Error('Video not found');
    const { defaultPlayer } = getSettings();
    let usedFallback = false;
    let error: string | undefined;
    if (defaultPlayer === 'system') {
      const result = await shell.openPath(v.path);
      if (result) throw new Error(result);
    } else {
      const launch = await openWithPlayer(v.path, defaultPlayer);
      if (!launch.ok) {
        const fallback = await shell.openPath(v.path);
        if (fallback) throw new Error(fallback);
        usedFallback = true;
        error = launch.error;
      } else {
        usedFallback = launch.usedFallback;
        if (usedFallback) error = launch.error;
      }
    }
    startView(id);
    return { view_count: v.view_count, usedFallback, error };
  });

  ipcMain.handle('video:reveal', async (_e, id: number) => {
    const v = getVideoById(id);
    if (!v) return;
    shell.showItemInFolder(v.path);
  });

  ipcMain.handle('video:setTag', async (_e, id: number, name: string) => {
    setVideoTag(id, name);
  });

  ipcMain.handle('video:removeTag', async (_e, id: number, name: string) => {
    removeVideoTag(id, name);
  });

  ipcMain.handle('tags:list', async () => {
    return getAllUserTagNames();
  });

  ipcMain.handle('ffmpeg:status', async () => {
    const [ff, fp] = await Promise.all([checkFfmpeg(), checkFfprobe()]);
    if (!ff.ok) return { ok: false, installHint: ff.installHint };
    if (!fp.ok) return { ok: false, installHint: fp.installHint };
    return { ok: true, version: ff.version };
  });

  ipcMain.on('scan:progress:subscribe', () => {
    // The renderer subscribes by calling onScanProgress; the actual
    // delivery uses webContents.send. This handler is just a no-op
    // marker so the channel exists.
  });

  ipcMain.handle('settings:get', async () => {
    return getSettings();
  });

  ipcMain.handle('settings:setTheme', async (_e, theme: Theme) => {
    setTheme(theme);
  });

  ipcMain.handle('settings:setAccent', async (_e, color: AccentColor) => {
    setAccentColor(color);
  });

  ipcMain.handle('settings:setSceneSampleRate', async (_e, rate: SceneSampleRate) => {
    setSceneSampleRate(rate);
  });

  ipcMain.handle(
    'settings:setDefaultPlayer',
    async (_e, player: PlayerChoice, appPath?: string | null) => {
      setDefaultPlayer(player, appPath);
    }
  );

  ipcMain.handle('settings:listPlayers', async () => {
    return {
      installed: listInstalledPlayers(),
      known: listKnownPlayers()
    };
  });

  ipcMain.handle('settings:pickApp', async (): Promise<PickedApp | null> => {
    const win = getMainWindow();
    const options = {
      title: 'Choose a video player',
      properties: ['openFile' as const],
      filters: [{ name: 'Applications', extensions: ['app'] }],
      defaultPath: '/Applications'
    };
    const result = win
      ? await dialog.showOpenDialog(win, options)
      : await dialog.showOpenDialog(options);
    if (result.canceled || result.filePaths.length === 0) return null;
    const path = result.filePaths[0];
    const plist = `${path}/Contents/Info.plist`;
    const fs = await import('node:fs');
    let name: string | null = null;
    try {
      if (fs.existsSync(plist)) {
        const raw = fs.readFileSync(plist, 'utf8');
        const m = raw.match(/<key>CFBundleName<\/key>\s*<string>([^<]+)<\/string>/);
        if (m) name = m[1].trim();
      }
    } catch {
      // ignore
    }
    if (!name) {
      const parts = path.split('/').filter(Boolean);
      const last = parts[parts.length - 1] ?? path;
      name = last.replace(/\.app$/, '');
    }
    return { name, path };
  });

  ipcMain.handle('video:detectScenes', async (e, id: number) => {
    const v = getVideoById(id);
    if (!v) throw new Error('Video not found');

    console.log('[detectScenes] request id=', id, 'path=', v.path);

    const sendProgress = (progress: SceneProgress) => {
      if (!e.sender.isDestroyed()) {
        e.sender.send('video:sceneProgress', { videoId: id, progress });
      }
    };

    const ff = await checkFfmpeg();
    if (!ff.ok) {
      const msg = `ffmpeg is not available. ${ff.installHint ?? 'Install with: brew install ffmpeg'}`;
      sendProgress({ kind: 'phase', text: msg });
      sendProgress({ kind: 'error', message: msg });
      throw new Error(msg);
    }

    let duration = v.duration;
    if (!duration) {
      const probed = await probeVideo(v.path);
      duration = probed.duration;
    }
    if (!duration) {
      const msg = 'Video duration unknown. Please rescan library.';
      sendProgress({ kind: 'phase', text: msg });
      sendProgress({ kind: 'error', message: msg });
      throw new Error(msg);
    }

    const { sceneSampleRate } = getSettings();

    try {
      const scenes = await detectScenesFFmpeg(
        v.path,
        duration,
        v.codec,
        null,
        sceneSampleRate,
        (progress) => sendProgress(progress)
      );
      insertScenes(id, scenes);
      sendProgress({ kind: 'phase', text: 'Extracting scene frames…' });
      try {
        await extractSceneThumbs(id, v.content_fingerprint ?? '', v.path, scenes, {
          onProgress: () => {
            // Currently a single-shot ffmpeg pass; emit a single phase
            // tick so the UI knows we're past scene detection.
          }
        });
      } catch (thumbErr) {
        // Scene-frame extraction is a nice-to-have. Log and continue —
        // the interval thumbs remain usable, and the scene list is
        // already persisted to the DB.
        const tmsg = thumbErr instanceof Error ? thumbErr.message : String(thumbErr);
        console.warn('[detectScenes] scene frame extraction failed:', tmsg);
        sendProgress({ kind: 'phase', text: `Scene frames skipped: ${tmsg}` });
      }
      sendProgress({
        kind: 'phase',
        text: `Done! Found ${scenes.length} scene${scenes.length === 1 ? '' : 's'}.`
      });
      sendProgress({ kind: 'done', count: scenes.length });
      console.log('[detectScenes] done:', scenes.length, 'scenes inserted for id=', id);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      console.error('[detectScenes] failed:', errorMsg);
      sendProgress({ kind: 'phase', text: `Scene detection failed: ${errorMsg}` });
      sendProgress({ kind: 'error', message: errorMsg });
      throw err;
    }
  });
}
