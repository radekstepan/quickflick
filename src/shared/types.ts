export type ThumbStatus = 'pending' | 'ok' | 'failed';

// Columns that actually live in the `videos` table.
export interface VideoBase {
  id: number;
  path: string;
  folder: string;
  filename: string;
  size: number;
  mtime_ms: number;
  duration: number | null;
  width: number | null;
  height: number | null;
  scanned_at: number;
  codec: string | null;
  thumb_status: ThumbStatus;
  view_count: number;
  view_time_ms: number;
  content_fingerprint: string | null;
}

export interface Video extends VideoBase {
  tags: string[];
  excludedTags: string[];
}

export interface Thumbnail {
  id: number;
  video_id: number;
  frame_index: number;
  time_offset: number;
  file_path: string;
}

export interface VideoWithThumbs extends Video {
  thumbnails: Thumbnail[];
}

export interface ScanProgress {
  phase: 'walking' | 'probing' | 'thumbnailing' | 'done';
  processed: number;
  total: number;
  currentFile?: string;
  queueDepth?: number;
}

export interface ThumbnailAttempt {
  label: string;
  error: string;
}

export interface ThumbnailFailure {
  path: string;
  codec: string | null;
  codecTag: string | null;
  decodersTried: string[];
  error: string;
  attempts: ThumbnailAttempt[];
}

export interface ScanResult {
  added: number;
  updated: number;
  removed: number;
  total: number;
  failedThumbnails: ThumbnailFailure[];
  prunedFolders: number;
}

export interface FfmpegStatus {
  ok: boolean;
  version?: string;
  installHint?: string;
}

export type SortKey =
  | 'name'
  | 'mtime'
  | 'mtime_asc'
  | 'size'
  | 'duration'
  | 'viewCount'
  | 'viewCount_asc'
  | 'popularity'
  | 'popularity_asc';

export interface ListOptions {
  folder?: string;
  search?: string;
  sort?: SortKey;
}

export type MenuCommand = 'rescan';

export interface RemoveRootResult {
  removedVideos: number;
}

export interface VideoViewedEvent {
  id: number;
  view_count: number;
  view_time_ms: number;
}

export type Theme = 'dark' | 'light';
export type PlayerChoice = 'system' | string;

export interface AppSettings {
  theme: Theme;
  defaultPlayer: PlayerChoice;
}

export interface PlayerList {
  installed: string[];
  known: string[];
}

export interface PickedApp {
  name: string;
  path: string;
}

export interface OpenResult {
  view_count: number;
  usedFallback: boolean;
  error?: string;
}

export interface Api {
  pickFolder: () => Promise<string | null>;
  addRoot: (path: string) => Promise<void>;
  getRoots: () => Promise<string[]>;
  removeRoot: (path: string) => Promise<RemoveRootResult>;
  rescan: () => Promise<ScanResult>;
  retryFailedThumbs: () => Promise<ScanResult>;
  resetAllThumbs: () => Promise<ScanResult>;
  listVideos: (opts?: ListOptions) => Promise<VideoWithThumbs[]>;
  openVideo: (id: number) => Promise<OpenResult>;
  revealVideo: (id: number) => Promise<void>;
  onScanProgress: (cb: (p: ScanProgress) => void) => () => void;
  onMenuCommand: (cb: (cmd: MenuCommand) => void) => () => void;
  onVideosDiscovered: (cb: (rows: VideoWithThumbs[]) => void) => () => void;
  onVideoThumbed: (cb: (row: VideoWithThumbs) => void) => () => void;
  onVideoViewed: (cb: (e: VideoViewedEvent) => void) => () => void;
  getFfmpegStatus: () => Promise<FfmpegStatus>;
  showItemInFolder: (path: string) => Promise<void>;
  setVideoTag: (videoId: number, tagName: string) => Promise<void>;
  removeVideoTag: (videoId: number, tagName: string) => Promise<void>;
  getAllUserTagNames: () => Promise<string[]>;
  getSettings: () => Promise<AppSettings>;
  setTheme: (theme: Theme) => Promise<void>;
  setDefaultPlayer: (player: PlayerChoice, appPath?: string | null) => Promise<void>;
  listPlayers: () => Promise<PlayerList>;
  pickApp: () => Promise<PickedApp | null>;
}
