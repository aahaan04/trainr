/**
 * Expandable detail card for one camera: placement ranges, the "why", the setup
 * notes (CAMERA_PLACEMENT copy, used verbatim per spec) and a simulated preview of
 * that camera's actual framing, built by pointing the real pinhole model
 * (lookAt/projectPoint from src/vision/camera.ts) at the camera's own target
 * instead of the diagram's orbit pivot.
 */

import { useMemo } from 'react';
import type { Vec3 } from '@/domain/types';
import type { CameraRole } from '@/domain/constants';
import { CAMERA_PLACEMENT } from '@/domain/constants';
import { formatDistance, type UnitSystem } from '@/domain/units';
import { intrinsicsFromFov, lookAt, projectPoint } from '@/vision/camera';
import { color } from '@/design/tokens';
import { cameraPose, plateOutline, rubberRect, strikeZoneBox } from './geometry';
import { TrajectoryRibbon } from './TrajectoryRibbon';

const PREVIEW_W = 240;
const PREVIEW_H = 160;

interface CameraCardProps {
  role: CameraRole;
  distanceFt: number;
  units: UnitSystem;
  expanded: boolean;
  onToggle: () => void;
  samplePath?: readonly Vec3[];
}

export function CameraCard({ role, distanceFt, units, expanded, onToggle, samplePath }: CameraCardProps) {
  const spec = CAMERA_PLACEMENT[role];
  const pose = cameraPose(role, distanceFt);
  const label = role === 'plate' ? 'Camera A — Plate cam' : 'Camera B — Side cam';

  const preview = useMemo(() => {
    const ext = lookAt(pose.position, pose.target);
    const intr = intrinsicsFromFov(PREVIEW_W, PREVIEW_H, pose.hFovDeg);
    const project = (p: Vec3) => projectPoint(intr, ext, p);

    const project2 = (points: readonly Vec3[]) => {
      const out: { x: number; y: number }[] = [];
      for (const p of points) {
        const s = project(p);
        if (!Number.isFinite(s.pixel.x) || s.depthM <= 0.05) return null;
        out.push({ x: s.pixel.x, y: s.pixel.y });
      }
      return out;
    };

    const plate = project2(plateOutline());
    const rubber = project2(rubberRect(distanceFt).points);
    const zone = strikeZoneBox();
    const zoneFront = project2(zone.faces.front);
    const ribbon = samplePath ? samplePath.map((p) => project(p).pixel) : null;

    return { plate, rubber, zoneFront, ribbon };
  }, [pose.position, pose.target, pose.hFovDeg, distanceFt, samplePath]);

  return (
    <div className="rounded-card border border-border bg-surface-1 shadow-rest">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        className="flex w-full min-h-tap items-center justify-between gap-3 rounded-card px-4 py-3 text-left transition-colors duration-hover hover:bg-surface-2"
      >
        <span className="font-display text-title text-ink">{label}</span>
        <span className="text-label text-ink-secondary">{expanded ? 'Hide' : 'Details'}</span>
      </button>

      {expanded && (
        <div className="space-y-4 border-t border-border px-4 py-4">
          <svg
            viewBox={`0 0 ${PREVIEW_W} ${PREVIEW_H}`}
            className="w-full rounded-input bg-surface-2"
            role="img"
            aria-label={`Simulated preview of what ${label} sees from its recommended placement`}
          >
            {preview.zoneFront && (
              <path
                d={`M ${preview.zoneFront.map((p) => `${p.x} ${p.y}`).join(' L ')} Z`}
                fill={color.indigo500}
                fillOpacity={0.16}
                stroke={color.indigo600}
                strokeOpacity={0.6}
              />
            )}
            {preview.plate && (
              <path
                d={`M ${preview.plate.map((p) => `${p.x} ${p.y}`).join(' L ')} Z`}
                fill={color.surface1}
                stroke={color.indigo900}
                strokeWidth={1}
              />
            )}
            {preview.rubber && (
              <path
                d={`M ${preview.rubber.map((p) => `${p.x} ${p.y}`).join(' L ')} Z`}
                fill={color.surface1}
                stroke={color.indigo900}
                strokeWidth={1}
              />
            )}
            {preview.ribbon && <TrajectoryRibbon points={preview.ribbon} minWidthPx={1.5} maxWidthPx={7} glow={false} />}
          </svg>

          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-body">
            <dt className="text-ink-secondary">Distance</dt>
            <dd className="num text-ink">
              {formatDistance(pose.distanceM, units)} ({spec.distanceFt.min}–{spec.distanceFt.max} ft range, {spec.distanceFt.ideal} ft ideal)
            </dd>
            <dt className="text-ink-secondary">Mounting height</dt>
            <dd className="num text-ink">
              {formatDistance(pose.heightM, units)} ({spec.heightFt.min}–{spec.heightFt.max} ft range, {spec.heightFt.ideal} ft ideal)
            </dd>
          </dl>

          <div>
            <p className="text-label text-ink-secondary">Why here</p>
            <p className="mt-1 text-body text-ink">{spec.why}</p>
          </div>

          <div>
            <p className="text-label text-ink-secondary">Notes</p>
            <ul className="mt-1 list-disc space-y-1 pl-5 text-body text-ink">
              {spec.notes.map((n) => (
                <li key={n}>{n}</li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}
