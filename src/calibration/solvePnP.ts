/**
 * Section 3.2 — geometric calibration.
 *
 * Solves camera pose from the five tapped plate corners without OpenCV.js. All
 * plate model points have y = 0 (the plate is flush with the ground), so this is a
 * plane-to-plane homography problem: recover H via DLT, decompose H into R|t
 * (standard planar-pose decomposition, the same trick ArUco/marker trackers use),
 * then polish with a few Levenberg-Marquardt steps against true pixel reprojection
 * error, refining rotation, translation and k1 together. fx/fy/cx/cy stay fixed at
 * their FOV-seeded values — five points is not enough to also self-calibrate focal
 * length without the solve becoming ill-conditioned.
 */

import type { CameraCalibration, CameraExtrinsics, CameraIntrinsics, CameraRole, Vec2, Vec3 } from '@/domain/types';
import type { PlateCornerName } from '@/domain/constants';
import { CAMERA_PLACEMENT, PLATE_CORNER_ORDER, PLATE_MODEL_POINTS } from '@/domain/constants';
import { toFeet } from '@/domain/units';
import {
  cameraCenter,
  matrixToRodrigues,
  projectPoint,
  reprojectionError,
  rodriguesToMatrix,
  undistort,
  type Mat3x3,
} from '@/vision/camera';
import { matTMulMat, matTMulVec, solveLinearSystem } from './linalg';

/** Above this RMS pixel error, the wizard must refuse to accept the calibration. */
export const PNP_MAX_REPROJECTION_ERROR_PX = 3;

export interface PnpSolveResult {
  extrinsics: CameraExtrinsics;
  intrinsics: CameraIntrinsics;
  reprojectionErrorPx: number;
  converged: boolean;
  iterations: number;
}

/** Builds the 3x3 homography (row-major, h9 = 1 gauge) mapping world (X,Z) -> normalized image (xn,yn). */
export function homographyDLT(worldXZ: readonly [number, number][], normImg: readonly Vec2[]): number[] | null {
  const rows: number[][] = [];
  const rhs: number[] = [];
  for (let i = 0; i < worldXZ.length; i++) {
    const [X, Z] = worldXZ[i];
    const { x: xn, y: yn } = normImg[i];
    rows.push([X, Z, 1, 0, 0, 0, -xn * X, -xn * Z]);
    rhs.push(xn);
    rows.push([0, 0, 0, X, Z, 1, -yn * X, -yn * Z]);
    rhs.push(yn);
  }
  const AtA = matTMulMat(rows);
  const Atb = matTMulVec(rows, rhs);
  const h8 = solveLinearSystem(AtA, Atb);
  if (!h8) return null;
  return [...h8, 1];
}

/**
 * Decomposes a world-plane homography into R|t. A world plate point is
 * (X, 0, Z), so c = R*p + t = X*Rcol0 + Z*Rcol2 + t — the homography's first two
 * columns are (up to a shared scale) the first and third columns of R, and its
 * third column is t at that same scale.
 */
export function decomposeHomography(h: readonly number[]): { rvec: [number, number, number]; tvec: [number, number, number] } | null {
  return decomposeHomographyCandidates(h)[0] ?? null;
}

/**
 * A planar homography does not determine pose uniquely: Gram-Schmidt can orthonormalise
 * against either recovered column first, and the two choices give genuinely different
 * poses that explain the tapped points almost equally well. Returning both and letting
 * the caller pick by refined reprojection error is what stops a few pixels of tap noise
 * from locking in the wrong branch — see `assessPoseCredibility` for why low
 * reprojection error alone cannot catch this.
 */
