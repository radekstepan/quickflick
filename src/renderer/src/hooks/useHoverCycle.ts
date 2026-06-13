import { useCallback, useEffect, useRef, useState } from 'react';

export interface HoverCycleOptions {
  frameCount: number;
  intervalMs?: number;
  enabled?: boolean;
}

export interface HoverCycleApi {
  currentFrame: number;
  isHovering: boolean;
  bind: {
    onMouseEnter: () => void;
    onMouseLeave: () => void;
  };
}

/**
 * Cycles through N frames at a fixed interval while hovered.
 * - Resets to frame 0 on mouseleave.
 * - If frameCount <= 1, never cycles and stays at 0.
 */
export function useHoverCycle({ frameCount, intervalMs = 700, enabled = true }: HoverCycleOptions): HoverCycleApi {
  const [currentFrame, setCurrentFrame] = useState(0);
  const [isHovering, setIsHovering] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const frameRef = useRef(0);

  const stop = useCallback(() => {
    if (intervalRef.current !== null) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, []);

  const start = useCallback(() => {
    stop();
    if (!enabled || frameCount <= 1) return;
    intervalRef.current = setInterval(() => {
      frameRef.current = (frameRef.current + 1) % frameCount;
      setCurrentFrame(frameRef.current);
    }, intervalMs);
  }, [enabled, frameCount, intervalMs, stop]);

  const onMouseEnter = useCallback(() => {
    setIsHovering(true);
    start();
  }, [start]);

  const onMouseLeave = useCallback(() => {
    setIsHovering(false);
    stop();
    frameRef.current = 0;
    setCurrentFrame(0);
  }, [stop]);

  useEffect(() => {
    return () => stop();
  }, [stop]);

  return {
    currentFrame,
    isHovering,
    bind: { onMouseEnter, onMouseLeave }
  };
}
