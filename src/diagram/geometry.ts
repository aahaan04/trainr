/**
 * Field geometry as polygon data in world metres, plus a handful of illustrative
 * "sample pitch" paths for the diagram's play button. Every measurement is derived
 * from src/domain/constants.ts rather than re-typed, so a rulebook change there
 * propagates here without edits. Camera field-of-view angles (hFovDeg/vFovDeg) are
 * the one exception: no webcam FOV is specified anywhere in the app's constants
 * (it varies by device), so cameraPose uses a representative wide-angle webcam FOV
 * purely for drawing the illustrative cone.
 */

import type { Vec3 } from '@/domain/types';
import type { CameraRole, RuleSetId } from '@/domain/constants';
import {
  CAMERA_PLACEMENT,
  DEFAULT_BATTER_HEIGHT_M,
  DEFAULT_RULE_SET,
  FIELD,
  PLATE,
  PLATE_MODEL_M,
  RELEASE,
  rubberZ,
  zoneFromHeight,
} from '@/domain/constants';
import { feet, formatDistance, type UnitSystem } from '@/domain/units';
import { vec3 } from './project';

export const GROUND_Y = 0;

/** Winding order that traces the pentagon boundary; PLATE_CORNER_ORDER is the tap
 * order for calibration and is not a valid polygon winding on its own. */
const PLATE_POLYGON_ORDER: (keyof typeof PLATE_MODEL_M)[] = [
  'backPoint',
  'firstBaseSide',
  'firstBaseFront',
  'thirdBaseFront',
  'thirdBaseSide',
];

export function plateOutline(): Vec3[] {
  return PLATE_POLYGON_ORDER.map((k) => {
    const [x, y, z] = PLATE_MODEL_M[k];
    return { x, y, z };
  });
}

export interface Rect3 {
  points: [Vec3, Vec3, Vec3, Vec3];
}

function rect(cx: number, cz: number, width: number, depth: number, y = GROUND_Y): Rect3 {
  const hw = width / 2;
  const hd = depth / 2;
  return {
    points: [
      { x: cx - hw, y, z: cz - hd },
      { x: cx + hw, y, z: cz - hd },
      { x: cx + hw, y, z: cz + hd },
      { x: cx - hw, y, z: cz + hd },
    ],
  };
}

/** The box's centre sits slightly ahead (toward -Z) of the plate's back point. */
export function battersBoxes(): { left: Rect3; right: Rect3 } {
  const cz = PLATE.FRONT_Z_M / 2;
  const innerX = PLATE.HALF_WIDTH_M + FIELD.BATTERS_BOX_INSIDE_GAP_M;
  const cxRight = innerX + FIELD.BATTERS_BOX_WIDTH_M / 2;
  return {
    left: rect(-cxRight, cz, FIELD.BATTERS_BOX_WIDTH_M, FIELD.BATTERS_BOX_LENGTH_M),
    right: rect(cxRight, cz, FIELD.BATTERS_BOX_WIDTH_M, FIELD.BATTERS_BOX_LENGTH_M),
  };
}

export function catcherPosition(): Vec3 {
  return { x: 0, y: 0, z: FIELD.CATCHER_SETUP_Z_M };
}

export function rubberRect(distanceFt: number): Rect3 {
  const frontZ = rubberZ(distanceFt);
  const cz = frontZ - FIELD.RUBBER_DEPTH_M / 2;
  return rect(0, cz, FIELD.RUBBER_WIDTH_M, FIELD.RUBBER_DEPTH_M);
}

export function pitchersCircle(distanceFt: number, segments = 40): Vec3[] {
  const centerZ = rubberZ(distanceFt);
  const r = FIELD.PITCHERS_CIRCLE_DIAMETER_M / 2;
  const pts: Vec3[] = [];
  for (let i = 0; i < segments; i++) {
    const a = (i / segments) * Math.PI * 2;
    pts.push({ x: r * Math.sin(a), y: GROUND_Y, z: centerZ + r * Math.cos(a) });
  }
  return pts;
}

/** Foul lines run at 45 degrees from the plate's back point, the same angle as the
 * plate's own side edges (PLATE_HALF_WIDTH_M === PLATE_SIDE_LEN_M). Rendered length
 * always covers at least the configured pitching distance. */
export function foulLines(distanceFt: number): { first: [Vec3, Vec3]; third: [Vec3, Vec3] } {
  const length = Math.max(feet(60), Math.abs(rubberZ(distanceFt)) + feet(10));
  const k = length / Math.SQRT2;
  return {
    first: [
      { x: 0, y: 0, z: 0 },
      { x: k, y: 0, z: -k },
    ],
    third: [
      { x: 0, y: 0, z: 0 },
      { x: -k, y: 0, z: -k },
    ],
  };
}

