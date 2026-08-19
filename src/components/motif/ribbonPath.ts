import type { RibbonPoint } from '@/diagram/TrajectoryRibbon';

/**
 * The single 2D curve every brand touchpoint in this workstream reuses through
 * WS7's `<TrajectoryRibbon/>`: release at lower-left (thin), arcing up and over to
 * the plate at lower-right (wide). One curve, sampled once, imported everywhere —
 * logo mark, dividers, loaders — per Section 8.6.
 */
export const RIBBON_VIEWBOX = '0 0 200 120';

const P0: RibbonPoint = { x: 8, y: 88 };
const P1: RibbonPoint = { x: 55, y: 20 };
const P2: RibbonPoint = { x: 130, y: 12 };
const P3: RibbonPoint = { x: 192, y: 96 };

function cubicPoint(t: number): RibbonPoint {
  const mt = 1 - t;
  const a = mt * mt * mt;
  const b = 3 * mt * mt * t;
  const c = 3 * mt * t * t;
  const d = t * t * t;
  return {
    x: a * P0.x + b * P1.x + c * P2.x + d * P3.x,
    y: a * P0.y + b * P1.y + c * P2.y + d * P3.y,
  };
}

function sample(n: number): RibbonPoint[] {
  return Array.from({ length: n + 1 }, (_, i) => cubicPoint(i / n));
}

/** 25 points along the curve, release to plate. */
export const RIBBON_POINTS: readonly RibbonPoint[] = sample(24);

/** Home-plate silhouette the logo mark's ribbon arcs over, same viewBox. */
export const PLATE_SILHOUETTE_D = 'M150,100 L182,100 L194,110 L182,120 L150,120 Z';
