/**
 * Zone heat map (Section 7): the 5x5 grid over the zone plus its shadow ring.
 * Density is encoded as indigo fill opacity (not a strike/ball colour — cells mix
 * makes and misses, so green/coral would misleadingly read as a call). Strike rate
 * is a direct numeric label per cell instead of a second colour channel or legend.
 */

import type { StrikeZone } from '@/domain/types';
import { toInches } from '@/domain/units';
import { color } from '@/design/tokens';
import type { HeatMapCell } from '../aggregate';

export interface ZoneHeatMapChartProps {
  cells: readonly HeatMapCell[];
  zone: StrikeZone;
  width?: number;
  height?: number;
}

export function ZoneHeatMapChart({ cells, zone, width = 320, height = 380 }: ZoneHeatMapChartProps) {
  if (cells.length === 0) return null;
  const xMin = Math.min(...cells.map((c) => c.xMinM));
  const xMax = Math.max(...cells.map((c) => c.xMaxM));
  const yMin = Math.min(...cells.map((c) => c.yMinM));
  const yMax = Math.max(...cells.map((c) => c.yMaxM));

  const sx = (v: number) => ((v - xMin) / (xMax - xMin)) * width;
  const sy = (v: number) => (1 - (v - yMin) / (yMax - yMin)) * height;

  const maxCount = Math.max(1, ...cells.map((c) => c.count));

  return (
    <div className="flex flex-col gap-1">
      <svg viewBox={`0 0 ${width} ${height}`} width="100%" role="img" aria-label="Pitch location heat map">
        {cells.map((cell) => {
          const x = sx(cell.xMinM);
          const y = sy(cell.yMaxM);
          const w = sx(cell.xMaxM) - sx(cell.xMinM);
          const h = sy(cell.yMinM) - sy(cell.yMaxM);
          const density = cell.count / maxCount;
          return (
            <g key={`${cell.row}-${cell.col}`}>
              <rect
                x={x}
                y={y}
                width={w}
                height={h}
                fill={color.indigo600}
                opacity={cell.count > 0 ? 0.12 + 0.68 * density : 0.03}
                stroke={color.surface1}
                strokeWidth={1}
              />
              {cell.count > 0 && (
                <text
                  x={x + w / 2}
                  y={y + h / 2 + 4}
                  textAnchor="middle"
                  className="num"
                  fontSize={12}
                  fontWeight={600}
                  fill={density > 0.5 ? color.surface1 : color.textPrimary}
                >
                  {(cell.strikeRate * 100).toFixed(0)}%
                </text>
              )}
            </g>
          );
        })}

        {/* The true rulebook zone, so the shadow ring around it reads as context, not the zone itself. */}
        <rect
          x={sx(-zone.halfWidthM)}
          y={sy(zone.topM)}
          width={sx(zone.halfWidthM) - sx(-zone.halfWidthM)}
          height={sy(zone.bottomM) - sy(zone.topM)}
          fill="none"
          stroke={color.indigo700}
          strokeWidth={2}
        />
      </svg>
      <p className="text-caption text-ink-tertiary">
        {toInches(zone.topM - zone.bottomM).toFixed(0)} in zone height{zone.approximate ? ' (approximate zone)' : ''} —
        numbers are strike rate per cell.
      </p>
    </div>
  );
}
