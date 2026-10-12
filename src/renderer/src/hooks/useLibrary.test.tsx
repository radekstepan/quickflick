import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { VideoWithThumbs } from '@shared/types';
import { applyPendingToVideo } from './useLibrary';
// NOTE: useLibrary (via ../api) snapshots window.api at module load, so it
// must be dynamically imported AFTER stubbing window.api in each test.

function makeVideo(id: number, filename: string, tags: string[] = []): VideoWithThumbs {
  return {
    id,
    path: `/root/Clips/${filename}`,
    folder: '/root/Clips',
    filename,
    size: 1000,
    mtime_ms: 1700000000000,
    duration: null,
    width: null,
    height: null,
    scanned_at: 1700000000000,
    codec: null,
    thumb_status: 'pending',
    view_count: 0,
    view_time_ms: 0,
    content_fingerprint: `fp-${id}`,
    tags,
    excludedTags: [],
    thumbnails: []
  };
}

const videos = [
  makeVideo(1, 'beach vacation clip one.mp4'),
  makeVideo(2, 'beach vacation clip two.mp4'),
  makeVideo(3, 'solo clip.mp4', ['Solo Tag'])
];

function stubApi(overrides: { userTags?: string[] } = {}) {
  const api = {
    getRoots: vi.fn(async () => ['/root']),
    getFfmpegStatus: vi.fn(async () => ({ ok: true })),
    getAllUserTagNames: vi.fn(async () => overrides.userTags ?? [] as string[]),
    getGlobalExcludedTagNames: vi.fn(async () => [] as string[]),
    listVideos: vi.fn(async () => videos),
    deleteTagGlobally: vi.fn(async (_name: string) => {}),
    setVideoTag: vi.fn(async (_id: number, _name: string) => {}),
    removeVideoTag: vi.fn(async (_id: number, _name: string) => {}),
    onScanProgress: vi.fn(() => () => {}),
    onMenuCommand: vi.fn(() => () => {}),
    onVideosDiscovered: vi.fn(() => () => {}),
    onVideoThumbed: vi.fn(() => () => {}),
    onVideoViewed: vi.fn(() => () => {})
  };
  (window as unknown as { api: unknown }).api = api;
  return api;
}

beforeEach(() => {
  localStorage.clear();
  vi.resetModules();
});

async function loadHook(overrides: { userTags?: string[] } = {}) {
  stubApi(overrides);
  return (await import('./useLibrary')).useLibrary;
}

describe('useLibrary deleteTagGlobally', () => {
  it('removes the tag from the list on the same frame as the click', async () => {
    const useLibrary = await loadHook();
    const { result } = renderHook(() => useLibrary());

    await waitFor(() => expect(result.current.loading).toBe(false));
    const before = result.current.tags.map((t) => t.name);
    expect(before.length).toBeGreaterThan(0);
    const target = before[0];

    act(() => {
      result.current.deleteTagGlobally(target);
    });

    // No awaiting deferred values: the row must be gone synchronously.
    expect(result.current.tags.map((t) => t.name)).not.toContain(target);
    expect((window as unknown as { api: { deleteTagGlobally: ReturnType<typeof vi.fn> } }).api.deleteTagGlobally).toHaveBeenCalledWith(target);
  });

  it('removes an explicit user tag from the list immediately', async () => {
    const useLibrary = await loadHook({ userTags: ['My Tag'] });
    const { result } = renderHook(() => useLibrary());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.tags.map((t) => t.name)).toContain('My Tag');

    act(() => {
      result.current.deleteTagGlobally('My Tag');
    });

    expect(result.current.tags.map((t) => t.name)).not.toContain('My Tag');
  });

  it('records per-video removes as an urgent pending overlay', async () => {
    const useLibrary = await loadHook();
    const { result } = renderHook(() => useLibrary());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.videos.find((v) => v.id === 3)?.tags).toContain('Solo Tag');

    act(() => {
      result.current.removeVideoTag(3, 'Solo Tag');
    });

    // Urgent overlay: chip state is updated even before the transitioned
    // videos patch lands.
    const overlay = result.current.pendingEdits.get(3);
    expect(overlay?.tags).not.toContain('Solo Tag');
    expect(overlay?.excludedTags).toContain('Solo Tag');

    await act(async () => {
      // Flush the transition + IPC microtasks.
    });
    const patched = result.current.videos.find((v) => v.id === 3);
    expect(patched?.tags).not.toContain('Solo Tag');
    expect(patched?.excludedTags).toContain('Solo Tag');
  });

  it('rolls back a failed per-video remove via reload', async () => {
    const failingApi = {
      removeVideoTag: vi.fn(async (_id: number, _name: string) => {
        throw new Error('ipc boom');
      })
    };
    const useLibrary = await loadHook();
    // Swap in the failing write after load.
    (window as unknown as { api: { removeVideoTag: unknown } }).api.removeVideoTag =
      failingApi.removeVideoTag;
    const { result } = renderHook(() => useLibrary());

    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.removeVideoTag(3, 'Solo Tag');
    });

    // reload() ran: pending overlay cleared, rows refreshed from the stub
    // (which still carries the tag — the write never landed).
    expect(result.current.pendingEdits.size).toBe(0);
    expect(failingApi.removeVideoTag).toHaveBeenCalledWith(3, 'Solo Tag');
  });
});

describe('applyPendingToVideo', () => {
  const base = { tags: ['A'], excludedTags: [] as string[] };

  it('returns the same ref when there is no overlay', () => {
    expect(applyPendingToVideo(base, undefined)).toBe(base);
  });

  it('overlays tags + exclusions', () => {
    const out = applyPendingToVideo(base, { tags: [], excludedTags: ['A'] });
    expect(out.tags).toEqual([]);
    expect(out.excludedTags).toEqual(['A']);
    expect(out).not.toBe(base);
  });
});
