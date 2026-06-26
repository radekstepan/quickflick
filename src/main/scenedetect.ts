import { spawn } from 'node:child_process';
import { codecFamily } from './probe';
import type { SceneProgress, SceneSampleRate } from '@shared/types';

const SCENE_THRESHOLD = 0.3;
const MIN_SCENE_LEN_SEC = 0.6;
const SCENE_TIMEOUT_MS = Number(process.env['QF_SCENE_TIMEOUT_MS'] ?? 10 * 60 * 1000);
const SHOWINFO_RE = /\[Parsed_showinfo_\d+ @ [^\]]+\][^\n]*?pts_time:([0-9.]+)/g;
const PROGRESS_KV_RE = /(\w+)=([^\s]+)/g;
const PROGRESS_THROTTLE_MS = 200;

const SAMPLE_FPS: Record<SceneSampleRate, string> = {
  'every-frame': '',
  'fast': '1',
  'quick': '0.1',
  'sketch': '0.0167'
};

export interface Scene {
  start: number;
  end: number;
}

interface Candidate {
  label: string;
  sharedInputOptions: string[];
}

function buildCandidates(codec: string | null, codecTag: string | null): Candidate[] {
  const family = codecFamily(codec, codecTag);
  const isMac = process.platform === 'darwin';
  const seen = new Set<string>();
  const out: Candidate[] = [];
  const add = (label: string, hwCodec: string | null): void => {
    if (seen.has(label)) return;
    seen.add(label);
    const shared: string[] = [];
    if (hwCodec) shared.push('-hwaccel', 'videotoolbox', '-c:v', hwCodec);
    out.push({ label, sharedInputOptions: shared });
  };
  if (family === 'hevc') {
    if (isMac) add('hevc_scene_vt', 'hevc');
    add('hevc_scene_sw', null);
  } else if (family === 'h264') {
    if (isMac) add('h264_scene_vt', 'h264');
    add('h264_scene_sw', null);
  } else {
    add('auto_scene_sw', null);
    if (isMac) {
      add('auto_scene_hevc_vt', 'hevc');
      add('auto_scene_h264_vt', 'h264');
    }
  }
  return out;
}

export async function detectScenesFFmpeg(
  videoPath: string,
  durationSec: number,
  codec: string | null,
  codecTag: string | null,
  sampleRate: SceneSampleRate,
  onProgress?: (p: SceneProgress) => void
): Promise<Scene[]> {
  onProgress?.({ kind: 'phase', text: 'Analyzing scenes…' });

  const candidates = buildCandidates(codec, codecTag);
  const errors: { label: string; error: string }[] = [];

  for (const c of candidates) {
    try {
      return await runOne(videoPath, durationSec, c, sampleRate, onProgress);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push({ label: c.label, error: msg });
      console.warn(`[scenedetect] candidate ${c.label} failed: ${msg.slice(-300)}`);
    }
  }
  const summary = errors.map((e) => `${e.label}: ${e.error.slice(-120)}`).join(' | ');
  throw new Error(`Scene detection failed for all candidates. ${summary}`);
}