export function decomposeHomographyCandidates(
  h: readonly number[],
): { rvec: [number, number, number]; tvec: [number, number, number] }[] {
  const h1: [number, number, number] = [h[0], h[3], h[6]];
  const h2: [number, number, number] = [h[1], h[4], h[7]];
  const h3: [number, number, number] = [h[2], h[5], h[8]];
  const n1 = Math.hypot(h1[0], h1[1], h1[2]);
  const n2 = Math.hypot(h2[0], h2[1], h2[2]);
  if (n1 < 1e-9 || n2 < 1e-9) return [];
  const s = (n1 + n2) / 2;

  // Sign ambiguity: the world origin (plate back point) must land in front of the
  // camera, i.e. its depth (== t.z once the shared scale is divided out) is positive.
  const sign = h3[2] / s >= 0 ? 1 : -1;
  const a: [number, number, number] = [(sign * h1[0]) / s, (sign * h1[1]) / s, (sign * h1[2]) / s];
  const b: [number, number, number] = [(sign * h2[0]) / s, (sign * h2[1]) / s, (sign * h2[2]) / s];
  const t: [number, number, number] = [(sign * h3[0]) / s, (sign * h3[1]) / s, (sign * h3[2]) / s];

  const out: { rvec: [number, number, number]; tvec: [number, number, number] }[] = [];
  for (const anchorFirst of [true, false]) {
    const keep = anchorFirst ? a : b;
    const adjust = anchorFirst ? b : a;
    const kn = Math.hypot(keep[0], keep[1], keep[2]) || 1;
    const rKeep: [number, number, number] = [keep[0] / kn, keep[1] / kn, keep[2] / kn];

    const dot = rKeep[0] * adjust[0] + rKeep[1] * adjust[1] + rKeep[2] * adjust[2];
    let rOther: [number, number, number] = [
      adjust[0] - dot * rKeep[0],
      adjust[1] - dot * rKeep[1],
      adjust[2] - dot * rKeep[2],
    ];
    const n = Math.hypot(rOther[0], rOther[1], rOther[2]);
    if (n < 1e-9) continue;
    rOther = [rOther[0] / n, rOther[1] / n, rOther[2] / n];

    const rCol0 = anchorFirst ? rKeep : rOther;
    const rCol2 = anchorFirst ? rOther : rKeep;

    // Right-handed orthonormal triple: col0 x col1 = col2, so col1 = col2 x col0.
    const rCol1: [number, number, number] = [
      rCol2[1] * rCol0[2] - rCol2[2] * rCol0[1],
      rCol2[2] * rCol0[0] - rCol2[0] * rCol0[2],
      rCol2[0] * rCol0[1] - rCol2[1] * rCol0[0],
    ];

    const R = new Float64Array(9) as unknown as Mat3x3;
    R[0] = rCol0[0]; R[3] = rCol0[1]; R[6] = rCol0[2];
    R[1] = rCol1[0]; R[4] = rCol1[1]; R[7] = rCol1[2];
    R[2] = rCol2[0]; R[5] = rCol2[1]; R[8] = rCol2[2];

    out.push({ rvec: matrixToRodrigues(R), tvec: t });
  }
  return out;
}

/** Minimum area, in square pixels, the five tapped corners must enclose. */
export const MIN_TAP_HULL_AREA_PX2 = 60;

/**
 * Rejects degenerate taps — five points on a line, or duplicates — by the area they
 * enclose in the image.
 *
 * The tempting check is on the homography instead: for a real view of the plate its
 * first two columns are columns of a rotation matrix times a shared scale, so they
 * should be equal-length and perpendicular. That check DOES NOT WORK here, and the
 * measurements say so plainly. Over 60 seeds at the plate cam's placement:
 *
 *   valid taps, 1 px noise   column-length ratio 0.64 - 2.69, |cos| up to 0.82
 *   five collinear taps      column-length ratio 0.25,        |cos| 0.19
 *
 * A fully degenerate tap looks MORE orthonormal than a valid noisy one, because the
 * plate images only ~91 x 24 px and noise perturbs the recovered columns further
 * than the collapse does. So degeneracy has to be detected on the taps themselves,
 * where the signal is unambiguous: the real plate encloses on the order of a
 * thousand square pixels and a collapsed tap encloses none.
 */
