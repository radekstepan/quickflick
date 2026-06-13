import { forwardRef } from 'react';
import { VirtuosoGrid } from 'react-virtuoso';
import { VideoCard } from './VideoCard';
import type { VideoWithThumbs } from '@shared/types';

interface Props {
  videos: VideoWithThumbs[];
  onOpen: (id: number) => Promise<void>;
}

export function VideoGrid({ videos, onOpen }: Props) {
  return (
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
          gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))',
          gap: 14,
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
      <div ref={ref} {...props} style={{ display: 'flex', ...style }}>
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
