import { describe, it, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { clampMenuToViewport, useMenuPosition } from './useMenuPosition';

const VIEWPORT = { width: 1024, height: 768 };
const MENU = { width: 200, height: 150 };

describe('clampMenuToViewport', () => {
  it('keeps the anchor when the menu fits', () => {
    expect(clampMenuToViewport({ x: 100, y: 100 }, MENU, VIEWPORT)).toEqual({
      x: 100,
      y: 100
    });
  });

  it('flips left when too close to the right edge', () => {
    expect(clampMenuToViewport({ x: 900, y: 100 }, MENU, VIEWPORT)).toEqual({
      x: 700,
      y: 100
    });
  });

  it('flips up when too close to the bottom edge', () => {
    expect(clampMenuToViewport({ x: 100, y: 700 }, MENU, VIEWPORT)).toEqual({
      x: 100,
      y: 550
    });
  });

  it('flips both axes in the bottom-right corner', () => {
    expect(clampMenuToViewport({ x: 900, y: 700 }, MENU, VIEWPORT)).toEqual({
      x: 700,
      y: 550
    });
  });

  it('clamps to the margin when the flipped position leaves the opposite edge', () => {
    expect(
      clampMenuToViewport({ x: 50, y: 30 }, MENU, VIEWPORT)
    ).toEqual({ x: 50, y: 30 });
    // Flipped left would be negative, so it clamps to the margin.
    expect(
      clampMenuToViewport({ x: 100, y: 100 }, MENU, { width: 150, height: 100 })
    ).toEqual({ x: 8, y: 8 });
  });

  it('respects a custom margin', () => {
    // 900 + 200 > 1024 - 20, so it flips to 700, inside the margin bounds.
    expect(
      clampMenuToViewport({ x: 900, y: 100 }, MENU, VIEWPORT, 20)
    ).toEqual({ x: 700, y: 100 });
    // A flip that would still breach the margin gets clamped instead.
    expect(
      clampMenuToViewport({ x: 1010, y: 100 }, MENU, VIEWPORT, 20)
    ).toEqual({ x: 804, y: 100 });
  });

  it('does not flip when exactly at the boundary', () => {
    // 824 + 200 = 1024 - 0 margin edge: fits exactly, no flip.
    expect(
      clampMenuToViewport({ x: 824, y: 100 }, MENU, VIEWPORT, 0)
    ).toEqual({ x: 824, y: 100 });
  });
});

describe('useMenuPosition', () => {
  it('measures the menu and flips away from the right edge', () => {
    const { result } = renderHook(() => useMenuPosition({ x: 900, y: 100 }));
    const el = document.createElement('div');
    vi.spyOn(el, 'getBoundingClientRect').mockReturnValue({
      width: 200,
      height: 150,
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      right: 200,
      bottom: 150,
      toJSON: () => ({})
    });
    (result.current.ref as { current: HTMLDivElement | null }).current = el;
    // Trigger re-measure via resize with the ref attached.
    act(() => {
      window.dispatchEvent(new Event('resize'));
    });
    expect(result.current.position).toEqual({ x: 700, y: 100 });
  });

  it('returns null position when there is no anchor', () => {
    const { result } = renderHook(() => useMenuPosition(null));
    expect(result.current.position).toBeNull();
  });
});