export function tapHullAreaPx2(points: readonly Vec2[]): number {
  const pts = points.filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
  if (pts.length < 3) return 0;

  const sorted = [...pts].sort((a, b) => a.x - b.x || a.y - b.y);
  const cross = (o: Vec2, a: Vec2, b: Vec2) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const build = (seq: Vec2[]) => {
    const out: Vec2[] = [];
    for (const p of seq) {
      while (out.length >= 2 && cross(out[out.length - 2], out[out.length - 1], p) <= 0) out.pop();
      out.push(p);
    }
    return out;
  };
  const lower = build(sorted);
  const upper = build([...sorted].reverse());
  const hull = [...lower.slice(0, -1), ...upper.slice(0, -1)];
  if (hull.length < 3) return 0;

  let area2 = 0;
  for (let i = 0; i < hull.length; i++) {
    const a = hull[i];
    const b = hull[(i + 1) % hull.length];
    area2 += a.x * b.y - b.x * a.y;
  }
  return Math.abs(area2) / 2;
}

type Params = readonly [number, number, number, number, number, number, number];

function residuals(p: Params, intr: CameraIntrinsics, worldPoints: readonly Vec3[], imagePoints: readonly Vec2[]): number[] {
  const ext: CameraExtrinsics = { rvec: [p[0], p[1], p[2]], tvec: [p[3], p[4], p[5]] };
  const kIntr: CameraIntrinsics = { ...intr, k1: p[6] };
  const out: number[] = [];
  for (let i = 0; i < worldPoints.length; i++) {
    const proj = projectPoint(kIntr, ext, worldPoints[i]);
    out.push(proj.pixel.x - imagePoints[i].x, proj.pixel.y - imagePoints[i].y);
  }
  return out;
}

function sumSquares(v: readonly number[]): number {
  let s = 0;
  for (const x of v) s += x * x;
  return s;
}

/** Refines [rvec(3), tvec(3), k1(1)] by Levenberg-Marquardt on pixel reprojection error. */
function refinePose(
  seed: Params,
  intr: CameraIntrinsics,
  worldPoints: readonly Vec3[],
  imagePoints: readonly Vec2[],
): { params: Params; converged: boolean; iterations: number } {
  let params = seed;
  let currentRes = residuals(params, intr, worldPoints, imagePoints);
  let currentCost = sumSquares(currentRes);
  let lambda = 1e-3;
  let converged = false;
  let iter = 0;

  for (; iter < 60; iter++) {
    const n = params.length;
    const J: number[][] = Array.from({ length: currentRes.length }, () => new Array(n).fill(0));
    for (let j = 0; j < n; j++) {
      const step = Math.max(1e-6, Math.abs(params[j]) * 1e-4);
      const pArrPlus = params.slice();
      pArrPlus[j] += step;
      const resPlus = residuals(pArrPlus as unknown as Params, intr, worldPoints, imagePoints);
      const pArrMinus = params.slice();
      pArrMinus[j] -= step;
      const resMinus = residuals(pArrMinus as unknown as Params, intr, worldPoints, imagePoints);
      for (let i = 0; i < resPlus.length; i++) J[i][j] = (resPlus[i] - resMinus[i]) / (2 * step);
    }
    const JtJ = matTMulMat(J);
    const Jtr = matTMulVec(J, currentRes);

    let improved = false;
    for (let tries = 0; tries < 12; tries++) {
      const A = JtJ.map((row, i) => row.map((v, j) => (i === j ? v * (1 + lambda) : v)));
      const rhs = Jtr.map((v) => -v);
      const delta = solveLinearSystem(A, rhs);
      if (!delta) {
        lambda *= 10;
        continue;
      }
      const nextParams = params.map((v, i) => v + delta[i]) as unknown as Params;
      const nextRes = residuals(nextParams, intr, worldPoints, imagePoints);
      const nextCost = sumSquares(nextRes);
      if (nextCost < currentCost) {
        const relImprovement = (currentCost - nextCost) / Math.max(currentCost, 1e-12);
        params = nextParams;
        currentRes = nextRes;
        currentCost = nextCost;
        lambda = Math.max(lambda / 10, 1e-10);
        improved = true;
        if (relImprovement < 1e-10) converged = true;
        break;
      }
      lambda *= 10;
    }
    if (!improved || converged) {
      converged = converged || !improved;
      break;
    }
  }

  return { params, converged, iterations: iter + 1 };
}

/**
 * Solves for camera pose given the five tapped plate corners, in PLATE_CORNER_ORDER,
 * against the seed intrinsics from `intrinsicsFromFov`.
 */
