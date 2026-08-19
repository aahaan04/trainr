/**
 * Controls for the "play sample pitch" demo: preset picker (fastball/drop/changeup,
 * chosen so the break SHAPE differs, not just speed), play/replay, a slow-motion
 * toggle, and the resulting call rendered in the app's real STRIKE/BALL chip
 * styling (src/design/tokens.ts callColor) once the ball reaches the plate.
 */

import { callColor } from '@/design/tokens';
import { SAMPLE_PITCH_PRESETS, type SamplePitchId } from './geometry';

interface SamplePitchPlayerProps {
  presetId: SamplePitchId;
  onPresetChange: (id: SamplePitchId) => void;
  playing: boolean;
  onPlay: () => void;
  finished: boolean;
  slowMotion: boolean;
  onSlowMotionChange: (v: boolean) => void;
}

export function SamplePitchPlayer({
  presetId,
  onPresetChange,
  playing,
  onPlay,
  finished,
  slowMotion,
  onSlowMotionChange,
}: SamplePitchPlayerProps) {
  const preset = SAMPLE_PITCH_PRESETS.find((p) => p.id === presetId) ?? SAMPLE_PITCH_PRESETS[0];
  const call = preset.isStrike ? callColor.strike : callColor.ball;

  return (
    <div className="space-y-3">
      <p className="text-label text-ink-secondary">Sample pitch</p>

      <div role="group" aria-label="Pitch type" className="flex flex-wrap gap-2">
        {SAMPLE_PITCH_PRESETS.map((p) => (
          <button
            key={p.id}
            type="button"
            aria-pressed={p.id === presetId}
            onClick={() => onPresetChange(p.id)}
            className={`min-h-tap rounded-pill border px-3 text-body transition-colors duration-hover ${
              p.id === presetId
                ? 'border-indigo-600 bg-indigo-100 text-indigo-700'
                : 'border-border bg-surface-1 text-ink hover:bg-surface-2'
            }`}
          >
            {p.label}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={onPlay}
          className="min-h-tap rounded-pill bg-indigo-600 px-5 text-body font-semibold text-white transition-colors duration-hover hover:bg-indigo-700"
        >
          {playing ? 'Replay' : 'Play sample pitch'}
        </button>

        <label className="flex min-h-tap items-center gap-2 text-body text-ink">
          <input
            type="checkbox"
            checked={slowMotion}
            onChange={(e) => onSlowMotionChange(e.target.checked)}
            className="h-4 w-4 accent-indigo-600"
          />
          Slow motion
        </label>

        <span aria-live="polite" className="min-h-tap">
          {finished && (
            <span
              className="inline-flex min-h-tap items-center rounded-pill px-4 text-body font-semibold"
              style={{ backgroundColor: call.fill, color: call.ink }}
            >
              {preset.isStrike ? 'STRIKE' : 'BALL'}
            </span>
          )}
        </span>
      </div>
    </div>
  );
}
