import { mkdir, rm, readdir, stat } from 'node:fs/promises';
import { join, basename } from 'node:path';
import ffmpeg from 'fluent-ffmpeg';
import { getThumbsDir, insertThumbnails, deleteThumbnailsForVideo } from './db';
import { codecFamily, type CodecFamily } from './probe';
import type { Thumbnail } from '../shared/types';

const FRAME_COUNT = 8;
const TARGET_WIDTH = 320;
const TIMEOUT_MS = 60_000;
const DIAGNOSTIC_LOG_TAIL = 2000;

// Path-keyed thumb dir kept for the legacy removeThumbsForPaths cleanup
// helper (it still receives old file paths from removeVideosByRoot).
function legacyThumbsDirFor(videoPath: string): string {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { createHash } = require('node:crypto') as typeof import('node:crypto');
  const h = createHash('sha1').update(videoPath).digest('hex').slice(0, 16);
  return join(getThumbsDir(), h);
}

export function thumbsDirFor(videoPathOrFingerprint: string): string {
  // Heuristic: fingerprint is a 40-char hex; legacy path-hash is 16-char hex.
  // If the input looks like a fingerprint, key the dir on it. Otherwise treat
  // it as a path and apply the legacy hash.
  if (/^[0-9a-f]{40}$/.test(videoPathOrFingerprint)) {
    return join(getThumbsDir(), videoPathOrFingerprint);
  }
  return legacyThumbsDirFor(videoPathOrFingerprint);
}

export interface ExtractOptions {
  onFrameWritten?: (index: number, timeOffset: number) => void;
}

interface Candidate {
  label: string;
  preInputOptions: string[];
  sharedInputOptions: string[];
  perInputSeek: number[];
  outputSpecs: { options: string[]; filename: string }[];
}

function buildCandidates(
  _videoPath: string,
  family: CodecFamily,
  interval: number,
  _outDir: string,
  durationSec: number
): Candidate[] {
  const isMac = process.platform === 'darwin';
  const candidates: Candidate[] = [];
  const seen = new Set<string>();

  function add(label: string, hwCodec: string | null): void {
    if (seen.has(label)) return;
    seen.add(label);

    const perInputSeek: number[] = [];
    for (let i = 0; i < FRAME_COUNT; i++) {
      const natural = i * interval;
      const clamped = Math.min(natural, Math.max(0, durationSec - 0.5));
      perInputSeek.push(clamped);
    }

    const sharedInputOptions: string[] = [];
    if (hwCodec) {
      sharedInputOptions.push('-hwaccel', 'videotoolbox', '-c:v', hwCodec);
    }

    const outputSpecs: { options: string[]; filename: string }[] = [];
    for (let i = 0; i < FRAME_COUNT; i++) {
      outputSpecs.push({
        options: [
          '-map', `${i}:V:0`,
          '-frames:v', '1',
          '-q:v', '2',
          '-vf', `scale=${TARGET_WIDTH}:-2`
        ],
        filename: `thumb_${String(i + 1).padStart(3, '0')}.jpg`
      });
    }

    candidates.push({
      label,
      preInputOptions: ['-nostdin', '-hide_banner', '-loglevel', 'error', '-y'],
      sharedInputOptions,
      perInputSeek,
      outputSpecs
    });
  }

  if (family === 'hevc') {
    if (isMac) add('hevc_fastseek_vt', 'hevc');
    add('hevc_fastseek_sw', null);
  } else if (family === 'h264') {
    if (isMac) add('h264_fastseek_vt', 'h264');
    add('h264_fastseek_sw', null);
  } else if (family === 'av1') {
    add('av1_fastseek_sw', null);
    if (isMac) add('hevc_fastseek_vt', 'hevc');
  } else {
    add('auto_fastseek_sw', null);
    if (isMac) add('hevc_fastseek_vt', 'hevc');
    if (isMac) add('h264_fastseek_vt', 'h264');
  }

  return candidates;
}

function parseExitCode(message: string): number | null {
  const m = message.match(/exited with code (-?\d+)/);
  return m ? Number(m[1]) : null;
}

interface RunResult {
  files: string[];
  error: string;
  timedOut: boolean;
  elapsedMs: number;
  code: number | null;
  stderrFull: string;
  args: string[];
}

function buildCommand(
  videoPath: string,
  candidate: Candidate,
  outDir: string
): ReturnType<typeof ffmpeg> {
  let command = ffmpeg();
  for (let i = 0; i < FRAME_COUNT; i++) {
    const opts: string[] = [];
    if (i === 0) opts.push(...candidate.preInputOptions);
    opts.push(...candidate.sharedInputOptions);
    opts.push('-ss', candidate.perInputSeek[i].toFixed(3));
    command = command.input(videoPath).inputOptions(opts);
  }
  for (const spec of candidate.outputSpecs) {
    command = command.output(join(outDir, spec.filename)).outputOptions(spec.options);
  }
  return command;
}

