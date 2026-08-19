/**
 * Cross-session trend line (Section 7): one metric (velocity or command) plotted
 * across real elapsed time so week-to-week and month-to-month gaps read correctly,
 * not as equal-width steps. Reuses <TrajectoryRibbon/> per Section 8.6.
 */

import { useMemo } from 'react';
import { color } from '@/design/tokens';
import { TrajectoryRibbon } from '@/diagram/TrajectoryRibbon';

export interface TrendSeriesPoint {
  t: number;
  value: number;
  label: string;
}

export interface CrossSessionTrendChartProps {
  points: readonly TrendSeriesPoint[];
  valueFormat: (v: number) => string;
  width?: number;
  height?: number;
}

const PADDING = { left: 48, right: 16, top: 16, bottom: 24 };

export function CrossSessionTrendChart({ points, valueFormat, width = 560, height = 180 }: CrossSessionTrendChartProps) {
  const plotW = width - PADDING.left - PADDING.right;
  const plotH = height - PADDING.top - PADDING.bottom;

  const { sx, sy, ticks } = useMemo(() => {
    const ts = points.map((p) => p.t);
    const values = points.map((p) => p.value);
    const tMin = Math.min(...ts);
    const tMax = Math.max(...ts);
    const vMin = Math.min(...values);
    const vMax = Math.max(...values);
    const vPad = (vMax - vMin || 1) * 0.15;
    const lo = vMin - vPad;
    const hi = vMax + vPad;
    const sxFn = (t: number) => PADDING.left + ((t - tMin) / (tMax - tMin || 1)) * plotW;
    const syFn = (v: number) => PADDING.top + (1 - (v - lo) / (hi - lo || 1)) * plotH;
    const tickCount = 3;
    const tickVals = Array.from({ length: tickCount + 1 }, (_, i) => lo + ((hi - lo) * i) / tickCount);
    return { sx: sxFn, sy: syFn, ticks: tickVals };
  }, [points, plotW, plotH]);

  if (points.length === 0) {
    return <p className="text-caption text-ink-tertiary">Not enough sessions yet.</p>;
  }

  const ribbonPoints = points.map((p) => ({ x: sx(p.t), y: sy(p.value) }));

  return (
    <svg viewBox={`0 0 ${width} ${height}`} width="100%" role="img" aria-label="Trend over sessions">
      {ticks.map((t) => (
        <g key={t}>
          <line x1={PADDING.left} y1={sy(t)} x2={width - PADDING.right} y2={sy(t)} stroke={color.border} strokeWidth={1} />
          <text x={PADDING.left - 6} y={sy(t) + 3} textAnchor="end" className="num" fontSize={10} fill={color.textTertiary}>
            {valueFormat(t)}
          </text>
        </g>
      ))}
      {points.length >= 2 ? (
        <TrajectoryRibbon points={ribbonPoints} minWidthPx={2} maxWidthPx={5} glow={false} showLeadingDot={false} />
      ) : (
        <circle cx={ribbonPoints[0].x} cy={ribbonPoints[0].y} r={4} fill={color.indigo600} />
      )}
      {points.map((p, i) => (
        <circle key={p.t} cx={sx(p.t)} cy={sy(p.value)} r={3} fill={color.indigo900} opacity={i === points.length - 1 ? 1 : 0.6} />
      ))}
      <text x={width - PADDING.right} y={PADDING.top + 10} textAnchor="end" fontSize={11} fill={color.textSecondary}>
        {valueFormat(points[points.length - 1].value)}
      </text>
    </svg>
  );
}
