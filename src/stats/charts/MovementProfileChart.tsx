/**
 * Movement profile (Section 7 + 8.7): horizontal break vs vertical break, coloured
 * and shaped by pitch type. The single most useful visual in the app, so it gets
 * direct labels at each cluster's centroid instead of a legend, an origin cross
 * instead of a gridline lattice, and an explicit "approximate" caveat whenever any
 * contributing pitch used single-camera break estimates (Section 16).
 */

import { useMemo } from 'react';
import { PITCH_TYPE_LABEL } from '@/domain/constants';
import { toInches } from '@/domain/units';
import type { PitchTypeId } from '@/domain/types';
import type { MovementPoint } from '../aggregate';
import { Marker } from './Marker';
import { color } from '@/design/tokens';

export interface MovementProfileChartProps {
  points: readonly MovementPoint[];
  width?: number;
  height?: number;
}

const PADDING = 40;

export function MovementProfileChart({ points, width = 480, height = 420 }: MovementProfileChartProps) {
  const inchPoints = useMemo(
    () =>
      points.map((p) => ({
        ...p,
        hIn: toInches(p.horizontalBreakM),
        vIn: toInches(p.verticalBreakM),
      })),
    [points],
  );

  const extent = useMemo(() => {
    const maxAbs = inchPoints.reduce((m, p) => Math.max(m, Math.abs(p.hIn), Math.abs(p.vIn)), 6);
    return Math.ceil(maxAbs / 2) * 2 + 2;
  }, [inchPoints]);

  const plotW = width - PADDING * 2;
  const plotH = height - PADDING * 2;
  const sx = (v: number) => PADDING + ((v + extent) / (2 * extent)) * plotW;
  // Screen y grows downward; "up" (positive vertical break / less drop) draws higher.
  const sy = (v: number) => PADDING + ((extent - v) / (2 * extent)) * plotH;

  const centroids = useMemo(() => {
    const byType = new Map<PitchTypeId, { sumH: number; sumV: number; n: number }>();
    for (const p of inchPoints) {
      if (!p.type) continue;
      const acc = byType.get(p.type) ?? { sumH: 0, sumV: 0, n: 0 };
      acc.sumH += p.hIn;
      acc.sumV += p.vIn;
      acc.n += 1;
      byType.set(p.type, acc);
    }
    return [...byType.entries()].map(([type, acc]) => ({
      type,
      hIn: acc.sumH / acc.n,
      vIn: acc.sumV / acc.n,
      n: acc.n,
    }));
  }, [inchPoints]);

  const anyApproximate = points.some((p) => p.breakIsApproximate);
  const ticks = [-extent, -extent / 2, 0, extent / 2, extent];

  return (
    <div className="flex flex-col gap-1">
      <svg viewBox={`0 0 ${width} ${height}`} width="100%" role="img" aria-label="Movement profile: horizontal vs vertical break">
        {/* Origin cross stands in for gridlines: "no break" is the only reference a coach needs. */}
        <line x1={sx(-extent)} y1={sy(0)} x2={sx(extent)} y2={sy(0)} stroke={color.border} strokeWidth={1} />
        <line x1={sx(0)} y1={sy(-extent)} x2={sx(0)} y2={sy(extent)} stroke={color.border} strokeWidth={1} />

        {ticks.map((t) => (
          <text key={`x${t}`} x={sx(t)} y={sy(0) + 14} textAnchor="middle" className="num" fontSize={10} fill={color.textTertiary}>
            {t.toFixed(0)}
          </text>
        ))}
        {ticks
          .filter((t) => t !== 0)
          .map((t) => (
            <text key={`y${t}`} x={sx(0) - 8} y={sy(t) + 3} textAnchor="end" className="num" fontSize={10} fill={color.textTertiary}>
              {t.toFixed(0)}
            </text>
          ))}

        <text x={width - PADDING} y={sy(0) - 8} textAnchor="end" fontSize={11} fill={color.textSecondary}>
          glove side &#8594;
        </text>
        <text x={PADDING} y={sy(0) - 8} textAnchor="start" fontSize={11} fill={color.textSecondary}>
          &#8592; arm side
        </text>
        <text x={sx(0) + 6} y={PADDING - 8} textAnchor="start" fontSize={11} fill={color.textSecondary}>
          less drop / rise
        </text>

        {inchPoints.map((p) => (
          <Marker key={p.pitchId} typeId={p.type} cx={sx(p.hIn)} cy={sy(p.vIn)} r={4.5} opacity={0.55} />
        ))}

        {centroids.map((c) => (
          <text
            key={c.type}
            x={sx(c.hIn)}
            y={sy(c.vIn) - 10}
            textAnchor="middle"
            fontSize={12}
            fontWeight={600}
            fill={color.textPrimary}
          >
            {PITCH_TYPE_LABEL[c.type]}
          </text>
        ))}
      </svg>
      <p className="text-caption text-ink-tertiary">
        Break in inches, relative to a straight line from release (horizontal) and a gravity-only fall (vertical).
        {anyApproximate && ' Values marked here include approximate single-camera break estimates.'}
      </p>
    </div>
  );
}
