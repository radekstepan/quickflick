interface Props {
  hasLibrary: boolean;
  videoCount: number;
  onPick: () => void;
  onRescan: () => void;
}

export function EmptyState({ hasLibrary, videoCount, onPick, onRescan }: Props) {
  if (!hasLibrary) {
    return (
      <div className="empty">
        <div className="empty-icon">🎬</div>
        <div className="empty-title">Welcome to QuickFlick</div>
        <div className="empty-sub">
          Pick a folder of videos to build a local index. QuickFlick will cache
          metadata and generate hover-cycle thumbnails.
        </div>
        <button className="btn primary" onClick={onPick}>
          Pick a folder
        </button>
      </div>
    );
  }

  if (videoCount === 0) {
    return (
      <div className="empty">
        <div className="empty-icon">🔍</div>
        <div className="empty-title">No videos found</div>
        <div className="empty-sub">
          We didn't find any video files in that folder. Rescan to check again,
          or pick a different folder.
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn" onClick={onPick}>Pick different folder</button>
          <button className="btn primary" onClick={onRescan}>Rescan</button>
        </div>
      </div>
    );
  }

  return null;
}
