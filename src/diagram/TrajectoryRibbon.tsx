/**
 * The app's signature motif (Section 8.6): a ribbon thin at release, widening as
 * the ball nears the camera, filled optic -> optic-glow, with a soft outer glow and
 * a bright leading dot at the ball's current position.
 *
 * This component is pure 2D SVG — callers project their own path to screen space
 * first (the setup diagram projects a 3D world path; a chart line or the logo mark
 * can hand it any arbitrary 2D points) — so the same component drives the diagram's
 * pitch animation, chart lines, dividers, loading states and the logo mark without
 * this file knowing anything about any of their coordinate systems. It renders a
 * bare `<g>` and must be placed inside a parent `<svg>`.
 */

import { useId, useMemo } from 'react';
import { color } from '@/design/tokens';

export interface RibbonPoint {
  x: number;
  y: number;
}

export interface TrajectoryRibbonProps {
  /** Path in screen/local space, ordered from the thin end to the wide end. */
  points: readonly RibbonPoint[];
  /** 0..1 fraction of the path currently drawn; also positions the leading dot.
   * Defaults to 1 (fully drawn, no animation) for static uses like dividers. */
  progress?: number;
  minWidthPx?: number;
  maxWidthPx?: number;
  glow?: boolean;
  /** Defaults to showing the dot only while progress < 1 (mid-animation). */
  showLeadingDot?: boolean;
  className?: string;
}

export function TrajectoryRibbon({
  points,
  progress = 1,
  minWidthPx = 2,
  maxWidthPx = 14,
  glow = true,
  showLeadingDot,
  className,
}: TrajectoryRibbonProps) {
  const uid = useId();
  const clampedProgress = Math.min(1, Math.max(0, progress));

  const built = useMemo(
    () => buildRibbon(points, clampedProgress, minWidthPx, maxWidthPx),
    [points, clampedProgress, minWidthPx, maxWidthPx],
  );

  if (points.length < 2 || !built.outline) return null;

  const gradId = `ribbon-grad-${uid}`;
  const glowId = `ribbon-glow-${uid}`;
  const first = points[0];
  const last = points[points.length - 1];
  const dotVisible = showLeadingDot ?? clampedProgress < 1;

  return (
    <g className={className}>
      <defs>
        <linearGradient id={gradId} x1={first.x} y1={first.y} x2={last.x} y2={last.y} gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor={color.optic} stopOpacity={0.5} />
          <stop offset="100%" stopColor={color.opticGlow} stopOpacity={1} />
        </linearGradient>
        {glow && (
          <filter id={glowId} x="-75%" y="-75%" width="250%" height="250%">
            <feGaussianBlur stdDeviation="4" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        )}
      </defs>
      <path
        d={built.outline}
        fill={`url(#${gradId})`}
        stroke="none"
        filter={glow ? `url(#${glowId})` : undefined}
      />
      {dotVisible && built.lead && (
        <circle
          cx={built.lead.x}
          cy={built.lead.y}
          r={Math.max(4, maxWidthPx * 0.55)}
          fill={color.opticGlow}
          filter={glow ? `url(#${glowId})` : undefined}
        />
      )}
    </g>
  );
}

function buildRibbon(
  points: readonly RibbonPoint[],
  progress: number,
  minWidthPx: number,
  maxWidthPx: number,
): { outline: string | null; lead: RibbonPoint | null } {
  if (points.length < 2) return { outline: null, lead: null };

  const lastIndex = points.length - 1;
  const cutFloat = progress * lastIndex;
  const cut = Math.max(1, Math.floor(cutFloat));
  const path: RibbonPoint[] = points.slice(0, cut + 1);
  if (progress < 1 && cut < lastIndex) {
    const a = points[cut];
    const b = points[cut + 1];
    const localT = cutFloat - cut;
    path.push({ x: a.x + (b.x - a.x) * localT, y: a.y + (b.y - a.y) * localT });
  }
  if (path.length < 2) return { outline: null, lead: null };

  // Width tapers against the FULL path length, not the truncated one, so a
  // mid-animation ribbon still reads as "thin here, wide there" rather than
  // rescaling its own taper every frame.
  const top: RibbonPoint[] = [];
  const bottom: RibbonPoint[] = [];
  for (let i = 0; i < path.length; i++) {
    const t = i / lastIndex;
    const halfWidth = (minWidthPx + (maxWidthPx - minWidthPx) * t) / 2;
    const prev = path[Math.max(0, i - 1)];
    const next = path[Math.min(path.length - 1, i + 1)];
    const dx = next.x - prev.x;
    const dy = next.y - prev.y;
    const len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len;
    const ny = dx / len;
    top.push({ x: path[i].x + nx * halfWidth, y: path[i].y + ny * halfWidth });
    bottom.push({ x: path[i].x - nx * halfWidth, y: path[i].y - ny * halfWidth });
  }

  const d = [
    `M ${top[0].x} ${top[0].y}`,
    ...top.slice(1).map((p) => `L ${p.x} ${p.y}`),
    ...[...bottom].reverse().map((p) => `L ${p.x} ${p.y}`),
    'Z',
  ].join(' ');

  return { outline: d, lead: path[path.length - 1] };
}