function runOne(
  videoPath: string,
  durationSec: number,
  candidate: Candidate,
  sampleRate: SceneSampleRate,
  onProgress?: (p: SceneProgress) => void
): Promise<Scene[]> {
  return new Promise((resolve, reject) => {
    const fpsFilter = SAMPLE_FPS[sampleRate] ? `fps=${SAMPLE_FPS[sampleRate]},` : '';
    const args = [
      '-v', 'info',
      '-nostdin',
      '-an', '-sn', '-dn',
      '-skip_frame', 'nokey',
      ...candidate.sharedInputOptions,
      '-i', videoPath,
      '-vf',
      `${fpsFilter}scale=256:-2:flags=fast_bilinear,select='gt(scene,${SCENE_THRESHOLD})',showinfo`,
      '-f', 'null',
      '-progress', 'pipe:2',
      '-'
    ];

    const child = spawn('ffmpeg', args, { stdio: ['ignore', 'ignore', 'pipe'] });

    const cutTimes: number[] = [0];
    const stderrChunks: string[] = [];
    const STDERR_CAP = 2000;
    let stderrHead = '';
    let timedOut = false;
    let lastProgressEmit = 0;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
      setTimeout(() => {
        if (!child.killed) child.kill('SIGKILL');
      }, 3000).unref();
    }, SCENE_TIMEOUT_MS);
    timer.unref();

    const emitProgress = (now: number, fps: number, outTimeUs: number): void => {
      if (now - lastProgressEmit < PROGRESS_THROTTLE_MS) return;
      lastProgressEmit = now;
      const percent = durationSec > 0 ? Math.min(100, (outTimeUs / 1e6 / durationSec) * 100) : 0;
      const frame = Math.floor(outTimeUs / 41_700);
      onProgress?.({ kind: 'frame', frame, fps, percent });
    };

    child.stderr!.on('data', (d: Buffer) => {
      const s = d.toString();
      stderrChunks.push(s);
      const joined = stderrChunks.join('');
      if (joined.length > STDERR_CAP * 2) {
        stderrChunks.splice(0, stderrChunks.length);
        stderrHead = joined.slice(-STDERR_CAP);
      } else {
        stderrHead = joined.slice(-STDERR_CAP);
      }

      SHOWINFO_RE.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = SHOWINFO_RE.exec(stderrHead)) !== null) {
        const t = parseFloat(m[1]!);
        if (Number.isFinite(t) && t >= 0 && t < durationSec) cutTimes.push(t);
      }

      let isProgress = false;
      let fps = 0;
      let outTimeUs = 0;
      let k: RegExpExecArray | null;
      PROGRESS_KV_RE.lastIndex = 0;
      while ((k = PROGRESS_KV_RE.exec(stderrHead)) !== null) {
        if (k[1] === 'fps') {
          fps = parseFloat(k[2]!);
          isProgress = true;
        }
        if (k[1] === 'out_time_us' || k[1] === 'out_time_ms') {
          outTimeUs = k[1] === 'out_time_ms' ? parseFloat(k[2]!) * 1000 : parseFloat(k[2]!);
          isProgress = true;
        }
      }
      if (isProgress) emitProgress(Date.now(), fps, outTimeUs);
    });

    child.on('error', (err) => {
      clearTimeout(timer);
      const code = (err as NodeJS.ErrnoException).code;
      if (code === 'ENOENT') {
        reject(new Error('ffmpeg is not installed. Install with: brew install ffmpeg'));
      } else {
        reject(err);
      }
    });

    child.on('exit', (code, signal) => {
      clearTimeout(timer);
      const tail = stderrChunks.join('').replace(/\s+/g, ' ').trim().slice(-STDERR_CAP);

      if (timedOut) {
        reject(new Error(`timed out after ${Math.round(SCENE_TIMEOUT_MS / 60000)} min`));
        return;
      }
      if (code !== 0) {
        reject(
          new Error(
            `exit ${code}${signal ? ' (signal ' + signal + ')' : ''}: ${tail || '(no stderr)'}`
          )
        );
        return;
      }

      cutTimes.push(durationSec);
      cutTimes.sort((a, b) => a - b);
      const filtered: number[] = [0];
      for (let i = 1; i < cutTimes.length - 1; i++) {
        if (cutTimes[i]! - filtered[filtered.length - 1]! >= MIN_SCENE_LEN_SEC) {
          filtered.push(cutTimes[i]!);
        }
      }
      filtered.push(durationSec);

      const scenes: Scene[] = [];
      for (let i = 0; i < filtered.length - 1; i++) {
        scenes.push({ start: filtered[i]!, end: filtered[i + 1]! });
      }
      onProgress?.({ kind: 'done', count: scenes.length });
      resolve(scenes);
    });
  });
}
