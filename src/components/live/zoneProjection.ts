/**
 * Projects the strike zone into image space for the live overlay, using the same
 * pinhole projection every other workstream uses (`@/vision/camera`, foundation —
 * imported, never duplicated). Falls back to null when no calibration exists yet
 * (e.g. before the setup wizard has run), and the caller draws an approximate
 * frontal rectangle instead.
 */
import { projectPoint } from '@/vision/camera';
import type { CameraCalibration, StrikeZone, Vec2 } from '@/domain/types';
import { PLATE, ZONE_RULES } from '@/domain/constants';

export interface Segment {
  a: Vec2;
  b: Vec2;
}

export interface ZoneOverlayGeometry {
  imageWidth: number;
  imageHeight: number;
  /** The 3x3 grid as 4 outer edges + 4 internal divider segments. */
  gridSegments: Segment[];
  /** The shadow zone boundary, one ball-width outside the zone, dashed. */
  shadowPolygon: Vec2[];
  /** The nine cell polygons, row-major top-to-bottom, left-to-right, for call highlighting. */
  cells: Vec2[][];
}

function projectAt(cal: CameraCalibration, x: number, y: number, z: number): Vec2 {
  return projectPoint(cal.intrinsics, cal.extrinsics, { x, y, z }).pixel;
}

export function projectZoneOverlay(cal: CameraCalibration, zone: StrikeZone): ZoneOverlayGeometry | null {
  if (!Number.isFinite(zone.topM) || zone.topM <= zone.bottomM) return null;

  const z = PLATE.FRONT_Z_M;
  const half = zone.halfWidthM;
  const { bottomM: bot, topM: top } = zone;
  const shadow = ZONE_RULES.SHADOW_ZONE_M;
  const cols = 3;
  const rows = 3;

  const xAt = (i: number) => -half + (2 * half * i) / cols;
  const yAt = (j: number) => bot + ((top - bot) * j) / rows;

  const gridSegments: Segment[] = [];
  for (let i = 0; i <= cols; i++) {
    gridSegments.push({ a: projectAt(cal, xAt(i), bot, z), b: projectAt(cal, xAt(i), top, z) });
  }
  for (let j = 0; j <= rows; j++) {
    gridSegments.push({ a: projectAt(cal, -half, yAt(j), z), b: projectAt(cal, half, yAt(j), z) });
  }

  const shadowPolygon: Vec2[] = [
    projectAt(cal, -half - shadow, bot - shadow, z),
    projectAt(cal, half + shadow, bot - shadow, z),
    projectAt(cal, half + shadow, top + shadow, z),
    projectAt(cal, -half - shadow, top + shadow, z),
  ];

  const cells: Vec2[][] = [];
  for (let j = rows - 1; j >= 0; j--) {
    for (let i = 0; i < cols; i++) {
      cells.push([
        projectAt(cal, xAt(i), yAt(j), z),
        projectAt(cal, xAt(i + 1), yAt(j), z),
        projectAt(cal, xAt(i + 1), yAt(j + 1), z),
        projectAt(cal, xAt(i), yAt(j + 1), z),
      ]);
    }
  }

  return { imageWidth: cal.intrinsics.width, imageHeight: cal.intrinsics.height, gridSegments, shadowPolygon, cells };
}

/** Which of the nine cells (row-major, top-left first) a crossing position falls in, or null if outside. */
export function cellIndexForCrossing(zone: StrikeZone, x: number, y: number): number | null {
  const half = zone.halfWidthM;
  if (x < -half || x > half || y < zone.bottomM || y > zone.topM) return null;
  const col = Math.min(2, Math.floor(((x + half) / (2 * half)) * 3));
  const rowFromBottom = Math.min(2, Math.floor(((y - zone.bottomM) / (zone.topM - zone.bottomM)) * 3));
  const row = 2 - rowFromBottom;
  return row * 3 + col;
}
