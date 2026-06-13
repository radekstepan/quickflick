import type { FfmpegStatus } from '@shared/types';

interface Props {
  status: FfmpegStatus;
  onDismiss: () => void;
}

export function FfmpegMissing({ status, onDismiss }: Props) {
  return (
    <div className="modal-backdrop" onClick={onDismiss}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>ffmpeg not found</h2>
        <p>
          QuickFlick needs <code>ffmpeg</code> and <code>ffprobe</code> on your
          PATH to generate thumbnails.
        </p>
        <p>Install with Homebrew:</p>
        <p>
          <code>{status.installHint ?? 'brew install ffmpeg'}</code>
        </p>
        <p>
          After installing, click the button below to re-check.
        </p>
        <div className="modal-actions">
          <button className="btn" onClick={onDismiss}>
            Dismiss
          </button>
          <ReloadButton />
        </div>
      </div>
    </div>
  );
}

function ReloadButton() {
  return (
    <button className="btn primary" onClick={() => window.location.reload()}>
      Re-check
    </button>
  );
}
