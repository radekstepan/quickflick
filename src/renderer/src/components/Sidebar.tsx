import { useMemo } from 'react';
import type { VideoWithThumbs } from '@shared/types';

interface FolderNode {
  name: string;
  path: string;
  count: number;
  children: FolderNode[];
}

function buildTree(folders: string[], counts: Map<string, number>): FolderNode[] {
  const rootMap = new Map<string, FolderNode>();

  // We need a virtual root that aggregates everything.
  // Sort folders so parents come before children.
  const sorted = [...folders].sort();

  for (const folder of sorted) {
    const parts = folder.split('/').filter(Boolean);
    let parentChildren = rootMap;
    let acc = '';
    for (let i = 0; i < parts.length; i++) {
      acc = acc ? `${acc}/${parts[i]}` : parts[i];
      let node = parentChildren.get(parts[i]);
      if (!node) {
        node = { name: parts[i], path: acc, count: 0, children: [] };
        parentChildren.set(parts[i], node);
      }
      // Increment count at the deepest level (this exact folder)
      if (i === parts.length - 1) {
        node.count = counts.get(folder) ?? 0;
      }
      parentChildren = new Map(node.children.map((c) => [c.name, c]));
    }
  }

  // Recursively aggregate counts from children up
  function aggregate(n: FolderNode): number {
    let total = n.count;
    for (const c of n.children) total += aggregate(c);
    n.count = total;
    return total;
  }

  for (const node of rootMap.values()) aggregate(node);
  return Array.from(rootMap.values());
}

interface Props {
  videos: VideoWithThumbs[];
  selected: string | null;
  onSelect: (folder: string | null) => void;
  rootPath: string | null;
}

export function Sidebar({ videos, selected, onSelect, rootPath }: Props) {
  const { tree, rootCount, folders } = useMemo(() => {
    const set = new Set<string>();
    const counts = new Map<string, number>();
    for (const v of videos) {
      set.add(v.folder);
      counts.set(v.folder, (counts.get(v.folder) ?? 0) + 1);
    }
    const tree = buildTree([...set], counts);
    const rootCount = videos.length;
    return { tree, rootCount, folders: [...set] };
  }, [videos]);

  const renderNode = (n: FolderNode, depth: number) => {
    const isActive = selected === n.path;
    return (
      <div key={n.path}>
        <div
          className={`sidebar-item ${isActive ? 'active' : ''}`}
          style={{ paddingLeft: 12 + depth * 14 }}
          onClick={() => onSelect(n.path)}
          title={n.path}
        >
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{n.name}</span>
          <span className="count">{n.count}</span>
        </div>
        {n.children.map((c) => renderNode(c, depth + 1))}
      </div>
    );
  };

  return (
    <div className="sidebar">
      <div className="sidebar-section">Library</div>
      <div
        className={`sidebar-item ${selected === null ? 'active' : ''}`}
        onClick={() => onSelect(null)}
        title={rootPath ?? ''}
      >
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {rootPath ? rootPath.split('/').pop() || rootPath : 'All videos'}
        </span>
        <span className="count">{rootCount}</span>
      </div>

      {folders.length > 0 ? (
        <>
          <div className="sidebar-section" style={{ marginTop: 12 }}>
            Folders
          </div>
          {tree.map((n) => renderNode(n, 0))}
        </>
      ) : null}
    </div>
  );
}
