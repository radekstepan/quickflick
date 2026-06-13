import { forwardRef, useEffect, useRef, useState } from 'react';
import { VirtuosoGrid } from 'react-virtuoso';
import { VideoCard } from './VideoCard';
import type { VideoWithThumbs } from '@shared/types';

interface Props {
  videos: VideoWithThumbs[];
  onOpen: (id: number) => Promise<void>;
}

const PADDING_X = 32;
const GAP = 14;
const MIN_CARD = 240;

function computeColumns(width: number): number {
  if (width <= 0) return 1;
  return Math.max(1, Math.floor((width - PADDING_X + GAP) / (MIN_CARD + GAP)));
}

export function VideoGrid({ videos, onOpen }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [columns, setColumns] = useState<number>(1);

  useEffect(() => {
    const el = hostRef.current;
    if (!el) return;
    const update = () => setColumns(computeColumns(el.clientWidth));
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return (
    <div
      ref={hostRef}
      className="grid-host"
      style={{ '--grid-cols': columns } as React.CSSProperties}
    >
      <VirtuosoGrid
        data={videos}
        listClassName="grid-list"
        itemClassName="grid-item"
        components={{
          List: GridList,
          Item: GridItem,
          ScrollSeekPlaceholder: Placeholder
        }}
        computeItemKey={(_, v) => v.id}
        itemContent={(_, v) => <VideoCard video={v} onOpen={onOpen} />}
      />
    </div>
  );
}

const GridList = forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  function GridList({ children, style, ...props }, ref) {
    return (
      <div
        ref={ref}
        {...props}
        style={{
          display: 'grid',
          gridTemplateColumns:
            `repeat(var(--grid-cols, 1), minmax(${MIN_CARD}px, 1fr))`,
          gap: GAP,
          padding: 16,
          alignContent: 'start',
          ...style
        }}
      >
        {children}
      </div>
    );
  }
);

const GridItem = forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  function GridItem({ children, style, ...props }, ref) {
    return (
      <div ref={ref} {...props} style={style}>
        {children}
      </div>
    );
  }
);

function Placeholder({ height, width }: { height: number; width: number }) {
  return (
    <div
      className="card"
      style={{
        height,
        width,
        opacity: 0.25,
        background: 'var(--bg-elev)',
        border: '1px solid var(--border)',
        borderRadius: 10
      }}
    />
  );
}