export function solvePlatePnP(
  imagePoints: Record<PlateCornerName, Vec2>,
  seedIntrinsics: CameraIntrinsics,
): PnpSolveResult {
  const orderedImg = PLATE_CORNER_ORDER.map((k) => imagePoints[k]);
  const worldPoints: Vec3[] = PLATE_MODEL_POINTS.map(([x, y, z]) => ({ x, y, z }));
  const worldXZ: [number, number][] = PLATE_MODEL_POINTS.map(([x, , z]) => [x, z]);

  const normImg = orderedImg.map((p) =>
    undistort((p.x - seedIntrinsics.cx) / seedIntrinsics.fx, (p.y - seedIntrinsics.cy) / seedIntrinsics.fy, seedIntrinsics.k1),
  );

  if (tapHullAreaPx2(orderedImg) < MIN_TAP_HULL_AREA_PX2) {
    throw new Error('Plate corners are degenerate (collinear or duplicated); retap the corners.');
  }

  const h = homographyDLT(worldXZ, normImg);
  if (!h || h.some((v) => !Number.isFinite(v))) {
    throw new Error('Plate corners are degenerate (collinear or duplicated); retap the corners.');
  }
  const candidates = decomposeHomographyCandidates(h);
  if (candidates.length === 0) throw new Error('Homography decomposition failed; retap the corners.');

  let best: PnpSolveResult | null = null;
  for (const seed of candidates) {
    const seedParams: Params = [
      seed.rvec[0], seed.rvec[1], seed.rvec[2],
      seed.tvec[0], seed.tvec[1], seed.tvec[2],
      seedIntrinsics.k1,
    ];
    const { params, converged, iterations } = refinePose(seedParams, seedIntrinsics, worldPoints, orderedImg);
    if (params.some((v) => !Number.isFinite(v))) continue;

    const extrinsics: CameraExtrinsics = { rvec: [params[0], params[1], params[2]], tvec: [params[3], params[4], params[5]] };
    const intrinsics: CameraIntrinsics = { ...seedIntrinsics, k1: params[6] };
    const reprojectionErrorPx = reprojectionError(intrinsics, extrinsics, worldPoints, orderedImg);
    if (!Number.isFinite(reprojectionErrorPx)) continue;

    if (!best || reprojectionErrorPx < best.reprojectionErrorPx) {
      best = { extrinsics, intrinsics, reprojectionErrorPx, converged, iterations };
    }
  }

  if (!best) throw new Error('Pose refinement did not converge; retap the corners.');
  return best;
}

/**
 * Bootstrap estimate of how well-determined the solve actually is, in metres of
 * camera-position spread.
 *
 * This exists because reprojection error is close to meaningless as a confidence
 * signal for this particular target. The plate is 17 in across and the recommended
 * plate-cam placement views it from ~16 ft at a ~15 degree grazing angle, so it
 * images as roughly 87 x 23 px at 720p. The depth direction is compressed into those
 * 23 px, which means a couple of pixels of tap error is a ~10% perturbation along the
 * view axis and translates into metres of position uncertainty — while reprojection
 * error stays under a pixel, because the solved pose still explains the tapped points.
 *
 * Re-solving from jittered taps measures that sensitivity directly, so the wizard can
 * tell the user their calibration is uncertain instead of showing them a clean-looking
 * overlay and a reassuring sub-pixel number.
 */
