import { run } from './ffmpeg';

export type CodecFamily = 'hevc' | 'h264' | 'av1' | 'other';

export function codecFamily(codec: string | null, codecTag: string | null): CodecFamily {
  const c = (codec ?? '').toLowerCase();
  const t = (codecTag ?? '').toLowerCase();
  if (c === 'hevc' || c === 'h265' || t === 'hvc1' || t === 'hev1') return 'hevc';
  if (c === 'h264' || c === 'avc' || c === 'avc1' || t === 'avc1' || t === 'avc3') return 'h264';
  if (c === 'av1' || t === 'av01') return 'av1';
  return 'other';
}

export interface ProbeResult {
  hasVideo: boolean;
  duration: number | null;
  width: number | null;
  height: number | null;
  codecName: string | null;
  codecTag: string | null;
}

interface RawStream {
  codec_type?: string;
  codec_name?: string;
  codec_tag_string?: string;
  width?: number;
  height?: number;
  duration?: string;
  disposition?: {
    attached_pic?: number;
  };
}

interface RawFormat {
  duration?: string;
}

export async function probeVideo(filePath: string): Promise<ProbeResult> {
  const empty = {
    hasVideo: false,
    duration: null,
    width: null,
    height: null,
    codecName: null,
    codecTag: null
  };
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

  const videoStream = parsed.streams?.find(
    (s) => s.codec_type === 'video' && s.disposition?.attached_pic !== 1
  );
  if (!videoStream) {
    return empty;
  }

  const durationRaw = parsed.format?.duration ?? videoStream.duration;
  const duration = durationRaw ? Number(durationRaw) : null;
  return {
    hasVideo: true,
    duration: duration && Number.isFinite(duration) ? duration : null,
    width: videoStream.width ?? null,
    height: videoStream.height ?? null,
    codecName: videoStream.codec_name ?? null,
    codecTag: videoStream.codec_tag_string ?? null
  };
}
