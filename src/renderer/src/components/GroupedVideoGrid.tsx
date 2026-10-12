import { memo, useEffect, useRef, useState } from 'react';
import { VideoCard } from './VideoCard';
import type { PendingVideoEdit } from '../hooks/useLibrary';
import type { Tag } from '../utils/tags';
import type { OpenResult, VideoWithThumbs } from '@shared/types';

export interface VideoGroup {
  tag: string | null;
  videos: VideoWithThumbs[];
}

interface Props {
  groups: VideoGroup[];
  roots: string[];
  matchTags: Tag[];
  removedTagNames: ReadonlySet<string>;
  pendingEdits: ReadonlyMap<number, PendingVideoEdit>;
  tagNames: string[];
  onOpen: (id: number) => Promise<OpenResult>;
  onOpened?: (result: OpenResult) => void;
  getViewCount: (id: number, fallback: number) => number;
  onAddTag: (id: number, name: string) => void;
  onRemoveTag: (id: number, name: string) => void;
  resetScrollKey: string;
}

const PADDING_X = 32;
const GAP = 14;
const MIN_CARD = 240;

function computeColumns(width: number): number {
  if (width <= 0) return 1;
  return Math.max(1, Math.floor((width - PADDING_X + GAP) / (MIN_CARD + GAP)));
}

export function GroupedVideoGridInner({
  groups,
  roots,
  matchTags,
  removedTagNames,
  pendingEdits,
  tagNames,
  onOpen,
  onOpened,
  getViewCount,
  onAddTag,
  onRemoveTag,
  resetScrollKey
}: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [columns, setColumns] = useState<number>(1);

  useEffect(() => {
    hostRef.current?.scrollTo({ top: 0 });
  }, [resetScrollKey]);

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
      className="group-host"
      style={{ '--grid-cols': columns } as React.CSSProperties}
    >
      {groups.map((g) => (
        <section key={g.tag ?? '__untagged__'} className="group-section">
          <header className="group-header">
            <span className="group-header-name">{g.tag ?? 'Untagged'}</span>
            <span className="group-header-count">{g.videos.length}</span>
          </header>
          <div className="group-grid">
            {g.videos.map((v) => (
              <VideoCard
                key={v.id}
                video={v}
                roots={roots}
                matchTags={matchTags}
                removedTagNames={removedTagNames}
                pending={pendingEdits.get(v.id)}
                tagNames={tagNames}
                onOpen={onOpen}
                onOpened={onOpened}
                onAddTag={onAddTag}
                onRemoveTag={onRemoveTag}
              />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

// Props are transition-stable across delete clicks (groups/base refs
// unchanged on the urgent frame), so unrelated App renders — scan
// progress ticks, search keystrokes elsewhere — skip the whole grid.
export const GroupedVideoGrid = memo(GroupedVideoGridInner);
