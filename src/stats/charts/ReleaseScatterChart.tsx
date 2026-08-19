/**
 * Release point consistency (Section 7): a scatter of release coordinates by pitch
 * type. Tight clustering across types is itself the finding — a pitcher who releases
 * every pitch from the same slot is not tipping type by arm slot, and the copy says
 * so plainly rather than leaving the coach to infer it from a chart.
 */

import { useMemo } from 'react';
import { toInches } from '@/domain/units';
import { color } from '@/design/tokens';
import type { ReleaseConsistency, ReleasePoint } from '../aggregate';
import { Marker } from './Marker';

export interface ReleaseScatterChartProps {
  points: readonly ReleasePoint[];
  width?: number;
  height?: number;
}

const PADDING = 36;

export function ReleaseScatterChart({ points, width = 420, height = 300 }: ReleaseScatterChartProps) {
  const inchPoints = useMemo(() => points.map((p) => ({ ...p, xIn: toInches(p.xM), yIn: toInches(p.yM) })), [points]);

  const xExtent = useMemo(() => Math.max(4, ...inchPoints.map((p) => Math.abs(p.xIn))) + 1, [inchPoints]);
  const yMin = Math.min(0, ...inchPoints.map((p) => p.yIn)) - 1;
  const yMax = Math.max(1, ...inchPoints.map((p) => p.yIn)) + 1;

  const plotW = width - PADDING * 2;
  const plotH = height - PADDING * 2;
  const sx = (v: number) => PADDING + ((v + xExtent) / (2 * xExtent)) * plotW;
  const sy = (v: number) => PADDING + (1 - (v - yMin) / (yMax - yMin || 1)) * plotH;

  if (inchPoints.length === 0) {
    return <p className="text-caption text-ink-tertiary">No pitches yet this session.</p>;
  }

  return (
    <svg viewBox={`0 0 ${width} ${height}`} width="100%" role="img" aria-label="Release point by pitch type">
      <line x1={PADDING} y1={sy(0)} x2={width - PADDING} y2={sy(0)} stroke={color.border} strokeWidth={1} />
      <text x={width - PADDING} y={sy(0) + 14} textAnchor="end" fontSize={10} fill={color.textTertiary}>
        ground
      </text>
      {inchPoints.map((p) => (
        <Marker key={p.pitchId} typeId={p.type} cx={sx(p.xIn)} cy={sy(p.yIn)} r={5} opacity={0.75} />
      ))}
    </svg>
  );
}

export function releaseConsistencyCopy(result: ReleaseConsistency): string {
  if (result.byType.length < 2) {
    return 'Not enough pitch types labelled yet to compare release points.';
  }
  return result.consistentAcrossTypes
    ? 'Release points cluster tightly across pitch types — nothing here gives the pitch away before it leaves the hand.'
    : "Release points shift noticeably by pitch type — a batter reading the arm slot could pick up on this before the ball arrives.";
}