async function runFfmpeg(
  videoPath: string,
  candidate: Candidate,
  outDir: string
): Promise<RunResult> {
  const t0 = Date.now();
  let stderrFull = '';
  let timedOut = false;
  let settled = false;
  let settle: (r: RunResult) => void = () => {};
  const done = new Promise<RunResult>((r) => { settle = r; });

  const safeSettle = (r: RunResult): void => {
    if (settled) return;
    settled = true;
    settle(r);
  };

  const command = buildCommand(videoPath, candidate, outDir);

  command
    .on('stderr', (line: string) => {
      stderrFull += line + '\n';
    })
    .on('error', (err: Error, _stdout: string | null, stderr: string | null) => {
      const full = stderr && stderr.length > 0 ? stderr : stderrFull;
      const tail = full.slice(-500);
      safeSettle({
        files: [],
        error: `${err.message}${tail ? `: ${tail}` : ''}`,
        timedOut,
        elapsedMs: Date.now() - t0,
        code: parseExitCode(err.message),
        stderrFull: full,
        args: command._getArguments()
      });
    })
    .on('end', async () => {
      let files: string[] = [];
      try {
        files = (await readdir(outDir))
          .filter((f) => f.endsWith('.jpg'))
          .sort();
      } catch {
        files = [];
      }
      safeSettle({
        files,
        error: '',
        timedOut: false,
        elapsedMs: Date.now() - t0,
        code: 0,
        stderrFull,
        args: command._getArguments()
      });
    });

  command.run();

  const timer = setTimeout(() => {
    timedOut = true;
    command.kill('SIGKILL');
  }, TIMEOUT_MS);

  const result = await done;
  clearTimeout(timer);
  return result;
}

async function diagnosticRerun(
  videoPath: string,
  base: Candidate,
  outDir: string
): Promise<void> {
  const tmp = join(getThumbsDir(), `diag-${Date.now()}`);
  await mkdir(tmp, { recursive: true });

  const diagCandidate: Candidate = {
    label: base.label,
    preInputOptions: [
      ...base.preInputOptions,
      '-loglevel', 'info',
      '-err_detect', 'explode',
      '-fflags', '+discardcorrupt'
    ],
    sharedInputOptions: base.sharedInputOptions,
    perInputSeek: base.perInputSeek,
    outputSpecs: base.outputSpecs
  };

  const t0 = Date.now();
  let stderrFull = '';
  let code: number | null = null;
  let settled = false;
  let settle: () => void = () => {};
  const done = new Promise<void>((r) => { settle = r; });
  const safe = (): void => { if (!settled) { settled = true; settle(); } };

  const command = buildCommand(videoPath, diagCandidate, tmp);
  command
    .on('stderr', (line: string) => { stderrFull += line + '\n'; })
    .on('error', (err: Error) => {
      stderrFull += `\n[diag-error] ${err.message}\n`;
      code = parseExitCode(err.message);
      safe();
    })
    .on('end', () => {
      code = 0;
      safe();
    })
    .run();

  const timer = setTimeout(() => { safe(); }, TIMEOUT_MS);

  await done;
  clearTimeout(timer);
  await rm(tmp, { recursive: true, force: true });

  const args = command._getArguments().slice(1).join(' ');
  console.warn(
    `[thumbnail:diag] ${basename(videoPath)} args=[${args}] ` +
    `elapsed=${Date.now() - t0}ms exit=${code ?? 'n/a'}\n` +
    stderrFull.slice(-DIAGNOSTIC_LOG_TAIL)
  );
}

async function existingThumbsValid(outDir: string): Promise<boolean> {
  try {
    const files = await readdir(outDir);
    if (files.length < FRAME_COUNT) return false;
    for (let i = 0; i < FRAME_COUNT; i++) {
      const expected = `thumb_${String(i + 1).padStart(3, '0')}.jpg`;
      if (!files.includes(expected)) return false;
      const s = await stat(join(outDir, expected));
      if (!s.isFile() || s.size <= 0) return false;
    }
    return true;
  } catch {
    return false;
  }
}

async function ensureThumbnailRows(
  videoId: number,
  outDir: string,
  interval: number
): Promise<void> {
  const files = await readdir(outDir);
  const sorted = files
    .filter((f) => f.endsWith('.jpg'))
    .sort();
  if (sorted.length === 0) return;
  const rows: Omit<Thumbnail, 'id'>[] = sorted.slice(0, FRAME_COUNT).map((f, idx) => ({
    video_id: videoId,
    frame_index: idx,
    time_offset: idx * interval,
    file_path: join(outDir, f)
  }));
  insertThumbnails(rows);
}

