// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, writeFile, rm, appendFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { computeFingerprint, HEAD_BYTES, TAIL_BYTES } from './hasher';

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'qf-hash-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function writeFileOfSize(name: string, size: number, fill = 0x61): Promise<string> {
  const p = join(dir, name);
  const buf = Buffer.alloc(size, fill);
  await writeFile(p, buf);
  return p;
}

describe('computeFingerprint', () => {
  it('returns the same fingerprint for identical files', async () => {
    const a = await writeFileOfSize('a.bin', 1024 * 1024, 0x41);
    const b = await writeFileOfSize('b.bin', 1024 * 1024, 0x41);
    const fa = await computeFingerprint(a, 1024 * 1024);
    const fb = await computeFingerprint(b, 1024 * 1024);
    expect(fa).toBe(fb);
    expect(fa).toMatch(/^[0-9a-f]{40}$/);
  });

  it('returns different fingerprints for different content', async () => {
    const a = await writeFileOfSize('a.bin', 1024 * 1024, 0x41);
    const b = await writeFileOfSize('b.bin', 1024 * 1024, 0x42);
    const fa = await computeFingerprint(a, 1024 * 1024);
    const fb = await computeFingerprint(b, 1024 * 1024);
    expect(fa).not.toBe(fb);
  });

  it('returns different fingerprints for the same content at different sizes', async () => {
    // Different file sizes must yield different fingerprints even if head+tail
    // overlap exactly. The size prefix guarantees this.
    const a = await writeFileOfSize('a.bin', 1024, 0x41);
    const b = await writeFileOfSize('b.bin', 2048, 0x41);
    const fa = await computeFingerprint(a, 1024);
    const fb = await computeFingerprint(b, 2048);
    expect(fa).not.toBe(fb);
  });

  it('handles files smaller than HEAD_BYTES (no tail read)', async () => {
    const p = await writeFileOfSize('small.bin', 100, 0x41);
    const fp = await computeFingerprint(p, 100);
    expect(fp).toMatch(/^[0-9a-f]{40}$/);
  });

  it('handles empty files', async () => {
    const p = join(dir, 'empty.bin');
    await writeFile(p, Buffer.alloc(0));
    const fp = await computeFingerprint(p, 0);
    expect(fp).toMatch(/^[0-9a-f]{40}$/);
  });

  it('handles files exactly at HEAD_BYTES boundary', async () => {
    const p = await writeFileOfSize('edge.bin', HEAD_BYTES, 0x41);
    const fp = await computeFingerprint(p, HEAD_BYTES);
    expect(fp).toMatch(/^[0-9a-f]{40}$/);
  });

  it('distinguishes files that differ in the tail', async () => {
    // Quick fingerprint deliberately samples head + tail + size. Differences
    // in either the head or the tail must change the fingerprint.
    const size = HEAD_BYTES + 4 * 1024 * 1024 + TAIL_BYTES;
    const a = Buffer.alloc(size, 0x41);
    const b = Buffer.alloc(size, 0x41);
    // Mutate the tail of `b` (within the last TAIL_BYTES).
    for (let i = size - TAIL_BYTES; i < size; i += 4096) {
      b[i] = 0x42;
    }
    const pa = join(dir, 'a.bin');
    const pb = join(dir, 'b.bin');
    await writeFile(pa, a);
    await writeFile(pb, b);
    const fa = await computeFingerprint(pa, size);
    const fb = await computeFingerprint(pb, size);
    expect(fa).not.toBe(fb);
  });

  it('distinguishes files that differ in the head', async () => {
    const size = HEAD_BYTES + 4 * 1024 * 1024 + TAIL_BYTES;
    const a = Buffer.alloc(size, 0x41);
    const b = Buffer.alloc(size, 0x41);
    // Mutate the head of `b` (within the first HEAD_BYTES).
    for (let i = 0; i < HEAD_BYTES; i += 4096) {
      b[i] = 0x42;
    }
    const pa = join(dir, 'a.bin');
    const pb = join(dir, 'b.bin');
    await writeFile(pa, a);
    await writeFile(pb, b);
    const fa = await computeFingerprint(pa, size);
    const fb = await computeFingerprint(pb, size);
    expect(fa).not.toBe(fb);
  });

  it('does not distinguish files that differ only in the middle (by design)', async () => {
    // Documented limitation of the quick fingerprint: two files of the
    // same size with identical head+tail will collide. In practice this
    // is effectively impossible for real video files (head and tail
    // always vary), but the test pins the behavior.
    const size = HEAD_BYTES + 4 * 1024 * 1024 + TAIL_BYTES;
    const a = Buffer.alloc(size, 0x41);
    const b = Buffer.alloc(size, 0x41);
    for (let i = HEAD_BYTES; i < size - TAIL_BYTES; i += 4096) {
      b[i] = 0x42;
    }
    const pa = join(dir, 'a.bin');
    const pb = join(dir, 'b.bin');
    await writeFile(pa, a);
    await writeFile(pb, b);
    const fa = await computeFingerprint(pa, size);
    const fb = await computeFingerprint(pb, size);
    expect(fa).toBe(fb);
  });

  it('returns empty string when the file cannot be opened', async () => {
    const fp = await computeFingerprint(join(dir, 'does-not-exist.bin'), 100);
    expect(fp).toBe('');
  });

  it('includes size in the hash even when content matches', async () => {
    const a = await writeFileOfSize('a.bin', 100, 0x41);
    const fpForSize100 = await computeFingerprint(a, 100);
    // Append data to the same file, re-fingerprint with new size.
    await appendFile(a, Buffer.alloc(100, 0x41));
    const fpForSize200 = await computeFingerprint(a, 200);
    expect(fpForSize100).not.toBe(fpForSize200);
  });
});
