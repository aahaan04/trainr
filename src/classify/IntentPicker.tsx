/**
 * "Call before" mode (Section 6.1): pick the intended pitch type AND target location
 * before the pitch, so execution — how far the actual result landed from intent —
 * can be measured. Reads the live strike zone from appStore (there is no calibrated
 * zone until setup finishes; falls back to a height-derived approximate one) rather
 * than requiring the caller to plumb it through as a prop.
 */

import { useMemo } from 'react';
import { DEFAULT_BATTER_HEIGHT_M, PITCH_TYPES, ZONE_RULES, zoneFromHeight, type PitchTypeId } from '@/domain/constants';
import { useAppStore } from '@/store/appStore';
import type { IntendedPitch } from '@/domain/types';

export interface IntentPickerProps {
  value: IntendedPitch | null;
  onChange: (intent: IntendedPitch) => void;
  className?: string;
}

const GRID = ZONE_RULES.HEATMAP_DIVISIONS;

export function IntentPicker({ value, onChange, className = '' }: IntentPickerProps) {
  const zone = useAppStore((s) => s.zone);

  const bounds = useMemo(() => {
    if (zone) return { bottomM: zone.bottomM, topM: zone.topM, halfWidthM: zone.halfWidthM, approximate: zone.approximate };
    const fallback = zoneFromHeight(DEFAULT_BATTER_HEIGHT_M, 'ncaa');
    return { bottomM: fallback.bottomM, topM: fallback.topM, halfWidthM: 0.2159, approximate: true };
  }, [zone]);

  const shadow = ZONE_RULES.SHADOW_ZONE_M;
  const xMin = -(bounds.halfWidthM + shadow);
  const xMax = bounds.halfWidthM + shadow;
  const yMin = bounds.bottomM - shadow;
  const yMax = bounds.topM + shadow;
  const cellW = (xMax - xMin) / GRID;
  const cellH = (yMax - yMin) / GRID;

  const selectedType = value?.type ?? null;

  const pickType = (type: PitchTypeId) => {
    onChange({ type, target: value?.target ?? { x: 0, y: (bounds.bottomM + bounds.topM) / 2 } });
  };

  const pickCell = (row: number, col: number) => {
    const x = xMin + (col + 0.5) * cellW;
    const y = yMax - (row + 0.5) * cellH;
    onChange({ type: selectedType ?? 'fastball', target: { x, y } });
  };

  const px = 220;
  const py = 260;
  const sx = (v: number) => ((v - xMin) / (xMax - xMin)) * px;
  const sy = (v: number) => (1 - (v - yMin) / (yMax - yMin)) * py;

  return (
    <div className={`flex flex-col gap-3 ${className}`}>
      <div className="flex flex-wrap gap-2">
        {PITCH_TYPES.filter((t) => t.id !== 'custom').map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => pickType(t.id)}
            aria-pressed={selectedType === t.id}
            className={[
              'min-h-tap min-w-tap rounded-pill border-2 px-4 text-body font-medium transition-colors duration-hover ease-brand',
              selectedType === t.id
                ? 'border-indigo-600 bg-indigo-600 text-white'
                : 'border-indigo-600 bg-transparent text-indigo-600 hover:bg-indigo-100',
            ].join(' ')}
          >
            {t.short}
          </button>
        ))}
      </div>

      <div className="flex flex-col gap-1">
        <span className="text-label uppercase text-ink-tertiary">Target</span>
        <svg viewBox={`0 0 ${px} ${py}`} width={px} height={py} role="img" aria-label="Tap a target location">
          {Array.from({ length: GRID }, (_, row) =>
            Array.from({ length: GRID }, (_, col) => {
              const cellX = xMin + col * cellW;
              const cellYTop = yMax - row * cellH;
              const centerX = cellX + cellW / 2;
              const centerY = cellYTop - cellH / 2;
              const isSelected =
                value && Math.abs(value.target.x - centerX) < cellW / 2 && Math.abs(value.target.y - centerY) < cellH / 2;
              return (
                <rect
                  key={`${row}-${col}`}
                  x={sx(cellX)}
                  y={sy(cellYTop)}
                  width={sx(cellX + cellW) - sx(cellX)}
                  height={sy(cellYTop - cellH) - sy(cellYTop)}
                  className={isSelected ? 'fill-indigo-600' : 'fill-surface-2 hover:fill-indigo-100'}
                  stroke="var(--surface-1)"
                  strokeWidth={1}
                  onClick={() => pickCell(row, col)}
                  style={{ cursor: 'pointer' }}
                />
              );
            }),
          )}
          <rect
            x={sx(-bounds.halfWidthM)}
            y={sy(bounds.topM)}
            width={sx(bounds.halfWidthM) - sx(-bounds.halfWidthM)}
            height={sy(bounds.bottomM) - sy(bounds.topM)}
            fill="none"
            stroke="var(--indigo-700)"
            strokeWidth={2}
            pointerEvents="none"
          />
        </svg>
        {bounds.approximate && (
          <span className="text-caption text-ink-tertiary">Approximate zone — no batter in frame yet.</span>
        )}
      </div>
    </div>
  );
}
