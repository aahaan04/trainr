/**
 * Small hand-rolled 3D projection / orbit helper for the setup diagram (Section 10).
 *
 * The virtual orbit camera is projected through the exact same pinhole model
 * (src/vision/camera.ts) that the real calibrated cameras use. That is what makes
 * the "Camera A view" snap trivial: it is just an orbit state whose eye happens to
 * sit at Camera A's real world position, produced by `orbitStateForEye`.
 *
 * SVG has no z-buffer, so `depthSort` gives every caller a single back-to-front
 * paint order (painter's algorithm) driven by camera-space depth.
 */

import type { CameraExtrinsics, CameraIntrinsics, Vec3 } from '@/domain/types';
import { intrinsicsFromFov, lookAt, projectPoint } from '@/vision/camera';
import { degToRad } from '@/domain/units';

export const vec3 = {
  add: (a: Vec3, b: Vec3): Vec3 => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z }),
  sub: (a: Vec3, b: Vec3): Vec3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z }),
  scale: (a: Vec3, s: number): Vec3 => ({ x: a.x * s, y: a.y * s, z: a.z * s }),
  lerp: (a: Vec3, b: Vec3, t: number): Vec3 => vec3.add(a, vec3.scale(vec3.sub(b, a), t)),
  length: (a: Vec3): number => Math.hypot(a.x, a.y, a.z),
  cross: (a: Vec3, b: Vec3): Vec3 => ({
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  }),
  normalize: (a: Vec3): Vec3 => {
    const n = Math.hypot(a.x, a.y, a.z) || 1;
    return { x: a.x / n, y: a.y / n, z: a.z / n };
  },
};

export interface OrbitState {
  azimuthRad: number;
  elevationRad: number;
  distanceM: number;
  zoom: number;
}

/**
 * Elevation is clamped strictly above 0 so the eye never dips under the ground
 * plane and the scene never renders "from underneath". 15 degrees was chosen
 * because it sits just below Camera A's own real elevation angle at its ideal
 * placement (~16 degrees at 16 ft / 4.5 ft), so the low-angle end of the range
 * still resembles a plausible camera view rather than a purely abstract one.
 */
export const ORBIT_LIMITS = {
  minElevationRad: degToRad(15),
  maxElevationRad: degToRad(90),
  minZoom: 0.6,
  maxZoom: 3,
  minDistanceM: 2,
  maxDistanceM: 40,
} as const;

const TAU = Math.PI * 2;

const wrapAngle = (a: number): number => {
  let r = a % TAU;
  if (r < 0) r += TAU;
  return r;
};

export function clampOrbit(state: OrbitState): OrbitState {
  return {
    azimuthRad: wrapAngle(state.azimuthRad),
    elevationRad: Math.min(
      ORBIT_LIMITS.maxElevationRad,
      Math.max(ORBIT_LIMITS.minElevationRad, state.elevationRad),
    ),
    distanceM: Math.min(ORBIT_LIMITS.maxDistanceM, Math.max(ORBIT_LIMITS.minDistanceM, state.distanceM)),
    zoom: Math.min(ORBIT_LIMITS.maxZoom, Math.max(ORBIT_LIMITS.minZoom, state.zoom)),
  };
}

/**
 * Spherical placement around `pivot`. azimuth 0 points toward +Z (behind the
 * plate, matching CAMERA_PLACEMENT.plate.azimuthDeg = 0) and azimuth 90 degrees
 * points toward +X (first-base side, matching CAMERA_PLACEMENT.side.azimuthDeg
 * = 90) — the same convention geometry.ts uses to place the real cameras, so an
 * orbit state and a camera placement are directly comparable.
 */
export function orbitEye(pivot: Vec3, state: OrbitState): Vec3 {
  const ce = Math.cos(state.elevationRad);
  const se = Math.sin(state.elevationRad);
  return {
    x: pivot.x + state.distanceM * ce * Math.sin(state.azimuthRad),
    y: pivot.y + state.distanceM * se,
    z: pivot.z + state.distanceM * ce * Math.cos(state.azimuthRad),
  };
}

/** Inverse of `orbitEye`, used to turn a real camera position into a snap target. */
export function orbitStateForEye(pivot: Vec3, eye: Vec3, zoom = 1): OrbitState {
  const d = vec3.sub(eye, pivot);
  const distanceM = vec3.length(d) || ORBIT_LIMITS.minDistanceM;
  const elevationRad = Math.asin(Math.min(1, Math.max(-1, d.y / distanceM)));
  const azimuthRad = Math.atan2(d.x, d.z);
  return clampOrbit({ azimuthRad, elevationRad, distanceM, zoom });
}

/** Shortest-path azimuth interpolation so a 350deg -> 10deg snap turns 20deg, not 340. */
export function lerpOrbit(a: OrbitState, b: OrbitState, t: number): OrbitState {
  let da = wrapAngle(b.azimuthRad) - wrapAngle(a.azimuthRad);
  if (da > Math.PI) da -= TAU;
  if (da < -Math.PI) da += TAU;
  return clampOrbit({
    azimuthRad: a.azimuthRad + da * t,
    elevationRad: a.elevationRad + (b.elevationRad - a.elevationRad) * t,
    distanceM: a.distanceM + (b.distanceM - a.distanceM) * t,
    zoom: a.zoom + (b.zoom - a.zoom) * t,
  });
}

