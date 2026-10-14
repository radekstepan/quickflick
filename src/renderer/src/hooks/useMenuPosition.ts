import { useLayoutEffect, useRef, useState } from 'react';

export interface MenuAnchor {
  x: number;
  y: number;
}

export interface MenuSize {
  width: number;
  height: number;
}

export interface ViewportSize {
  width: number;
  height: number;
}

/**
 * Resolve a cursor-anchored menu position so the menu stays fully visible.
 * - Opens leftward when it would overflow the right edge.
 * - Opens upward when it would overflow the bottom edge.
 * - Clamps to `margin` so corner cases (or a menu larger than the
 *   viewport) never land off-screen.
 */
export function clampMenuToViewport(
  anchor: MenuAnchor,
  size: MenuSize,
  viewport: ViewportSize,
  margin = 8
): MenuAnchor {
  let left = anchor.x;
  let top = anchor.y;

  if (left + size.width > viewport.width - margin) {
    left = anchor.x - size.width;
  }
  if (top + size.height > viewport.height - margin) {
    top = anchor.y - size.height;
  }

  left = Math.min(
    Math.max(left, margin),
    Math.max(margin, viewport.width - size.width - margin)
  );
  top = Math.min(
    Math.max(top, margin),
    Math.max(margin, viewport.height - size.height - margin)
  );

  return { x: left, y: top };
}

/**
 * Measure the rendered menu before paint and flip it away from viewport
 * edges. Render the menu at the raw cursor position, attach `ref`, and
 * use `position` (falling back to the anchor until measured):
 *
 *   const { ref, position } = useMenuPosition(menu);
 *   style={{ left: position?.x ?? menu.x, top: position?.y ?? menu.y }}
 */
export function useMenuPosition(anchor: MenuAnchor | null) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [position, setPosition] = useState<MenuAnchor | null>(null);

  const anchorX = anchor?.x;
  const anchorY = anchor?.y;

  useLayoutEffect(() => {
    if (anchorX === undefined || anchorY === undefined) {
      setPosition(null);
      return;
    }
    const current: MenuAnchor = { x: anchorX, y: anchorY };
    const measure = () => {
      const el = ref.current;
      if (!el) {
        setPosition(current);
        return;
      }
      const rect = el.getBoundingClientRect();
      setPosition(
        clampMenuToViewport(
          current,
          { width: rect.width, height: rect.height },
          { width: window.innerWidth, height: window.innerHeight }
        )
      );
    };
    measure();
    window.addEventListener('resize', measure);
    return () => {
      window.removeEventListener('resize', measure);
    };
  }, [anchorX, anchorY]);

  return { ref, position };
}
