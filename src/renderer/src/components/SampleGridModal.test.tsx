import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { SampleGridModal } from './SampleGridModal';
import type { VideoScene } from '@shared/types';
import type { CycleFrame } from '../utils/cycleFrames';

afterEach(() => {
  cleanup();
});

function thumb(
  id: number,
  timeOffset: number,
  kind: 'interval' | 'scene' = 'interval',
  indexInKind = id
): CycleFrame {
  return {
    thumbnail: {
      id,
      video_id: 1,
      frame_index: id,
      time_offset: timeOffset,
      file_path: `/thumbs/${id}.jpg`,
      kind
    },
    isScene: kind === 'scene',
    timeSec: timeOffset,
    indexInKind
  };
}

function scene(partial: Partial<VideoScene> & Pick<VideoScene, 'start_time_sec' | 'end_time_sec'>): VideoScene {
  return { id: 0, video_id: 1, scene_index: 1, ...partial };
}

describe('SampleGridModal', () => {
  it('renders 8 cells with timestamps and labels', () => {
    const cycleFrames: CycleFrame[] = [
      thumb(1, 0, 'interval'),
      thumb(2, 100, 'scene', 1),
      thumb(3, 200, 'interval'),
      thumb(4, 300, 'interval'),
      thumb(5, 400, 'interval'),
      thumb(6, 500, 'interval'),
      thumb(7, 600, 'interval'),
      thumb(8, 700, 'interval')
    ];
    const scenes: VideoScene[] = [
      scene({ id: 1, scene_index: 1, start_time_sec: 90, end_time_sec: 110 })
    ];
    render(
      <SampleGridModal
        videoName="test.mp4"
        durationSec={800}
        cycleFrames={cycleFrames}
        scenes={scenes}
        onClose={() => {}}
      />
    );
    expect(screen.getAllByRole('listitem')).toHaveLength(8);
    expect(screen.getByText('1:40')).toBeTruthy();
    expect(screen.getAllByText(/Int \d+\/8/).length).toBeGreaterThan(0);
    expect(screen.getByText('Scene 1/1')).toBeTruthy();
  });

  it('calls onClose when the close button is clicked', () => {
    const onClose = vi.fn();
    render(
      <SampleGridModal
        videoName="a.mp4"
        durationSec={0}
        cycleFrames={[]}
        scenes={[]}
        onClose={onClose}
      />
    );
    fireEvent.click(screen.getByLabelText('Close'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('calls onClose when the backdrop is clicked', () => {
    const onClose = vi.fn();
    const { container } = render(
      <SampleGridModal
        videoName="a.mp4"
        durationSec={0}
        cycleFrames={[]}
        scenes={[]}
        onClose={onClose}
      />
    );
    const backdrop = container.querySelector('.sample-modal-backdrop')!;
    fireEvent.click(backdrop);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('does not close when the modal body is clicked', () => {
    const onClose = vi.fn();
    const { container } = render(
      <SampleGridModal
        videoName="a.mp4"
        durationSec={0}
        cycleFrames={[]}
        scenes={[]}
        onClose={onClose}
      />
    );
    const modal = container.querySelector('.sample-modal')!;
    fireEvent.click(modal);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('calls onClose when Escape is pressed', () => {
    const onClose = vi.fn();
    render(
      <SampleGridModal
        videoName="a.mp4"
        durationSec={0}
        cycleFrames={[]}
        scenes={[]}
        onClose={onClose}
      />
    );
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('renders the scene timeline when scenes are provided', () => {
    const scenes: VideoScene[] = [
      scene({ id: 1, scene_index: 1, start_time_sec: 0, end_time_sec: 100 }),
      scene({ id: 2, scene_index: 2, start_time_sec: 200, end_time_sec: 350 }),
      scene({ id: 3, scene_index: 3, start_time_sec: 500, end_time_sec: 800 })
    ];
    const { container } = render(
      <SampleGridModal
        videoName="a.mp4"
        durationSec={800}
        cycleFrames={[]}
        scenes={scenes}
        onClose={() => {}}
      />
    );
    const segments = container.querySelectorAll('.sample-timeline-segment');
    expect(segments).toHaveLength(3);
    expect(screen.getByText(/3 scenes · 13:20/)).toBeTruthy();
  });

  it('shows the empty-state message when no scenes are provided', () => {
    render(
      <SampleGridModal
        videoName="a.mp4"
        durationSec={500}
        cycleFrames={[]}
        scenes={[]}
        onClose={() => {}}
      />
    );
    expect(screen.getByText(/No scenes detected/)).toBeTruthy();
  });

  it('uses singular scene wording for exactly 1 scene', () => {
    const scenes: VideoScene[] = [scene({ start_time_sec: 0, end_time_sec: 60 })];
    render(
      <SampleGridModal
        videoName="a.mp4"
        durationSec={60}
        cycleFrames={[]}
        scenes={scenes}
        onClose={() => {}}
      />
    );
    expect(screen.getByText(/1 scene · 1:00/)).toBeTruthy();
  });
});
