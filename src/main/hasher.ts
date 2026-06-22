import { createHash } from 'node:crypto';
import { open } from 'node:fs/promises';

export const HEAD_BYTES = 2 * 1024 * 1024;
export const TAIL_BYTES = 2 * 1024 * 1024;

export async function computeFingerprint(filePath: string, size: number): Promise<string> {
  const hash = createHash('sha1');
  hash.update(`size:${size}\n`);

  if (size <= 0) {
    return hash.digest('hex');
  }

  let fh;
  try {
    fh = await open(filePath, 'r');
  } catch {
    return '';
  }
  try {
    const headLen = Math.min(HEAD_BYTES, size);
    const headBuf = Buffer.alloc(headLen);
    if (headLen > 0) {
      await fh.read(headBuf, 0, headLen, 0);
      hash.update(headBuf);
    }

    if (size > HEAD_BYTES + TAIL_BYTES) {
      const tailBuf = Buffer.alloc(TAIL_BYTES);
      await fh.read(tailBuf, 0, TAIL_BYTES, size - TAIL_BYTES);
      hash.update(tailBuf);
    }
  } finally {
    await fh.close();
  }
  return hash.digest('hex');
}
