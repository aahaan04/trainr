/**
 * Pinhole camera model with a single radial distortion term. OpenCV conventions
 * throughout, so anything ported from OpenCV references lines up:
 *
 *   camera frame: +X right in the image, +Y DOWN in the image, +Z forward along the
 *                 view direction. Image v increases downward.
 *   extrinsics:   x_cam = R * x_world + t, with R stored as a Rodrigues vector.
 *
 * This is foundation code. Capture/calibration, tracking, fusion and the test
 * harness all project through these exact functions; do not write a second copy.
 */

import type { CameraExtrinsics, CameraIntrinsics, Vec2, Vec3 } from '@/domain/types';

export type Mat3x3 = Float64Array;

const EPS = 1e-12;

export function rodriguesToMatrix(rvec: readonly [number, number, number]): Mat3x3 {
  const [rx, ry, rz] = rvec;
  const theta = Math.hypot(rx, ry, rz);
  const R = new Float64Array(9);
  if (theta < EPS) {
    R[0] = 1;
    R[4] = 1;
    R[8] = 1;
    return R;
  }
  const kx = rx / theta;
  const ky = ry / theta;
  const kz = rz / theta;
  const c = Math.cos(theta);
  const s = Math.sin(theta);
  const t = 1 - c;

  R[0] = c + kx * kx * t;
  R[1] = kx * ky * t - kz * s;
  R[2] = kx * kz * t + ky * s;
  R[3] = ky * kx * t + kz * s;
  R[4] = c + ky * ky * t;
  R[5] = ky * kz * t - kx * s;
  R[6] = kz * kx * t - ky * s;
  R[7] = kz * ky * t + kx * s;
  R[8] = c + kz * kz * t;
  return R;
}

export function matrixToRodrigues(R: Mat3x3): [number, number, number] {
  const trace = R[0] + R[4] + R[8];
  const cosTheta = Math.min(1, Math.max(-1, (trace - 1) / 2));
  const theta = Math.acos(cosTheta);
  if (theta < EPS) return [0, 0, 0];
  if (Math.PI - theta < 1e-6) {
    // Near 180 degrees the antisymmetric part vanishes; recover the axis from the
    // diagonal of R + I instead, which stays well conditioned there.
    const d = [Math.sqrt((R[0] + 1) / 2), Math.sqrt((R[4] + 1) / 2), Math.sqrt((R[8] + 1) / 2)];
    const maxI = d.indexOf(Math.max(...d));
    const axis = [0, 0, 0];
    axis[maxI] = d[maxI];
    const other = [(R[1] + R[3]) / 4, (R[2] + R[6]) / 4, (R[5] + R[7]) / 4];
    if (maxI === 0) {
      axis[1] = other[0] / axis[0];
      axis[2] = other[1] / axis[0];
    } else if (maxI === 1) {
      axis[0] = other[0] / axis[1];
      axis[2] = other[2] / axis[1];
    } else {
      axis[0] = other[1] / axis[2];
      axis[1] = other[2] / axis[2];
    }
    const n = Math.hypot(axis[0], axis[1], axis[2]) || 1;
    return [(axis[0] / n) * theta, (axis[1] / n) * theta, (axis[2] / n) * theta];
  }
  const k = theta / (2 * Math.sin(theta));
  return [(R[7] - R[5]) * k, (R[2] - R[6]) * k, (R[3] - R[1]) * k];
}

export function matMulVec(R: Mat3x3, v: Vec3): Vec3 {
  return {
    x: R[0] * v.x + R[1] * v.y + R[2] * v.z,
    y: R[3] * v.x + R[4] * v.y + R[5] * v.z,
    z: R[6] * v.x + R[7] * v.y + R[8] * v.z,
  };
}

export function matTransposeMulVec(R: Mat3x3, v: Vec3): Vec3 {
  return {
    x: R[0] * v.x + R[3] * v.y + R[6] * v.z,
    y: R[1] * v.x + R[4] * v.y + R[7] * v.z,
    z: R[2] * v.x + R[5] * v.y + R[8] * v.z,
  };
}

export function worldToCamera(ext: CameraExtrinsics, p: Vec3): Vec3 {
  const R = rodriguesToMatrix(ext.rvec);
  const c = matMulVec(R, p);
  return { x: c.x + ext.tvec[0], y: c.y + ext.tvec[1], z: c.z + ext.tvec[2] };
}

/** Camera centre in world coordinates: C = -R^T * t. */
export function cameraCenter(ext: CameraExtrinsics): Vec3 {
  const R = rodriguesToMatrix(ext.rvec);
  const t = { x: ext.tvec[0], y: ext.tvec[1], z: ext.tvec[2] };
  const c = matTransposeMulVec(R, t);
  return { x: -c.x, y: -c.y, z: -c.z };
}

/** Applies the forward radial distortion model to normalised image coordinates. */
export function distort(xn: number, yn: number, k1: number): Vec2 {
  const r2 = xn * xn + yn * yn;
  const f = 1 + k1 * r2;
  return { x: xn * f, y: yn * f };
}

/**
 * Inverts the radial model by fixed-point iteration. Converges in a handful of
 * steps for the mild distortion typical of webcams.
 */
export function undistort(xd: number, yd: number, k1: number): Vec2 {
  if (k1 === 0) return { x: xd, y: yd };
  let x = xd;
  let y = yd;
  for (let i = 0; i < 8; i++) {
    const r2 = x * x + y * y;
    const f = 1 + k1 * r2;
    x = xd / f;
    y = yd / f;
  }
  return { x, y };
}