export interface StrikeZoneBox {
  bottomM: number;
  topM: number;
  faces: {
    front: Vec3[];
    back: Vec3[];
    top: Vec3[];
    bottom: Vec3[];
    left: Vec3[];
    right: Vec3[];
  };
}

export function strikeZoneBox(
  bottomM?: number,
  topM?: number,
  ruleSet: RuleSetId = DEFAULT_RULE_SET,
): StrikeZoneBox {
  const zone =
    bottomM !== undefined && topM !== undefined
      ? { bottomM, topM }
      : zoneFromHeight(DEFAULT_BATTER_HEIGHT_M, ruleSet);
  const hw = PLATE.HALF_WIDTH_M;
  const zFront = PLATE.FRONT_Z_M;
  const zBack = PLATE.BACK_Z_M;
  const c = (x: number, y: number, z: number): Vec3 => ({ x, y, z });
  const corners = {
    flb: c(-hw, zone.bottomM, zFront),
    frb: c(hw, zone.bottomM, zFront),
    flt: c(-hw, zone.topM, zFront),
    frt: c(hw, zone.topM, zFront),
    blb: c(-hw, zone.bottomM, zBack),
    brb: c(hw, zone.bottomM, zBack),
    blt: c(-hw, zone.topM, zBack),
    brt: c(hw, zone.topM, zBack),
  };
  return {
    bottomM: zone.bottomM,
    topM: zone.topM,
    faces: {
      front: [corners.flb, corners.frb, corners.frt, corners.flt],
      back: [corners.blb, corners.brb, corners.brt, corners.blt],
      top: [corners.flt, corners.frt, corners.brt, corners.blt],
      bottom: [corners.flb, corners.frb, corners.brb, corners.blb],
      left: [corners.flb, corners.flt, corners.blt, corners.blb],
      right: [corners.frb, corners.frt, corners.brt, corners.brb],
    },
  };
}

export interface CameraPose {
  role: CameraRole;
  position: Vec3;
  target: Vec3;
  heightM: number;
  distanceM: number;
  hFovDeg: number;
  vFovDeg: number;
}

/** Places a camera using the same azimuth convention as project.ts's orbitEye, so a
 * camera's pose and an orbit state are directly interchangeable (see
 * orbitStateForEye in project.ts, used by the "Camera A view" snap). */
export function cameraPose(role: CameraRole, distanceFt: number): CameraPose {
  const spec = CAMERA_PLACEMENT[role];
  const heightM = feet(spec.heightFt.ideal);
  const distanceM = feet(spec.distanceFt.ideal);
  const az = (spec.azimuthDeg * Math.PI) / 180;
  const position: Vec3 = {
    x: distanceM * Math.sin(az),
    y: heightM,
    z: distanceM * Math.cos(az),
  };
  const target: Vec3 =
    role === 'plate' ? { x: 0, y: feet(2), z: rubberZ(distanceFt) } : { x: 0, y: feet(2), z: 0 };
  return { role, position, target, heightM, distanceM, hFovDeg: 60, vFovDeg: 45 };
}

export interface FovCone {
  apex: Vec3;
  base: [Vec3, Vec3, Vec3, Vec3];
}

function basisFromDir(dir: Vec3): { right: Vec3; up: Vec3 } {
  const worldUp: Vec3 = { x: 0, y: 1, z: 0 };
  let right = vec3.normalize(vec3.cross(dir, worldUp));
  if (vec3.length(right) < 1e-6) right = { x: 1, y: 0, z: 0 };
  const up = vec3.normalize(vec3.cross(right, dir));
  return { right, up };
}

export function cameraFovCone(pose: CameraPose, lengthM = pose.distanceM * 1.5): FovCone {
  const raw = vec3.sub(pose.target, pose.position);
  const dist = vec3.length(raw) || 1;
  const dir = vec3.scale(raw, 1 / dist);
  const { right, up } = basisFromDir(dir);
  const hw = Math.tan((pose.hFovDeg * Math.PI) / 360) * lengthM;
  const hh = Math.tan((pose.vFovDeg * Math.PI) / 360) * lengthM;
  const center = vec3.add(pose.position, vec3.scale(dir, lengthM));
  const corner = (sx: number, sy: number): Vec3 =>
    vec3.add(center, vec3.add(vec3.scale(right, sx * hw), vec3.scale(up, sy * hh)));
  return {
    apex: pose.position,
    base: [corner(-1, -1), corner(1, -1), corner(1, 1), corner(-1, 1)],
  };
}

