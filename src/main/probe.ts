import { run } from './ffmpeg';

export interface ProbeResult {
  hasVideo: boolean;
  duration: number | null;
  width: number | null;
  height: number | null;
  codecName: string | null;
}

interface RawStream {
  codec_type?: string;
  codec_name?: string;
  width?: number;
  height?: number;
}

interface RawFormat {
  duration?: string;
}

export async function probeVideo(filePath: string): Promise<ProbeResult> {
  const empty = { hasVideo: false, duration: null, width: null, height: null, codecName: null };
  const result = await run(
    'ffprobe',
    [
      '-v', 'error',
      '-print_format', 'json',
      '-show_format',
      '-show_streams',
      filePath
    ],
    15_000
  );

  if (!result.ok) {
    return empty;
  }

  let parsed: { streams?: RawStream[]; format?: RawFormat };
  try {
    parsed = JSON.parse(result.stdout);
  } catch {
    return empty;
  }

  const videoStream = parsed.streams?.find((s) => s.codec_type === 'video');
  if (!videoStream) {
    return empty;
  }

  const duration = parsed.format?.duration ? Number(parsed.format.duration) : null;
  return {
    hasVideo: true,
    duration: duration && Number.isFinite(duration) ? duration : null,
    width: videoStream.width ?? null,
    height: videoStream.height ?? null,
    codecName: videoStream.codec_name ?? null
  };
}