export async function generateThumbnails(
  videoId: number,
  fingerprint: string,
  videoPath: string,
  durationSec: number,
  codec: string | null,
  codecTag: string | null,
  onProgress?: (i: number) => void
): Promise<void> {
  const outDir = thumbsDirFor(fingerprint);
  const interval = Math.max(durationSec / FRAME_COUNT, 0.05);

  // Short-circuit: if the fingerprint's thumb dir already holds 8 valid
  // files, reuse them. This is the post-move case — the same content lived
  // somewhere else and its thumbs are already on disk.
  if (await existingThumbsValid(outDir)) {
    await ensureThumbnailRows(videoId, outDir, interval);
    onProgress?.(FRAME_COUNT);
    return;
  }

  await rm(outDir, { recursive: true, force: true });
  await mkdir(outDir, { recursive: true });
  deleteThumbnailsForVideo(videoId);

  const family = codecFamily(codec, codecTag);
  const candidates = buildCandidates(videoPath, family, interval, outDir, durationSec);

  if (candidates.length === 0) {
    throw new Error(
      `no ffmpeg decode candidates for codec=${codec ?? '?'}/${codecTag ?? '?'} on ${process.platform}`
    );
  }

  const attempts: { label: string; error: string; files: number }[] = [];
  for (const c of candidates) {
    const result = await runFfmpeg(videoPath, c, outDir);
    if (result.files.length === FRAME_COUNT) {
      console.log(
        `[thumbnail] ${basename(videoPath)}: ${result.files.length}/${FRAME_COUNT} frames via ${c.label} ` +
        `[ok] elapsed=${result.elapsedMs}ms exit=${result.code ?? 'n/a'} ` +
        `args=[${result.args.slice(1).join(' ')}]`
      );
      const rows: Omit<Thumbnail, 'id'>[] = result.files.map((f, idx) => ({
        video_id: videoId,
        frame_index: idx,
        time_offset: idx * interval,
        file_path: join(outDir, f)
      }));
      insertThumbnails(rows);
      onProgress?.(rows.length);
      return;
    }
    if (result.files.length > 0) {
      const partialMsg = `partial: produced ${result.files.length}/${FRAME_COUNT} frames`;
      console.warn(
        `[thumbnail] ${basename(videoPath)}: candidate ${c.label} ${partialMsg} ` +
        `elapsed=${result.elapsedMs}ms exit=${result.code ?? 'n/a'} ` +
        `args=[${result.args.slice(1).join(' ')}]`
      );
      attempts.push({ label: c.label, error: partialMsg, files: result.files.length });
      continue;
    }
    console.warn(
      `[thumbnail] ${basename(videoPath)}: candidate ${c.label} failed ` +
      `elapsed=${result.elapsedMs}ms exit=${result.code ?? 'n/a'} timedOut=${result.timedOut} ` +
      `args=[${result.args.slice(1).join(' ')}]`
    );
    attempts.push({ label: c.label, error: result.error, files: result.files.length });
  }

  // All candidates failed — run a diagnostic pass with verbose logging and
  // error detection to surface corruption/header issues that error-level
  // logs would hide. The result is logged to the console only, not to the
  // IPC payload, so the UI stays clean.
  const first = candidates[0]!;
  await diagnosticRerun(videoPath, first, outDir);

  const summary = attempts
    .map((a) => `${a.label} (${a.error})`)
    .join(' | ');
  const err: Error & { attempts?: { label: string; error: string }[] } = new Error(
    `ffmpeg produced no thumbnails (codec=${codec ?? '?'}/${codecTag ?? '?'}, tried ${attempts.length}: ${summary})`
  );
  err.attempts = attempts.map((a) => ({ label: a.label, error: a.error }));
  throw err;
}

export function frameCount(): number {
  return FRAME_COUNT;
}

// Convert an absolute thumbnail file path to a qfthumb:// URL for the renderer.
// The path is something like <userData>/thumbs/<hash>/thumb_001.jpg
export function thumbUrl(absPath: string, thumbsDir: string): string {
  let rel: string;
  if (absPath.startsWith(thumbsDir)) {
    rel = absPath.slice(thumbsDir.length);
  } else {
    rel = '/' + absPath.split('/').pop()!;
  }
  rel = rel.replace(/^\/+/, '');
  return `qfthumb://localhost/${encodeURI(rel)}`;
}

// Append a cache-busting query string so the browser refetches when the thumb
// is regenerated (scanned_at advances on each upsert).
export function cacheBustThumbUrl(url: string, scannedAt: number): string {
  return `${url}?v=${scannedAt}`;
}
