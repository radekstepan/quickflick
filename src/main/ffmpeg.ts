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