/**
 * Numeric solve of a CSS cubic-bezier(x1,y1,x2,y2) timing function via
 * Newton-Raphson, the same technique browsers use for CSS transitions. Needed
 * here because the orbit snap is driven by requestAnimationFrame, not CSS, so it
 * has to reproduce motion.orbit's easing (`--dur-orbit`, cubic-bezier(0.2,0,0,1))
 * by hand to look identical to the rest of the app's motion.
 */
export function cubicBezierEasing(x1: number, y1: number, x2: number, y2: number): (t: number) => number {
  const cx = 3 * x1;
  const bx = 3 * (x2 - x1) - cx;
  const ax = 1 - cx - bx;
  const cy = 3 * y1;
  const by = 3 * (y2 - y1) - cy;
  const ay = 1 - cy - by;
  const sampleX = (t: number) => ((ax * t + bx) * t + cx) * t;
  const sampleY = (t: number) => ((ay * t + by) * t + cy) * t;
  const sampleDX = (t: number) => (3 * ax * t + 2 * bx) * t + cx;
  const solveX = (x: number): number => {
    let t = x;
    for (let i = 0; i < 8; i++) {
      const dx = sampleDX(t);
      if (Math.abs(dx) < 1e-6) break;
      t -= (sampleX(t) - x) / dx;
      t = Math.min(1, Math.max(0, t));
    }
    return t;
  };
  return (t: number) => {
    if (t <= 0) return 0;
    if (t >= 1) return 1;
    return sampleY(solveX(t));
  };
}

/** The app's standard motion curve (`--ease`, `--dur-orbit`), pre-solved once. */
export const ORBIT_EASING = cubicBezierEasing(0.2, 0, 0, 1);

export interface ViewParams {
  pivot: Vec3;
  orbit: OrbitState;
  viewportW: number;
  viewportH: number;
  baseFovDeg?: number;
}

export interface DiagramView {
  intrinsics: CameraIntrinsics;
  extrinsics: CameraExtrinsics;
  eye: Vec3;
}

export function buildView(params: ViewParams): DiagramView {
  const eye = orbitEye(params.pivot, params.orbit);
  const extrinsics = lookAt(eye, params.pivot);
  const fovDeg = (params.baseFovDeg ?? 55) / params.orbit.zoom;
  const intrinsics = intrinsicsFromFov(params.viewportW, params.viewportH, fovDeg);
  return { intrinsics, extrinsics, eye };
}

export interface ScreenPoint {
  x: number;
  y: number;
  depthM: number;
  visible: boolean;
}

export function projectWorld(view: DiagramView, p: Vec3): ScreenPoint {
  const proj = projectPoint(view.intrinsics, view.extrinsics, p);
  return { x: proj.pixel.x, y: proj.pixel.y, depthM: proj.depthM, visible: proj.visible };
}

export function polygonDepth(view: DiagramView, points: readonly Vec3[]): number {
  if (points.length === 0) return 0;
  let sum = 0;
  for (const p of points) sum += projectWorld(view, p).depthM;
  return sum / points.length;
}

export interface DepthItem {
  depthM: number;
}

/**
 * Back-to-front paint order. Farthest (largest camera-space depth) sorts first, so
 * mapping the result straight into JSX children order paints correctly: later,
 * nearer items land later in the DOM and occlude earlier, farther ones.
 */
export function depthSort<T extends DepthItem>(items: readonly T[]): T[] {
  return [...items].sort((a, b) => b.depthM - a.depthM);
}

export type OrbitAction = 'rotateLeft' | 'rotateRight' | 'rotateUp' | 'rotateDown' | 'zoomIn' | 'zoomOut';

const ROTATE_STEP_RAD = degToRad(6);
const ZOOM_STEP = 0.15;

/**
 * Every keyboard action here has a 1:1 on-screen button and a 1:1 drag/zoom
 * gesture (see `orbitFromDrag` / `zoomFromPinch`) — Section 15 requires the
 * diagram be fully operable by keyboard alone, so nothing may exist as a
 * gesture-only affordance.
 */
export function stepOrbit(state: OrbitState, action: OrbitAction): OrbitState {
  switch (action) {
    case 'rotateLeft':
      return clampOrbit({ ...state, azimuthRad: state.azimuthRad - ROTATE_STEP_RAD });
    case 'rotateRight':
      return clampOrbit({ ...state, azimuthRad: state.azimuthRad + ROTATE_STEP_RAD });
    case 'rotateUp':
      return clampOrbit({ ...state, elevationRad: state.elevationRad + ROTATE_STEP_RAD });
    case 'rotateDown':
      return clampOrbit({ ...state, elevationRad: state.elevationRad - ROTATE_STEP_RAD });
    case 'zoomIn':
      return clampOrbit({ ...state, zoom: state.zoom + ZOOM_STEP });
    case 'zoomOut':
      return clampOrbit({ ...state, zoom: state.zoom - ZOOM_STEP });
  }
}

export function orbitFromDrag(
  state: OrbitState,
  dxPx: number,
  dyPx: number,
  viewportW: number,
  viewportH: number,
): OrbitState {
  const azPerPx = degToRad(180) / viewportW;
  const elPerPx = degToRad(120) / viewportH;
  return clampOrbit({
    ...state,
    azimuthRad: state.azimuthRad + dxPx * azPerPx,
    elevationRad: state.elevationRad - dyPx * elPerPx,
  });
}

export function zoomFromPinch(state: OrbitState, scaleDelta: number): OrbitState {
  return clampOrbit({ ...state, zoom: state.zoom * scaleDelta });
}
