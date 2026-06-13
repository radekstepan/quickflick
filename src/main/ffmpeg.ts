import { spawn } from 'node:child_process';
import type { FfmpegStatus } from '../shared/types';

const HINT = 'Install with: brew install ffmpeg';

function run(cmd: string, args: string[], timeoutMs = 5000): Promise<{ ok: boolean; stdout: string; stderr: string; code: number | null }> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (result: { ok: boolean; stdout: string; stderr: string; code: number | null }) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };

    let stdout = '';
    let stderr = '';
    let child;
    try {
      child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (e) {
      finish({ ok: false, stdout: '', stderr: String(e), code: null });
      return;
    }

    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      finish({ ok: false, stdout, stderr: stderr + '\n[timeout]', code: null });
    }, timeoutMs);

    child.stdout?.on('data', (d) => { stdout += d.toString(); });
    child.stderr?.on('data', (d) => { stderr += d.toString(); });
    child.on('error', (e) => {
      clearTimeout(timer);
      finish({ ok: false, stdout, stderr: stderr + '\n' + String(e), code: null });
    });
    child.on('exit', (code) => {
      clearTimeout(timer);
      finish({ ok: code === 0, stdout, stderr, code });
    });
  });
}

let decoderCache: Promise<Set<string>> | null = null;
let lastDecoderFetchFailed = false;

export function getAvailableDecoders(): Promise<Set<string>> {
  // Don't cache empty/failed results — the next call may succeed (e.g. ffmpeg
  // wasn't on PATH before, or the previous attempt was racy). We DO cache
  // non-empty successful results.
  if (decoderCache && !lastDecoderFetchFailed) return decoderCache;
  decoderCache = (async () => {
    const result = await run('ffmpeg', ['-hide_banner', '-decoders'], 5_000);
    if (!result.ok) {
      lastDecoderFetchFailed = true;
      console.warn(
        `[ffmpeg] ffmpeg -decoders failed (code=${result.code}); decoder list unavailable. stderr: ${result.stderr.slice(-300)}`
      );
      return new Set<string>();
    }
    // Parse both stdout and stderr in case ffmpeg writes the decoder list
    // to either stream depending on the build.
    const combined = `${result.stdout}\n${result.stderr}`;
    const set = new Set<string>();
    // Lines look like:
    //   V...D.. = hevc  H.265 / HEVC  (decoders: hevc hevc_qsv hevc_videotoolbox)
    const re = /\(decoders:\s*([^)]+)\)/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(combined)) !== null) {
      m[1].split(/\s+/).forEach((d) => d && set.add(d));
    }
    if (set.size === 0) {
      lastDecoderFetchFailed = true;
      console.warn(
        `[ffmpeg] ffmpeg -decoders produced no parseable entries. raw output (first 500 chars): ${combined.slice(0, 500)}`
      );
    } else {
      lastDecoderFetchFailed = false;
    }
    return set;
  })();
  return decoderCache;
}

export async function checkFfmpeg(): Promise<FfmpegStatus> {
  const result = await run('ffmpeg', ['-hide_banner', '-version']);
  if (!result.ok) {
    return { ok: false, installHint: HINT };
  }
  const firstLine = result.stdout.split('\n')[0]?.trim() ?? 'ffmpeg (unknown version)';
  return { ok: true, version: firstLine };
}

export async function checkFfprobe(): Promise<FfmpegStatus> {
  const result = await run('ffprobe', ['-hide_banner', '-version']);
  if (!result.ok) {
    return { ok: false, installHint: HINT };
  }
  const firstLine = result.stdout.split('\n')[0]?.trim() ?? 'ffprobe (unknown version)';
  return { ok: true, version: firstLine };
}

export { run };
