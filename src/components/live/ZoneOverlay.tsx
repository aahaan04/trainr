import { useMemo } from 'react';
import type { CameraCalibration, StrikeZone } from '@/domain/types';
import { cellIndexForCrossing, projectZoneOverlay } from './zoneProjection';

interface ZoneOverlayProps {
  calibration: CameraCalibration | null;
  zone: StrikeZone | null;
  /** Highlights the crossed cell green (strike) or flashes the outer field coral (ball outside). */
  lastCall?: { isStrike: boolean; x: number; y: number } | null;
  sunlightMode: boolean;
}

/**
 * 3x3 strike zone grid in white at 40% opacity with a dashed shadow-zone boundary
 * one ball-width outside (Section 8.7). Projected in true perspective from the
 * plate camera's calibration when available; otherwise an approximate frontal
 * rectangle, clearly a placeholder until the setup wizard (WS2) and calibration
 * (WS3/WS4) have run.
 */
export function ZoneOverlay({ calibration, zone, lastCall, sunlightMode }: ZoneOverlayProps) {
  const geometry = useMemo(() => (calibration && zone ? projectZoneOverlay(calibration, zone) : null), [
    calibration,
    zone,
  ]);
  const strokeWidth = sunlightMode ? 3 : 2;
  const thinStroke = sunlightMode ? 1.5 : 1;

  const highlightCell =
    lastCall && zone && lastCall.isStrike ? cellIndexForCrossing(zone, lastCall.x, lastCall.y) : null;

  if (geometry) {
    return (
      <svg
        className="pointer-events-none absolute inset-0 h-full w-full"
        viewBox={`0 0 ${geometry.imageWidth} ${geometry.imageHeight}`}
        preserveAspectRatio="xMidYMid slice"
        aria-hidden="true"
      >
        <polygon
          points={geometry.shadowPolygon.map((p) => `${p.x},${p.y}`).join(' ')}
          fill="none"
          stroke="white"
          strokeOpacity={0.35}
          strokeWidth={thinStroke}
          strokeDasharray="6 5"
        />
        {geometry.cells.map((cell, i) => (
          <polygon
            key={i}
            points={cell.map((p) => `${p.x},${p.y}`).join(' ')}
            fill={i === highlightCell ? 'var(--green-500)' : 'transparent'}
            fillOpacity={i === highlightCell ? 0.45 : 0}
            className={i === highlightCell ? 'animate-strike-pop' : ''}
          />
        ))}
        {geometry.gridSegments.map((seg, i) => (
          <line
            key={i}
            x1={seg.a.x}
            y1={seg.a.y}
            x2={seg.b.x}
            y2={seg.b.y}
            stroke="white"
            strokeOpacity={0.4}
            strokeWidth={strokeWidth}
          />
        ))}
      </svg>
    );
  }

  // No calibration yet: an approximate, clearly-placeholder frontal rectangle.
  return (
    <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
      <div
        className="over-video grid aspect-[17/24] h-2/3 grid-cols-3 grid-rows-3 border-2 border-white/40"
        style={{ borderStyle: 'solid' }}
      >
        {Array.from({ length: 9 }).map((_, i) => (
          <div key={i} className="border border-white/40" />
        ))}
      </div>
      <span className="over-video absolute bottom-2 text-caption text-white/80">
        Approximate zone — calibrate a camera for a perspective overlay
      </span>
    </div>
  );
}
