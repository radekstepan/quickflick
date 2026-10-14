// Shared media extension sets, used by the scanner (to decide which files
// are videos) and by the DB cleanup (to purge rows that are actually
// images). Shared between main/db and the scanner to avoid a db<->scanner
// import cycle and to keep the two lists in sync.

export const VIDEO_EXTS = new Set([
  '.mov', '.mp4', '.mkv', '.webm', '.m4v', '.avi', '.flv',
  '.wmv', '.mpg', '.mpeg', '.3gp', '.m2ts', '.ts', '.hevc'
]);

// Common still-image extensions. A file whose *final* extension is one of
// these is never a video — even when an earlier part of the name looks
// like one (e.g. screenshots named `movie 1080p.mp4.jpg`). Checked before
// the loose release-name regex in the scanner.
export const IMAGE_EXTS = new Set([
  '.jpg', '.jpeg', '.jfif', '.png', '.gif', '.webp', '.bmp',
  '.tif', '.tiff', '.heic', '.heif', '.avif', '.svg', '.ico'
]);