export function fovConeFaces(cone: FovCone): Vec3[][] {
  const { apex, base } = cone;
  return [
    [apex, base[0], base[1]],
    [apex, base[1], base[2]],
    [apex, base[2], base[3]],
    [apex, base[3], base[0]],
  ];
}

// ---------------------------------------------------------------------------
// Sample pitch presets — illustrative shapes for the "play sample pitch" demo,
// not a physics fit. Only the release point and plate crossing are grounded in
// real constants (RELEASE, the strike zone); the mid-flight control point exists
// purely to make each type's break SHAPE visually distinct, per the spec.
// ---------------------------------------------------------------------------

export type SamplePitchId = 'fastball' | 'drop' | 'changeup';

export interface SamplePitchPreset {
  id: SamplePitchId;
  label: string;
  speedMph: number;
  isStrike: boolean;
  releaseHeightM: number;
}

export const SAMPLE_PITCH_PRESETS: readonly SamplePitchPreset[] = [
  { id: 'fastball', label: 'Fastball', speedMph: 62, isStrike: true, releaseHeightM: feet(3.2) },
  { id: 'drop', label: 'Drop', speedMph: 54, isStrike: true, releaseHeightM: feet(2.6) },
  { id: 'changeup', label: 'Changeup', speedMph: 46, isStrike: false, releaseHeightM: feet(3.0) },
];

export function samplePitchRelease(distanceFt: number, preset: SamplePitchPreset): Vec3 {
  const rz = rubberZ(distanceFt);
  return { x: 0, y: preset.releaseHeightM, z: rz + RELEASE.TYPICAL_STRIDE_M };
}

export function samplePitchCrossing(preset: SamplePitchPreset): Vec3 {
  const zone = zoneFromHeight(DEFAULT_BATTER_HEIGHT_M, DEFAULT_RULE_SET);
  switch (preset.id) {
    case 'fastball':
      return { x: 0, y: (zone.topM + zone.bottomM) / 2, z: PLATE.BACK_Z_M };
    case 'drop':
      return { x: 0.02, y: zone.bottomM + 0.03, z: PLATE.BACK_Z_M };
    case 'changeup':
      return { x: 0.28, y: zone.bottomM - 0.12, z: PLATE.FRONT_Z_M };
  }
}

function samplePitchControl(release: Vec3, crossing: Vec3, preset: SamplePitchPreset): Vec3 {
  const mid = vec3.lerp(release, crossing, 0.5);
  switch (preset.id) {
    case 'fastball':
      return vec3.add(mid, { x: 0, y: feet(0.15), z: 0 });
    case 'drop':
      return vec3.add(mid, { x: 0, y: feet(1.1), z: 0 });
    case 'changeup':
      return vec3.add(mid, { x: feet(0.6), y: feet(0.3), z: 0 });
  }
}

/** Quadratic Bezier (De Casteljau via nested lerps) from release to crossing;
 * endpoints are exact by construction, which is what the test suite checks. */
export function samplePitchPath(distanceFt: number, preset: SamplePitchPreset, samples = 48): Vec3[] {
  const release = samplePitchRelease(distanceFt, preset);
  const crossing = samplePitchCrossing(preset);
  const control = samplePitchControl(release, crossing, preset);
  const pts: Vec3[] = [];
  for (let i = 0; i <= samples; i++) {
    const t = i / samples;
    const a = vec3.lerp(release, control, t);
    const b = vec3.lerp(control, crossing, t);
    pts.push(vec3.lerp(a, b, t));
  }
  return pts;
}

export interface DiagramLabels {
  pitchingDistance: string;
  plateCamDistance: string;
  plateCamHeight: string;
  sideCamDistance: string;
  sideCamHeight: string;
}

/** Everything the diagram's callouts display, recomputed on every distance/unit
 * change so labels stay live by construction (the component just re-renders). */
export function diagramLabels(distanceFt: number, units: UnitSystem): DiagramLabels {
  const plateCam = cameraPose('plate', distanceFt);
  const sideCam = cameraPose('side', distanceFt);
  return {
    pitchingDistance: formatDistance(feet(distanceFt), units, 0),
    plateCamDistance: formatDistance(plateCam.distanceM, units),
    plateCamHeight: formatDistance(plateCam.heightM, units),
    sideCamDistance: formatDistance(sideCam.distanceM, units),
    sideCamHeight: formatDistance(sideCam.heightM, units),
  };
}
