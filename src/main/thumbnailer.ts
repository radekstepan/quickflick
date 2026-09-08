import { mkdir, rm, readdir, stat } from 'node:fs/promises';
import { join, basename } from 'node:path';
import ffmpeg from 'fluent-ffmpeg';
import { getThumbsDir, insertThumbnails, deleteThumbnailsForVideo } from './db';
import { codecFamily, type CodecFamily } from './probe';
import { run } from './ffmpeg';
import type { Thumbnail } from '../shared/types';

const FRAME_COUNT = 8;
const TARGET_WIDTH = 320;
const TIMEOUT_MS = 60_000;
const SINGLE_THUMB_TIMEOUT_MS = 20_000;
// Per-slot retries in the fallback path: try the nominal seek, then halve
// down toward the start of the file (t, t/2, t/4, ...) so a slot past a
// truncation point still has a chance at a real frame.
const FALLBACK_SEEK_ATTEMPTS = 3;
const FALLBACK_MIN_SEEK_SEC = 1;
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

    // Sample at (i + 0.5) * interval instead of i * interval to skip the
    // 0:00 frame — typically black/intro and not useful for previewing.
    const perInputSeek: number[] = [];
    for (let i = 0; i < FRAME_COUNT; i++) {
      const natural = (i + 0.5) * interval;
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

async function isValidThumb(absPath: string): Promise<boolean> {
  try {
    const s = await stat(absPath);
    return s.isFile() && s.size > 0;
  } catch {
    return false;
  }
}

async function listValidThumbs(outDir: string): Promise<string[]> {
  let files: string[];
  try {
    files = (await readdir(outDir)).filter((f) => f.endsWith('.jpg')).sort();
  } catch {
    return [];
  }
  const valid: string[] = [];
  for (const f of files) {
    if (await isValidThumb(join(outDir, f))) valid.push(f);
  }
  return valid;
}

// Extract a single thumbnail with software decoding. One input, one output:
// a corrupt/truncated seek position fails just this slot instead of
// poisoning a whole multi-output batch (ffmpeg aborts every output when any
// single output fails to open its encoder).
async function runSingleThumb(
  videoPath: string,
  seekSec: number,
  outFile: string
): Promise<boolean> {
  const result = await run(
    'ffmpeg',
    [
      '-nostdin', '-hide_banner', '-loglevel', 'error', '-y',
      '-ss', seekSec.toFixed(3),
      '-i', videoPath,
      '-frames:v', '1',
      '-q:v', '2',
      '-vf', `scale=${TARGET_WIDTH}:-2`,
      outFile
    ],
    SINGLE_THUMB_TIMEOUT_MS
  );
  if (!result.ok) return false;
  return isValidThumb(outFile);
}

// Fill slots the fast batch missed, one ffmpeg process per slot. Slots
// already holding a valid JPEG are skipped. A failing slot is retried at
// progressively earlier seeks (halving toward the start) so timestamps past
// a truncation point fall back into the playable prefix. Returns the number
// of slots holding a valid JPEG afterwards.
async function fallbackPerThumb(
  videoPath: string,
  perInputSeek: number[],
  outDir: string,
  outputSpecs: { options: string[]; filename: string }[]
): Promise<{ label: string; ok: number }> {
  let ok = 0;
  for (let i = 0; i < FRAME_COUNT; i++) {
    const outFile = join(outDir, outputSpecs[i]!.filename);
    if (await isValidThumb(outFile)) {
      ok++;
      continue;
    }
    let seek = perInputSeek[i]!;
    for (let attempt = 0; attempt < FALLBACK_SEEK_ATTEMPTS; attempt++) {
      if (await runSingleThumb(videoPath, seek, outFile)) break;
      seek = seek / 2;
      if (seek < FALLBACK_MIN_SEEK_SEC) break;
    }
    if (await isValidThumb(outFile)) ok++;
  }
  return { label: 'per_thumb_sw_fallback', ok };
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

function frameIndexFromFilename(filename: string): number | null {
  const m = filename.match(/^thumb_(\d{3})\.jpg$/);
  if (!m) return null;
  const n = Number(m[1]);
  if (!Number.isInteger(n) || n < 1 || n > FRAME_COUNT) return null;
  return n - 1;
}

async function ensureThumbnailRows(
  videoId: number,
  outDir: string,
  interval: number
): Promise<void> {
  // Only non-empty JPEGs — a failed batch can leave 0-byte outputs.
  const sorted = await listValidThumbs(outDir);
  if (sorted.length === 0) return;
  // Map by filename slot (thumb_NNN -> frame N-1) so a partial set keeps
  // timeline order instead of collapsing gaps.
  const rows: Omit<Thumbnail, 'id'>[] = [];
  for (const f of sorted.slice(0, FRAME_COUNT)) {
    const idx = frameIndexFromFilename(f) ?? rows.length;
    rows.push({
      video_id: videoId,
      frame_index: idx,
      time_offset: (idx + 0.5) * interval,
      file_path: join(outDir, f)
    });
  }
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
        time_offset: (idx + 0.5) * interval,
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

  // The fast batch is all-or-nothing: one corrupt/truncated seek position
  // aborts every output in the ffmpeg process, so a truncated file can end
  // here with zero files even though its playable prefix has good frames.
  // Fall back to one ffmpeg process per slot so good seeks still produce
  // thumbnails independently of bad ones.
  const first = candidates[0]!;
  const leftovers = await listValidThumbs(outDir);
  if (leftovers.length < FRAME_COUNT) {
    const fb = await fallbackPerThumb(videoPath, first.perInputSeek, outDir, first.outputSpecs);
    attempts.push({
      label: fb.label,
      error: `recovered ${fb.ok}/${FRAME_COUNT} slots individually`,
      files: fb.ok
    });
  }

  // Partial is success: persist whatever valid JPEGs we have (even one) so
  // the UI can show them. The scanner re-queues short sets on the next scan
  // (needsThumbWork), so a later-completed file can still fill the gaps.
  const recovered = await listValidThumbs(outDir);
  if (recovered.length > 0) {
    const rows: Omit<Thumbnail, 'id'>[] = recovered.slice(0, FRAME_COUNT).map((f) => {
      const idx = frameIndexFromFilename(f) ?? 0;
      return {
        video_id: videoId,
        frame_index: idx,
        time_offset: (idx + 0.5) * interval,
        file_path: join(outDir, f)
      };
    });
    insertThumbnails(rows);
    onProgress?.(rows.length);
    console.warn(
      `[thumbnail] ${basename(videoPath)}: partial ${rows.length}/${FRAME_COUNT} frames kept ` +
      `(tried ${attempts.map((a) => a.label).join(', ')})`
    );
    return;
  }

  // Truly nothing decodable — run a diagnostic pass with verbose logging and
  // error detection to surface corruption/header issues that error-level
  // logs would hide. The result is logged to the console only, not to the
  // IPC payload, so the UI stays clean.
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
