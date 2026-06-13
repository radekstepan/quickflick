export type ThumbStatus = 'pending' | 'ok' | 'failed';

export interface Video {
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

export interface ScanResult {
  added: number;
  updated: number;
  removed: number;
  total: number;
  failedThumbnails: string[];
}

export interface FfmpegStatus {
  ok: boolean;
  version?: string;
  installHint?: string;
}

export type SortKey = 'name' | 'mtime' | 'size' | 'duration';

export interface ListOptions {
  folder?: string;
  search?: string;
  sort?: SortKey;
}

export type MenuCommand = 'rescan';

export interface RemoveRootResult {
  removedVideos: number;
}

export interface Api {
  pickFolder: () => Promise<string | null>;
  addRoot: (path: string) => Promise<void>;
  getRoots: () => Promise<string[]>;
  removeRoot: (path: string) => Promise<RemoveRootResult>;
  rescan: () => Promise<ScanResult>;
  retryFailedThumbs: () => Promise<ScanResult>;
  listVideos: (opts?: ListOptions) => Promise<VideoWithThumbs[]>;
  openVideo: (id: number) => Promise<void>;
  revealVideo: (id: number) => Promise<void>;
  onScanProgress: (cb: (p: ScanProgress) => void) => () => void;
  onMenuCommand: (cb: (cmd: MenuCommand) => void) => () => void;
  onVideosDiscovered: (cb: (rows: VideoWithThumbs[]) => void) => () => void;
  onVideoThumbed: (cb: (row: VideoWithThumbs) => void) => () => void;
  getFfmpegStatus: () => Promise<FfmpegStatus>;
  showItemInFolder: (path: string) => Promise<void>;
}
