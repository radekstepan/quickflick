# QuickFlick

A local video library browser for macOS. Pick a folder of videos, get a beautiful grid with hover-cycling thumbnails, click to open in your default video player.

## Features

- Recursive folder scan for video files (mov, mp4, mkv, webm, m4v, avi, flv, wmv, mpg, mpeg, 3gp, m2ts, ts, hevc)
- SQLite cache of metadata and thumbnails
- 8 evenly-spaced thumbnails per video (regenerated only when file changes)
- On hover, the thumbnail cycles through the 8 frames
- On click, opens the video in the macOS-default video player
- Right-click reveals the video in Finder
- Folder sidebar for filtering by subdirectory
- Filename search
- Manual rescan with live progress

## Requirements

- macOS (primary target)
- [ffmpeg](https://ffmpeg.org) and `ffprobe` on `$PATH`:
  ```bash
  brew install ffmpeg
  ```

## Development

```bash
yarn install
yarn dev
```

This starts the Vite dev server and launches Electron with HMR. Closing the window (red X or **Cmd+W**) and **Cmd+Q** (or app menu → Quit QuickFlick) both fully exit and return the terminal.

### About the native module rebuild

`better-sqlite3` ships native code that must be compiled for the runtime that loads it: Electron's Node ABI for the app, the system Node's ABI for `vitest`. Both runtimes share one file (`node_modules/better-sqlite3/build/Release/better_sqlite3.node`), so each command sets the ABI it needs before running:

- `dev` / `build` / `start` / `preview` run `scripts/rebuild-native.cjs` (Electron ABI)
- `test` / `test:watch` run `scripts/rebuild-native-node.cjs` (system Node ABI)

Both scripts verify the current binary actually loads under the target runtime and skip the reinstall when it already matches. Don't run the app and the tests concurrently — whichever ran last owns the binary.

The Electron script:

1. Reads the installed Electron version from `node_modules`
2. Invokes `prebuild-install -r electron -t <version>` inside the better-sqlite3 package
3. Verifies the binary landed at `build/Release/better_sqlite3.node` and actually loads under Electron (catches `NODE_MODULE_VERSION` mismatches)

If you ever see "Could not locate the bindings file" on app start, run `yarn install` (to restore `prebuild-install` and deps), then rerun the command you were running.

## Build a `.dmg`

```bash
yarn package:mac
```

Builds a universal-friendly `.dmg` for both Apple Silicon and Intel. Output lands in `release/`:
- `release/QuickFlick-0.1.0-arm64.dmg`
- `release/QuickFlick-0.1.0.dmg` (x64)

The build is **unsigned** — first launch needs right-click → Open due to Gatekeeper. For distribution, sign with your Apple Developer ID and notarize via `electron-builder`.

## CLI smoke test

Verify the scan + thumbnail pipeline without launching the UI:

```bash
./node_modules/.bin/electron out/main/index.js --smoke-test=/path/to/your/videos
```

This walks the folder, generates thumbnails, and prints results to stdout.

## Where data lives

| What | Path |
|---|---|
| SQLite cache (dev) | `<repo>/db/library.db` (gitignored) |
| SQLite cache (packaged) | `~/Library/Application Support/QuickFlick/library.db` |
| Daily DB backups | `<same dir as library.db>/YYYY-MM-DD.library.db.bak` — kept for 7 days |
| Thumbnail JPGs | `~/Library/Caches/QuickFlick/thumbs/<sha1>/thumb_001.jpg..008.jpg` |
| Library path | Stored in the `kv` table inside `library.db` |

To reset, delete that folder. In dev, delete `./db/`.

> On first start after upgrading from a pre-rename build, the app copies the
> legacy `userData/cache.db` into the new location and leaves the original
> in place as a snapshot. Safe to delete manually once you've verified the
> new file works.

## Architecture

```
src/
├── main/           Electron main process
│   ├── index.ts    App lifecycle, BrowserWindow, custom qfthumb:// protocol
│   ├── db.ts       better-sqlite3 schema + queries
│   ├── scanner.ts  Recursive walk, upsert, queue
│   ├── probe.ts    ffprobe wrapper
│   ├── thumbnailer.ts  Single-pass ffmpeg fps=8/dur extraction
│   ├── queue.ts    Concurrency-limited worker queue
│   ├── ffmpeg.ts   Detect system ffmpeg/ffprobe
│   └── ipc.ts      ipcMain handlers
├── preload/        contextBridge → window.api
├── shared/         Shared TypeScript types
└── renderer/       React + TypeScript UI
    ├── components/  TitleBar, Toolbar, Sidebar, VideoGrid, VideoCard, ...
    ├── hooks/       useLibrary, useHoverCycle, usePreloadedImages
    └── styles/      app.css
```

### Why system ffmpeg instead of bundled?

Keeps the `.app` slim (~250 MB instead of ~330 MB) and avoids the GPL-3.0 distribution requirement of the bundled `ffmpeg-static` binary. Users install once via Homebrew.

### Why a custom `qfthumb://` protocol?

Loading `file://` URLs from a `http://` (dev) or `app://` (prod) origin is blocked by Electron's default CSP. The custom protocol maps `qfthumb://localhost/<hash>/thumb_001.jpg` to the actual cached file in `userData/thumbs/`, with a path-traversal check.

### Why fps=8 instead of keyframe extraction?

Keyframe (I-frame) spacing is irregular and depends on the encoder — you might get 8 clustered frames near the start of a long GOP. The `fps=8/duration` filter resamples the **decoded** stream at uniform time intervals, giving exactly 8 evenly-spaced frames regardless of encoding.

## Future ideas

- Background thumbnail regeneration (worker_threads or utility process)
- Folder watching for auto-rescan
- Video metadata in cards (codec, audio channels)
- Quick Look preview on Cmd+Y
- Custom per-extension app picker
- Drag-and-drop folder onto window
