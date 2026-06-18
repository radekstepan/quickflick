import { describe, it, expect, vi } from 'vitest';
import { Queue } from './queue';

describe('Queue', () => {
  it('runs tasks up to concurrency limit', async () => {
    const q = new Queue(2);
    let running = 0;
    let maxRunning = 0;
    const tasks = Array.from({ length: 5 }, () => async () => {
      running++;
      maxRunning = Math.max(maxRunning, running);
      await new Promise((r) => setTimeout(r, 10));
      running--;
      return 1;
    });
    await Promise.all(tasks.map((t) => q.add(t)));
    expect(maxRunning).toBe(2);
  });

  it('resolves with task return value', async () => {
    const q = new Queue(1);
    const result = await q.add(async () => 42);
    expect(result).toBe(42);
  });

  it('rejects on task error', async () => {
    const q = new Queue(1);
    await expect(q.add(async () => { throw new Error('boom'); })).rejects.toThrow('boom');
  });

  it('reports correct depth and pending', async () => {
    const q = new Queue(1);
    expect(q.depth).toBe(0);
    expect(q.pending).toBe(0);

    const blockers = Array.from({ length: 3 }, () => () => new Promise<void>((r) => setTimeout(r, 50)));
    void q.add(blockers[0]!);
    void q.add(blockers[1]!);
    void q.add(blockers[2]!);

    // Give the first task a tick to start running
    await new Promise((r) => setTimeout(r, 5));
    expect(q.depth).toBe(3);
    expect(q.pending).toBe(2);

    // Wait for all to finish
    await q.drain();
    expect(q.depth).toBe(0);
    expect(q.pending).toBe(0);
  });

  it('drain() waits for all tasks to complete', async () => {
    const q = new Queue(3);
    const results: number[] = [];
    const tasks = [10, 20, 30, 40].map((n) => async () => {
      await new Promise((r) => setTimeout(r, n));
      results.push(n);
      return n;
    });
    await Promise.all(tasks.map((t) => q.add(t)));
    await q.drain();
    expect(results).toHaveLength(4);
    expect(results.sort()).toEqual([10, 20, 30, 40]);
  });

  it('processes remaining tasks after one fails', async () => {
    const q = new Queue(1);
    const order: string[] = [];
    void q.add(async () => {
      await new Promise((r) => setTimeout(r, 5));
      order.push('fail');
      throw new Error('nope');
    }).catch(() => {});
    void q.add(async () => {
      order.push('ok');
      return 1;
    });
    await q.drain();
    expect(order).toEqual(['fail', 'ok']);
  });

  it('continues scheduling after rejections', async () => {
    const q = new Queue(2);
    const spy = vi.fn();
    const promises = [
      q.add(async () => { throw new Error('a'); }),
      q.add(async () => { throw new Error('b'); }),
      q.add(async () => { spy(); return 'c'; })
    ];
    await Promise.allSettled(promises);
    expect(spy).toHaveBeenCalled();
  });
});
