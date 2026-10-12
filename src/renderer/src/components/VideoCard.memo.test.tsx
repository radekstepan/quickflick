import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { VideoWithThumbs } from '@shared/types';
import { VideoCard } from './VideoCard';

const { matchCalls } = vi.hoisted(() => ({ matchCalls: vi.fn() }));

vi.mock('../utils/tags', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../utils/tags')>();
  return {
    ...mod,
    getMatchingTags: (
      ...args: Parameters<typeof mod.getMatchingTags>
    ): ReturnType<typeof mod.getMatchingTags> => {
      matchCalls();
      return mod.getMatchingTags(...args);
    }
  };
});

function makeVideo(tags: string[] = ['Gone Tag']): VideoWithThumbs {
  return {
    id: 1,
    path: '/root/Clips/gone tag clip.mp4',
    folder: '/root/Clips',
    filename: 'gone tag clip.mp4',
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
    content_fingerprint: 'fp-1',
    tags,
    excludedTags: [],
    thumbnails: []
  };
}

const baseProps = {
  video: makeVideo(),
  roots: ['/root'],
  matchTags: [{ name: 'Gone Tag', count: 1 }],
  removedTagNames: new Set<string>(),
  pending: undefined,
  tagNames: ['Gone Tag'],
  onOpen: vi.fn(),
  onAddTag: vi.fn(),
  onRemoveTag: vi.fn()
};

describe('VideoCard memo on global delete', () => {
  it('does not re-run matching when only removedTagNames changes', () => {
    matchCalls.mockClear();
    const { container, rerender } = render(<VideoCard {...baseProps} />);
    expect(matchCalls).toHaveBeenCalledTimes(1);

    // Simulate a sidebar global delete landing as a new Set identity.
    rerender(<VideoCard {...baseProps} removedTagNames={new Set(['gone tag'])} />);

    // Comparator skips the card (nothing visible depends on the removed
    // set while the picker is closed) and matching is not recomputed.
    expect(matchCalls).toHaveBeenCalledTimes(1);
    expect(container.firstChild).toBeTruthy();
  });

  it('hides the removed chip when the picker opens afterwards', () => {
    matchCalls.mockClear();
    const { container, rerender } = render(<VideoCard {...baseProps} />);
    rerender(<VideoCard {...baseProps} removedTagNames={new Set(['gone tag'])} />);

    // Open the picker: re-render reads the latest props, chip is gone.
    fireEvent.contextMenu(container.firstChild as Element);
    fireEvent.click(screen.getByText('Edit tags'));
    expect(screen.queryByText('Gone Tag')).toBeNull();
    // Tail filter recomputed, but the O(T) match ran only on first render.
    expect(matchCalls).toHaveBeenCalledTimes(1);
  });

  it('re-runs matching when the video itself changes', () => {
    matchCalls.mockClear();
    const { rerender } = render(<VideoCard {...baseProps} />);
    expect(matchCalls).toHaveBeenCalledTimes(1);
    rerender(<VideoCard {...baseProps} video={makeVideo(['Other Tag'])} />);
    expect(matchCalls).toHaveBeenCalledTimes(2);
  });
});
