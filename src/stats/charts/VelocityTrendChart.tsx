/**
 * Velocity trend within a session (Section 7 + 8.6): speed against pitch number, so
 * fatigue reads directly off the shape of the line. Reuses <TrajectoryRibbon/> per
 * Section 8.6 rather than a hand-rolled line, so this chart carries the app's motif
 * instead of inventing a second one.
 */

import { useMemo } from 'react';
import { toMph } from '@/domain/units';
import { color } from '@/design/tokens';
import { TrajectoryRibbon } from '@/diagram/TrajectoryRibbon';
import type { FatigueResult, VelocityPoint } from '../aggregate';
import { Marker } from './Marker';

export interface VelocityTrendChartProps {
  points: readonly VelocityPoint[];
  fatigue: FatigueResult;
  width?: number;
  height?: number;
}

const PADDING = { left: 40, right: 16, top: 20, bottom: 28 };

export function VelocityTrendChart({ points, fatigue, width = 560, height = 240 }: VelocityTrendChartProps) {
  const mphPoints = useMemo(() => points.map((p) => ({ ...p, mph: toMph(p.speedMps) })), [points]);

  const plotW = width - PADDING.left - PADDING.right;
  const plotH = height - PADDING.top - PADDING.bottom;

  const minMph = Math.min(...mphPoints.map((p) => p.mph), fatigue.peakMps ? toMph(fatigue.peakMps) - 10 : 0) - 2;
  const maxMph = Math.max(...mphPoints.map((p) => p.mph), toMph(fatigue.peakMps)) + 2;
  const n = Math.max(1, mphPoints.length - 1);

  const sx = (i: number) => PADDING.left + (i / n) * plotW;
  const sy = (v: number) => PADDING.top + (1 - (v - minMph) / (maxMph - minMph || 1)) * plotH;

  const ribbonPoints = mphPoints.map((p, i) => ({ x: sx(i), y: sy(p.mph) }));
  const ticks = 4;
  const tickValues = Array.from({ length: ticks + 1 }, (_, i) => minMph + ((maxMph - minMph) * i) / ticks);

  const fatigueWindowX =
    fatigue.flagged && fatigue.windowStartSequence !== null
      ? mphPoints.findIndex((p) => p.sequence === fatigue.windowStartSequence)
      : -1;

  if (mphPoints.length === 0) {
    return <p className="text-caption text-ink-tertiary">No pitches yet this session.</p>;
  }

  return (
    <div className="flex flex-col gap-1">
      <svg viewBox={`0 0 ${width} ${height}`} width="100%" role="img" aria-label="Velocity by pitch number">
        {tickValues.map((t) => (
          <g key={t}>
            <line x1={PADDING.left} y1={sy(t)} x2={width - PADDING.right} y2={sy(t)} stroke={color.border} strokeWidth={1} />
            <text x={PADDING.left - 6} y={sy(t) + 3} textAnchor="end" className="num" fontSize={10} fill={color.textTertiary}>
              {t.toFixed(0)}
            </text>
          </g>
        ))}

        {fatigueWindowX >= 0 && (
          <rect
            x={sx(fatigueWindowX)}
            y={PADDING.top}
            width={Math.max(2, plotW - sx(fatigueWindowX) + PADDING.left)}
            height={plotH}
            fill={color.amber100}
            opacity={0.6}
          />
        )}

        <TrajectoryRibbon points={ribbonPoints} minWidthPx={2} maxWidthPx={5} glow={false} showLeadingDot={false} />

        {mphPoints.map((p, i) => (
          <Marker key={p.sequence} typeId={p.type} cx={sx(i)} cy={sy(p.mph)} r={3.5} opacity={0.9} />
        ))}

        <text x={width - PADDING.right} y={PADDING.top - 6} textAnchor="end" fontSize={11} fill={color.textSecondary}>
          Peak {toMph(fatigue.peakMps).toFixed(0)} mph
        </text>
      </svg>
      {fatigue.flagged && fatigue.dropMps !== null && (
        <p className="text-caption font-medium text-amber-600">
          Velocity dropped {toMph(fatigue.dropMps).toFixed(1)} mph off the session peak starting at pitch #
          {fatigue.windowStartSequence} — possible fatigue.
        </p>
      )}
    </div>
  );
}
