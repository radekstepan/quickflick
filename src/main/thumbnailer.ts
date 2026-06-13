import { createHash } from 'node:crypto';
import { mkdir, rm, readdir } from 'node:fs/promises';
import { join, basename } from 'node:path';
import ffmpeg from 'fluent-ffmpeg';
import { getThumbsDir, insertThumbnails } from './db';
import { codecFamily, type CodecFamily } from './probe';
import type { Thumbnail } from '../shared/types';

const FRAME_COUNT = 8;
const TARGET_WIDTH = 320;
const TIMEOUT_MS = 60_000;
const DIAGNOSTIC_LOG_TAIL = 2000;

function hashPath(p: string): string {
  return createHash('sha1').update(p).digest('hex').slice(0, 16);
}

export function thumbsDirFor(videoPath: string): string {
  return join(getThumbsDir(), hashPath(videoPath));
}

export interface ExtractOptions {
  onFrameWritten?: (index: number, timeOffset: number) => void;
}

interface Candidate {
  label: string;
  inputOptions: string[];
  outputOptions: string[];
}

function buildCandidates(family: CodecFamily, interval: number): Candidate[] {
  const isMac = process.platform === 'darwin';
  const candidates: Candidate[] = [];
  const seen = new Set<string>();

  function add(label: string, inputOptions: string[], outputOptions: string[]): void {
    if (seen.has(label)) return;
    seen.add(label);
    candidates.push({ label, inputOptions, outputOptions });
  }

  const fps = `fps=1/${interval.toFixed(3)}`;
  const swFilter = `${fps},scale=${TARGET_WIDTH}:-2`;
  const vtFilter = `${fps},scale_vt=${TARGET_WIDTH}:-2`;

  const baseInput = ['-nostdin', '-hide_banner', '-loglevel', 'error', '-y', '-ss', '0'];
  const swOutput = [
    '-map', '0:V:0',
    '-vf', swFilter,
    '-frames:v', String(FRAME_COUNT),
    '-vsync', '1',
    '-q:v', '2'
  ];
  const vtOutput = [
    '-map', '0:V:0',
    '-vf', vtFilter,
    '-frames:v', String(FRAME_COUNT),
    '-vsync', '1',
    '-q:v', '2'
  ];
  const vtInputBase = [
    ...baseInput,
    '-hwaccel', 'videotoolbox',
    '-hwaccel_output_format', 'videotoolbox_vld'
  ];

  // Candidates are emitted unconditionally; ffmpeg will fail fast with
  // "Decoder not found" (~100ms) if a specific decoder isn't compiled in,
  // and the next candidate takes over. We do NOT gate on `available` because
  // a misparsed decoder list would otherwise produce zero candidates and
  // break thumbnail generation for files that ffmpeg can clearly handle.

  // 1) Primary path based on detected family.
  if (family === 'hevc') {
    if (isMac) {
      add('hevc_videotoolbox+scale_vt', [...vtInputBase, '-c:v', 'hevc'], vtOutput);
    } else {
      add('hevc+scale', [...baseInput, '-c:v', 'hevc'], swOutput);
    }
  } else if (family === 'h264') {
    if (isMac) add('h264_videotoolbox+scale_vt', [...vtInputBase, '-c:v', 'h264'], vtOutput);
    add('h264+scale', [...baseInput, '-c:v', 'h264'], swOutput);
  } else if (family === 'av1') {
    add('av1+scale', [...baseInput, '-c:v', 'av1'], swOutput);
    if (isMac) add('hevc_videotoolbox+scale_vt', [...vtInputBase, '-c:v', 'hevc'], vtOutput);
  } else {
    // 2) Unknown codec: try defaults then last-resort VT guesses.
    add('auto+scale', [...baseInput], swOutput);
    if (isMac) add('hevc_videotoolbox+scale_vt', [...vtInputBase, '-c:v', 'hevc'], vtOutput);
    if (isMac) add('h264_videotoolbox+scale_vt', [...vtInputBase, '-c:v', 'h264'], vtOutput);
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

async function runFfmpeg(
  videoPath: string,
  inputOptions: string[],
  outputOptions: string[],
  outDir: string
): Promise<RunResult> {
  const t0 = Date.now();
  const outPattern = join(outDir, 'thumb_%03d.jpg');
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

  const command = ffmpeg(videoPath)
    .inputOptions(inputOptions)
    .outputOptions(outputOptions)
    .output(outPattern)
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
  base: { inputOptions: string[]; outputOptions: string[] }
): Promise<void> {
  const tmp = join(getThumbsDir(), `diag-${Date.now()}`);
  await mkdir(tmp, { recursive: true });
  const diagInput = [...base.inputOptions];
  const diagOutput = [
    ...base.outputOptions,
    '-loglevel', 'info',
    '-err_detect', 'explode',
    '-fflags', '+discardcorrupt'
  ];
  const pattern = join(tmp, 'thumb_%03d.jpg');

  const t0 = Date.now();
  let stderrFull = '';
  let code: number | null = null;
  let settled = false;
  let settle: () => void = () => {};
  const done = new Promise<void>((r) => { settle = r; });
  const safe = (): void => { if (!settled) { settled = true; settle(); } };

  ffmpeg(videoPath)
    .inputOptions(diagInput)
    .outputOptions(diagOutput)
    .output(pattern)
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

  const args = `${diagInput.join(' ')} ${diagOutput.join(' ')}`;
  console.warn(
    `[thumbnail:diag] ${basename(videoPath)} args=[${args}] ` +
    `elapsed=${Date.now() - t0}ms exit=${code ?? 'n/a'}\n` +
    stderrFull.slice(-DIAGNOSTIC_LOG_TAIL)
  );
}

export async function generateThumbnails(
  videoId: number,
  videoPath: string,
  durationSec: number,
  codec: string | null,
  codecTag: string | null,
  onProgress?: (i: number) => void
): Promise<void> {
  const outDir = thumbsDirFor(videoPath);
  await rm(outDir, { recursive: true, force: true });
  await mkdir(outDir, { recursive: true });

  const interval = Math.max(durationSec / FRAME_COUNT, 0.05);

  const family = codecFamily(codec, codecTag);
  const candidates = buildCandidates(family, interval);

  if (candidates.length === 0) {
    throw new Error(
      `no ffmpeg decode candidates for codec=${codec ?? '?'}/${codecTag ?? '?'} on ${process.platform}`
    );
  }

  const attempts: { label: string; error: string; files: number }[] = [];
  for (const c of candidates) {
    const result = await runFfmpeg(videoPath, c.inputOptions, c.outputOptions, outDir);
    if (result.files.length > 0) {
      const tag = result.files.length < FRAME_COUNT ? 'partial' : 'ok';
      const msg =
        `[thumbnail] ${basename(videoPath)}: ${result.files.length}/${FRAME_COUNT} frames via ${c.label} ` +
        `[${tag}] elapsed=${result.elapsedMs}ms exit=${result.code ?? 'n/a'} ` +
        `args=[${result.args.slice(1).join(' ')}]`;
      if (tag === 'partial') {
        console.warn(msg);
      } else {
        console.log(msg);
      }
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
  await diagnosticRerun(videoPath, first);

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
