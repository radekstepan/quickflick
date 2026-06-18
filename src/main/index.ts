import { app, BrowserWindow, shell, protocol, net, Menu, MenuItemConstructorOptions } from 'electron';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { access } from 'node:fs/promises';
import { initDb, closeDb, addRoot, getDbPath, getThumbsDir, listAllVideos } from './db';
import { registerIpc, setMainWindow, getMainWindow } from './ipc';
import { scanLibrary } from './scanner';
import { flushOnQuit as flushViewTracker } from './viewTracker';

const isDev = !app.isPackaged;

// Register custom protocol scheme as privileged BEFORE app is ready
protocol.registerSchemesAsPrivileged([
  { scheme: 'qfthumb', privileges: { secure: true, supportFetchAPI: true, bypassCSP: true, stream: true } }
]);

function buildAppMenu(): void {
  const isMac = process.platform === 'darwin';
  const macAppMenu: MenuItemConstructorOptions = {
    label: app.name,
    submenu: [
      { role: 'about' },
      { type: 'separator' },
      { role: 'hide' },
      { role: 'hideOthers' },
      { role: 'unhide' },
      { type: 'separator' },
      { role: 'quit' }
    ]
  };

  const fileMenu: MenuItemConstructorOptions = {
    label: 'File',
    submenu: [
        {
          label: 'Rescan Library',
          accelerator: 'CmdOrCtrl+R',
          click: () => {
            getMainWindow()?.webContents.send('menu:command', 'rescan');
          }
        },
      { type: 'separator' },
      isMac ? { role: 'close' } : { role: 'quit' }
    ]
  };

  const editMenu: MenuItemConstructorOptions = {
    label: 'Edit',
    submenu: [
      { role: 'undo' },
      { role: 'redo' },
      { type: 'separator' },
      { role: 'cut' },
      { role: 'copy' },
      { role: 'paste' },
      { role: 'selectAll' }
    ]
  };

  const viewMenu: MenuItemConstructorOptions = {
    label: 'View',
    submenu: [
      { role: 'reload' },
      { role: 'toggleDevTools' },
      { type: 'separator' },
      { role: 'resetZoom' },
      { role: 'zoomIn' },
      { role: 'zoomOut' },
      { type: 'separator' },
      { role: 'togglefullscreen' }
    ]
  };

  const windowMenu: MenuItemConstructorOptions = {
    role: 'window',
    submenu: isMac
      ? [{ role: 'minimize' }, { role: 'zoom' }, { type: 'separator' }, { role: 'front' }]
      : [{ role: 'minimize' }, { role: 'zoom' }, { role: 'close' }]
  };

  const template: MenuItemConstructorOptions[] = [
    ...(isMac ? [macAppMenu] : []),
    fileMenu,
    editMenu,
    viewMenu,
    windowMenu
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 800,
    minHeight: 500,
    show: false,
    backgroundColor: '#0e0e10',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 16, y: 15 },
    title: 'QuickFlick',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  win.on('ready-to-show', () => {
    win.show();
  });

  win.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url);
    return { action: 'deny' };
  });

  if (isDev && process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL']);
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'));
  }

  return win;
}

async function runSmokeTest(folder: string): Promise<void> {
  initDb();
  addRoot(folder);
  console.log('[smoke] root =', folder);
  console.log('[smoke] db =', getDbPath());
  console.log('[smoke] thumbs =', getThumbsDir());

  const t0 = Date.now();
  const result = await scanLibrary((p) => {
    if (p.phase === 'thumbnailing' && p.processed % 1 === 0) {
      console.log(`[smoke] ${p.phase} ${p.processed}/${p.total}`);
    } else if (p.phase !== 'thumbnailing') {
      console.log(`[smoke] ${p.phase} ${p.processed}`);
    }
  });
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`[smoke] done in ${elapsed}s:`, result);

  const videos = listAllVideos();
  console.log(`[smoke] ${videos.length} videos in db:`);
  for (const v of videos.slice(0, 5)) {
    console.log(`  - ${v.filename} (${v.width}×${v.height}, ${v.duration?.toFixed(1)}s, thumbs: ${v.id})`);
  }

  closeDb();
  app.exit(0);
}

app.setName('QuickFlick');

app.whenReady().then(() => {
  // Custom protocol: qfthumb://<hash>/thumb_NNN.jpg -> userData/thumbs/<hash>/thumb_NNN.jpg
  protocol.handle('qfthumb', async (request) => {
    try {
      const url = new URL(request.url);
      // url.pathname is /<hash>/thumb_NNN.jpg
      const rel = decodeURIComponent(url.pathname).replace(/^\/+/, '');
      const filePath = join(getThumbsDir(), rel);
      // Ensure the resolved path is still under the thumbs dir (security)
      if (!filePath.startsWith(getThumbsDir())) {
        return new Response('forbidden', { status: 403 });
      }
      try {
        await access(filePath);
      } catch {
        return new Response('not found', { status: 404 });
      }
      return net.fetch(pathToFileURL(filePath).toString());
    } catch (e) {
      return new Response(`error: ${String(e)}`, { status: 500 });
    }
  });

  const smokeArg = process.argv.find((a) => a.startsWith('--smoke-test='));
  if (smokeArg) {
    const folder = smokeArg.split('=')[1];
    runSmokeTest(folder).catch((e) => {
      console.error('[smoke] failed:', e);
      app.exit(1);
    });
    return;
  }

  initDb();
  registerIpc();
  buildAppMenu();

  const win = createWindow();
  setMainWindow(win);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      const w = createWindow();
      setMainWindow(w);
    }
  });
});

app.on('window-all-closed', () => {
  app.quit();
});

app.on('will-quit', () => {
  flushViewTracker();
  closeDb();
  // In dev mode, signal the parent (pnpm/electron-vite) so the terminal
  // returns after Cmd+Q. Controlled by QFKILL_PARENT (set in the dev script).
  if (process.env['QFKILL_PARENT'] === '1' && process.ppid) {
    try {
      process.kill(process.ppid, 'SIGTERM');
    } catch {
      // parent already gone
    }
  }
});
