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
        <div className="empty-icon" aria-hidden="true">
          <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="2" y="6" width="14" height="12" rx="2" />
            <path d="M2 10h14" />
            <path d="M16 9l5-3v12l-5-3z" />
          </svg>
        </div>
        <div className="empty-title">Welcome to QuickFlick</div>
        <div className="empty-sub">
          Pick a folder of videos to build a local index. QuickFlick will cache
          metadata and generate hover-cycle thumbnails.
        </div>
        <button className="btn primary" onClick={onPick}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M12 5v14M5 12h14" />
          </svg>
          Pick a folder
        </button>
      </div>
    );
  }

  if (videoCount === 0) {
    return (
      <div className="empty">
        <div className="empty-icon" aria-hidden="true">
          <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="7" />
            <path d="M21 21l-4.3-4.3" />
            <path d="M8 11h6" />
          </svg>
        </div>
        <div className="empty-title">No videos found</div>
        <div className="empty-sub">
          We didn't find any video files in that folder. Rescan to check again,
          or pick a different folder.
        </div>
        <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
          <button className="btn" onClick={onPick}>Pick different folder</button>
          <button className="btn primary" onClick={onRescan}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M21 12a9 9 0 1 1-3-6.7" />
              <path d="M21 4v5h-5" />
            </svg>
            Rescan
          </button>
        </div>
      </div>
    );
  }

  return null;
}