export interface Projection {
  pixel: Vec2;
  /** Depth along the camera's optical axis, in metres. Negative means behind the camera. */
  depthM: number;
  /** True when the point is in front of the camera and inside the image bounds. */
  visible: boolean;
}

export function projectPoint(
  intr: CameraIntrinsics,
  ext: CameraExtrinsics,
  worldPoint: Vec3,
): Projection {
  const c = worldToCamera(ext, worldPoint);
  if (c.z <= EPS) {
    return { pixel: { x: NaN, y: NaN }, depthM: c.z, visible: false };
  }
  const d = distort(c.x / c.z, c.y / c.z, intr.k1);
  const pixel = { x: intr.fx * d.x + intr.cx, y: intr.fy * d.y + intr.cy };
  const visible = pixel.x >= 0 && pixel.x < intr.width && pixel.y >= 0 && pixel.y < intr.height;
  return { pixel, depthM: c.z, visible };
}

/** Unit ray direction in WORLD space through a pixel, originating at the camera centre. */
export function unprojectRay(intr: CameraIntrinsics, ext: CameraExtrinsics, pixel: Vec2): Vec3 {
  const u = undistort((pixel.x - intr.cx) / intr.fx, (pixel.y - intr.cy) / intr.fy, intr.k1);
  const R = rodriguesToMatrix(ext.rvec);
  const dirWorld = matTransposeMulVec(R, { x: u.x, y: u.y, z: 1 });
  const n = Math.hypot(dirWorld.x, dirWorld.y, dirWorld.z) || 1;
  return { x: dirWorld.x / n, y: dirWorld.y / n, z: dirWorld.z / n };
}

/**
 * Apparent diameter in pixels of a sphere of known real diameter at a given optical
 * depth. This is the monocular depth signal, run backwards.
 *
 * Uses the minor axis of the blob's rotated rect, NOT its major axis: motion blur
 * stretches the major axis into a streak that has nothing to do with ball size.
 */
export function apparentDiameterPx(intr: CameraIntrinsics, diameterM: number, depthM: number): number {
  return (intr.fx * diameterM) / Math.max(depthM, EPS);
}

/** The inverse: optical depth from an observed minor-axis length. */
export function depthFromDiameterPx(
  intr: CameraIntrinsics,
  diameterM: number,
  minorAxisPx: number,
): number {
  return (intr.fx * diameterM) / Math.max(minorAxisPx, EPS);
}

/** Seeds intrinsics from a reported horizontal field of view, before PnP refines them. */
export function intrinsicsFromFov(
  width: number,
  height: number,
  horizontalFovDeg: number,
  k1 = 0,
): CameraIntrinsics {
  const fx = width / (2 * Math.tan((horizontalFovDeg * Math.PI) / 360));
  return { fx, fy: fx, cx: width / 2, cy: height / 2, k1, width, height };
}

/**
 * Builds extrinsics for a camera at `eye` looking at `target`. Used by the test
 * harness to place virtual cameras, and by the setup diagram to fly to a camera's
 * viewpoint. World up is +Y.
 */
export function lookAt(eye: Vec3, target: Vec3): CameraExtrinsics {
  const fx = target.x - eye.x;
  const fy = target.y - eye.y;
  const fz = target.z - eye.z;
  const fn = Math.hypot(fx, fy, fz) || 1;
  const camZ: Vec3 = { x: fx / fn, y: fy / fn, z: fz / fn };

  // Image-right = camZ x worldUp. For a camera behind the plate looking toward the
  // pitcher this yields world +X (first base) on the right of frame, which is what
  // a person standing at the plate sees.
  let rx = camZ.y * 0 - camZ.z * 1;
  let ry = camZ.z * 0 - camZ.x * 0;
  let rz = camZ.x * 1 - camZ.y * 0;
  let rn = Math.hypot(rx, ry, rz);
  if (rn < 1e-9) {
    // Looking straight up or down; pick an arbitrary stable right vector.
    rx = 1;
    ry = 0;
    rz = 0;
    rn = 1;
  }
  const camX: Vec3 = { x: rx / rn, y: ry / rn, z: rz / rn };
  // Image-down = camZ x camX.
  const camY: Vec3 = {
    x: camZ.y * camX.z - camZ.z * camX.y,
    y: camZ.z * camX.x - camZ.x * camX.z,
    z: camZ.x * camX.y - camZ.y * camX.x,
  };

  const R = new Float64Array([camX.x, camX.y, camX.z, camY.x, camY.y, camY.z, camZ.x, camZ.y, camZ.z]);
  const t = matMulVec(R, eye);
  return { rvec: matrixToRodrigues(R), tvec: [-t.x, -t.y, -t.z] };
}

/** RMS reprojection error in pixels for a set of world/image correspondences. */
export function reprojectionError(
  intr: CameraIntrinsics,
  ext: CameraExtrinsics,
  worldPoints: readonly Vec3[],
  imagePoints: readonly Vec2[],
): number {
  let sum = 0;
  for (let i = 0; i < worldPoints.length; i++) {
    const p = projectPoint(intr, ext, worldPoints[i]);
    const dx = p.pixel.x - imagePoints[i].x;
    const dy = p.pixel.y - imagePoints[i].y;
    sum += dx * dx + dy * dy;
  }
  return Math.sqrt(sum / Math.max(worldPoints.length, 1));
}

/** Intersects a world ray with the plane z = planeZ. Returns null when parallel. */
export function intersectPlaneZ(origin: Vec3, dir: Vec3, planeZ: number): Vec3 | null {
  if (Math.abs(dir.z) < EPS) return null;
  const t = (planeZ - origin.z) / dir.z;
  if (t < 0) return null;
  return { x: origin.x + dir.x * t, y: origin.y + dir.y * t, z: planeZ };
}