export function estimatePoseUncertainty(
  imagePoints: Record<PlateCornerName, Vec2>,
  seedIntrinsics: CameraIntrinsics,
  tapNoisePx = 2,
  trials = 24,
): { positionSpreadM: number; worstDeviationM: number; trials: number } {
  const baseline = cameraCenter(solvePlatePnP(imagePoints, seedIntrinsics).extrinsics);
  let seed = 0x9e3779b9;
  const rand = () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  const deviations: number[] = [];
  for (let i = 0; i < trials; i++) {
    const jittered = {} as Record<PlateCornerName, Vec2>;
    for (const name of PLATE_CORNER_ORDER) {
      jittered[name] = {
        x: imagePoints[name].x + (rand() - 0.5) * 2 * tapNoisePx,
        y: imagePoints[name].y + (rand() - 0.5) * 2 * tapNoisePx,
      };
    }
    try {
      const c = cameraCenter(solvePlatePnP(jittered, seedIntrinsics).extrinsics);
      const d = Math.hypot(c.x - baseline.x, c.y - baseline.y, c.z - baseline.z);
      if (Number.isFinite(d)) deviations.push(d);
    } catch {
      // A jittered retap that fails to solve is itself evidence of a fragile setup;
      // count it as a large deviation rather than quietly shrinking the sample.
      deviations.push(Infinity);
    }
  }

  if (deviations.length === 0) return { positionSpreadM: Infinity, worstDeviationM: Infinity, trials: 0 };
  const finite = deviations.filter(Number.isFinite);
  const rms = finite.length
    ? Math.sqrt(finite.reduce((s, d) => s + d * d, 0) / finite.length)
    : Infinity;
  return {
    positionSpreadM: finite.length === deviations.length ? rms : Infinity,
    worstDeviationM: Math.max(...deviations),
    trials: deviations.length,
  };
}

/** Assembles the persisted CameraCalibration record from a solve result. */
export function buildCameraCalibration(
  role: CameraCalibration['role'],
  result: PnpSolveResult,
  tappedCorners: Record<PlateCornerName, Vec2>,
): CameraCalibration {
  return {
    role,
    intrinsics: result.intrinsics,
    extrinsics: result.extrinsics,
    tappedCorners,
    reprojectionErrorPx: result.reprojectionErrorPx,
    positionWorld: cameraCenter(result.extrinsics),
    calibratedAt: Date.now(),
  };
}

/** True when a solve is good enough to let the user proceed. */
export function isCalibrationAcceptable(result: Pick<PnpSolveResult, 'reprojectionErrorPx'>): boolean {
  return result.reprojectionErrorPx <= PNP_MAX_REPROJECTION_ERROR_PX;
}

export interface PoseCredibility {
  ok: boolean;
  reasons: string[];
}

/**
 * A second, independent gate beyond reprojection error. Planar pose from a small,
 * near-coplanar target viewed at a grazing angle — exactly the recommended plate-cam
 * geometry, chosen so the strike zone reads as a frontal rectangle — has a known
 * ambiguity: a handful of pixels of tap noise can converge to a physically wrong
 * pose (e.g. camera on the wrong side of the plate) whose reprojection error is
 * still low, because "low reprojection error" only means the solved pose explains
 * the TAPPED points well, not that it is the right pose. The overlay would look
 * fine too, for the same reason. Checking the solved camera position against the
 * placement envelope from Section 3.1 catches what reprojection error cannot.
 */
export function assessPoseCredibility(role: CameraRole, positionWorld: Vec3): PoseCredibility {
  const spec = CAMERA_PLACEMENT[role];
  const reasons: string[] = [];
  const distFt = toFeet(Math.hypot(positionWorld.x, positionWorld.z));
  const heightFt = toFeet(positionWorld.y);

  if (role === 'plate' && positionWorld.z <= 0) {
    reasons.push('The solve places the camera on the pitcher\'s side of the plate. Retap the corners in order, back point first.');
  }
  // Generous envelope around the guidance numbers: this is a plausibility floor, not
  // an enforcement of the ideal placement, so it should only reject solves that are
  // geometrically nonsensical for the chosen role.
  const minDistFt = spec.distanceFt.min * 0.4;
  const maxDistFt = spec.distanceFt.max * 2.5;
  if (distFt < minDistFt || distFt > maxDistFt) {
    reasons.push(
      `Solved camera distance is ${distFt.toFixed(1)} ft from the plate, which is not plausible for the ${spec.label}. Retap the corners.`,
    );
  }
  const maxHeightFt = spec.heightFt.max * 3;
  if (heightFt < -1 || heightFt > maxHeightFt) {
    reasons.push(`Solved camera height is ${heightFt.toFixed(1)} ft, which is not plausible. Retap the corners.`);
  }

  return { ok: reasons.length === 0, reasons };
}

// rodriguesToMatrix re-exported for callers that need to visualize the recovered
// orientation (e.g. the plate overlay) without re-deriving it from rvec themselves.
export { rodriguesToMatrix };
