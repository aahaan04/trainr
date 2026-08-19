/**
 * DLT triangulation (Section 4). Two or more synchronised 2D observations of the
 * same point, each with known camera calibration, resolve to a single 3D point by
 * least squares. No OpenCV; this is the textbook linear method, hand-rolled.
 *
 * Derivation: a pinhole camera observing world point X at normalised (undistorted)
 * image coordinates (xn, yn) satisfies xn*(R3.X+t3) = R1.X+t1 and
 * yn*(R3.X+t3) = R2.X+t2, where Ri/ti are the rows of R and components of t. Each
 * observation contributes two linear rows in the unknown X; stacking observations
 * and solving by least squares is the DLT.
 */

import type { CameraCalibration, CameraRole, Vec2, Vec3 } from '@/domain/types';
import { rodriguesToMatrix, undistort } from '@/vision/camera';
import { monocularSample, type MonocularSample } from './depth';

export interface CameraObservation {
  pixel: Vec2;
  minorAxisPx: number;
  timestampMs: number;
}

/** Per-pixel measurement noise assumed for both DLT rows and covariance estimation. */
export const DEFAULT_PIXEL_SIGMA_PX = 1.0;

interface Row {
  coeffs: readonly [number, number, number];
  rhs: number;
}

function rowsFor(cal: CameraCalibration, pixel: Vec2): [Row, Row] {
  const { intrinsics: intr, extrinsics: ext } = cal;
  const u = undistort((pixel.x - intr.cx) / intr.fx, (pixel.y - intr.cy) / intr.fy, intr.k1);
  const R = rodriguesToMatrix(ext.rvec);
  const t = ext.tvec;
  // (xn*R3 - R1).X = t1 - xn*t3
  const row1: Row = {
    coeffs: [u.x * R[6] - R[0], u.x * R[7] - R[1], u.x * R[8] - R[2]],
    rhs: t[0] - u.x * t[2],
  };
  // (yn*R3 - R2).X = t2 - yn*t3
  const row2: Row = {
    coeffs: [u.y * R[6] - R[3], u.y * R[7] - R[4], u.y * R[8] - R[5]],
    rhs: t[1] - u.y * t[2],
  };
  return [row1, row2];
}

function mat3Solve(ata: number[][], atb: number[]): number[] | null {
  // Gaussian elimination with partial pivoting on a 3x3 system.
  const m = ata.map((row) => [...row]);
  const b = [...atb];
  for (let col = 0; col < 3; col++) {
    let pivot = col;
    for (let r = col + 1; r < 3; r++) if (Math.abs(m[r][col]) > Math.abs(m[pivot][col])) pivot = r;
    if (Math.abs(m[pivot][col]) < 1e-12) return null;
    if (pivot !== col) {
      [m[col], m[pivot]] = [m[pivot], m[col]];
      [b[col], b[pivot]] = [b[pivot], b[col]];
    }
    for (let r = col + 1; r < 3; r++) {
      const f = m[r][col] / m[col][col];
      for (let c = col; c < 3; c++) m[r][c] -= f * m[col][c];
      b[r] -= f * b[col];
    }
  }
  const x = [0, 0, 0];
  for (let r = 2; r >= 0; r--) {
    let sum = b[r];
    for (let c = r + 1; c < 3; c++) sum -= m[r][c] * x[c];
    x[r] = sum / m[r][r];
  }
  return x;
}

function mat3Invert(a: number[][]): number[][] | null {
  const cols: number[][] = [];
  for (let i = 0; i < 3; i++) {
    const e = [0, 0, 0];
    e[i] = 1;
    const x = mat3Solve(a, e);
    if (!x) return null;
    cols.push(x);
  }
  // cols[i] is column i of the inverse.
  return [
    [cols[0][0], cols[1][0], cols[2][0]],
    [cols[0][1], cols[1][1], cols[2][1]],
    [cols[0][2], cols[1][2], cols[2][2]],
  ];
}

export interface TriangulatedPoint {
  position: Vec3;
  sigmaM: number;
}

/**
 * Solves for X minimising sum of squared row residuals, i.e. the normal-equations
 * form of the DLT: (A^T A) X = A^T b. Needs at least two observations (four rows) to
 * be well posed; two observations from genuinely different viewpoints is exact.
 */
export function triangulateDLT(
  observations: readonly { pixel: Vec2; calibration: CameraCalibration }[],
  pixelSigmaPx: number = DEFAULT_PIXEL_SIGMA_PX,
): TriangulatedPoint {
  if (observations.length < 2) {
    throw new Error('triangulateDLT needs at least two observations');
  }
  const rows: Row[] = [];
  for (const obs of observations) rows.push(...rowsFor(obs.calibration, obs.pixel));

  const ata = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ];
  const atb = [0, 0, 0];
  for (const row of rows) {
    for (let i = 0; i < 3; i++) {
      for (let j = 0; j < 3; j++) ata[i][j] += row.coeffs[i] * row.coeffs[j];
      atb[i] += row.coeffs[i] * row.rhs;
    }
  }

  const x = mat3Solve(ata, atb);
  if (!x) throw new Error('triangulateDLT: degenerate camera geometry (near-parallel rays)');
  const position: Vec3 = { x: x[0], y: x[1], z: x[2] };

  // Average pixel-noise sigma converted to the normalised-coordinate units the rows
  // are built in, then propagated through the same normal-equations covariance the
  // solve used: cov(X) = sigma_n^2 * (A^T A)^-1.
  const sigmaN =
    observations.reduce((sum, o) => sum + pixelSigmaPx / o.calibration.intrinsics.fx, 0) / observations.length;
  const cov = mat3Invert(ata);
  const sigmaM = cov ? Math.sqrt(Math.max(0, ((cov[0][0] + cov[1][1] + cov[2][2]) / 3) * sigmaN * sigmaN)) : Infinity;

  return { position, sigmaM };
}

// ---------------------------------------------------------------------------
// Reconstruction seam: turns raw per-camera detections into 3D samples. This is
// the standalone version of the interface WS3's trajectory fit injects into;
// see the module header note in this workstream's report for the exact shape
// expected once src/vision/pipeline.ts exists.
// ---------------------------------------------------------------------------

export interface ReconstructedSample {
  position: Vec3;
  timestampMs: number;
  sigmaM: number;
  cameraCount: 1 | 2;
}

function nearestMatch(
  target: CameraObservation,
  candidates: readonly CameraObservation[],
  toleranceMs: number,
): CameraObservation | null {
  let best: CameraObservation | null = null;
  let bestDt = Infinity;
  for (const c of candidates) {
    const dt = Math.abs(c.timestampMs - target.timestampMs);
    if (dt < bestDt) {
      bestDt = dt;
      best = c;
    }
  }
  return best && bestDt <= toleranceMs ? best : null;
}

/**
 * Builds 3D samples from per-camera 2D detections + calibrations. Uses DLT
 * whenever a time-matched pair exists across both cameras (accurate); falls back
 * to monocular depth-from-size for anything that only one camera saw (approximate,
 * `cameraCount: 1`). `matchToleranceMs` should be a fraction of the frame interval
 * (e.g. half a frame at the capture fps) — clock sync quality bounds how tight it
 * can safely be set.
 */
export function reconstructSamples(
  observationsByCamera: Partial<Record<CameraRole, CameraObservation[]>>,
  calibrations: Partial<Record<CameraRole, CameraCalibration>>,
  opts: { matchToleranceMs?: number; pixelSigmaPx?: number; minorAxisSigmaPx?: number } = {},
): ReconstructedSample[] {
  const matchToleranceMs = opts.matchToleranceMs ?? 8;
  const roles = (Object.keys(observationsByCamera) as CameraRole[]).filter(
    (r) => calibrations[r] && (observationsByCamera[r]?.length ?? 0) > 0,
  );

  if (roles.length === 0) return [];

  if (roles.length === 1) {
    const role = roles[0];
    const cal = calibrations[role]!;
    return (observationsByCamera[role] ?? []).map((obs) => {
      const m: MonocularSample = monocularSample(cal, obs.pixel, obs.minorAxisPx, opts.minorAxisSigmaPx);
      return { position: m.position, timestampMs: obs.timestampMs, sigmaM: m.sigmaM, cameraCount: 1 as const };
    });
  }

  const [roleA, roleB] = roles;
  const calA = calibrations[roleA]!;
  const calB = calibrations[roleB]!;
  const obsA = observationsByCamera[roleA] ?? [];
  const obsB = observationsByCamera[roleB] ?? [];

  const samples: ReconstructedSample[] = [];
  for (const a of obsA) {
    const b = nearestMatch(a, obsB, matchToleranceMs);
    if (b) {
      const tri = triangulateDLT(
        [
          { pixel: a.pixel, calibration: calA },
          { pixel: b.pixel, calibration: calB },
        ],
        opts.pixelSigmaPx,
      );
      samples.push({
        position: tri.position,
        timestampMs: (a.timestampMs + b.timestampMs) / 2,
        sigmaM: tri.sigmaM,
        cameraCount: 2,
      });
    } else {
      const m = monocularSample(calA, a.pixel, a.minorAxisPx, opts.minorAxisSigmaPx);
      samples.push({ position: m.position, timestampMs: a.timestampMs, sigmaM: m.sigmaM, cameraCount: 1 });
    }
  }
  // Anything roleB saw with no roleA match still contributes a monocular sample.
  for (const b of obsB) {
    if (nearestMatch(b, obsA, matchToleranceMs)) continue;
    const m = monocularSample(calB, b.pixel, b.minorAxisPx, opts.minorAxisSigmaPx);
    samples.push({ position: m.position, timestampMs: b.timestampMs, sigmaM: m.sigmaM, cameraCount: 1 });
  }
  samples.sort((x, y) => x.timestampMs - y.timestampMs);
  return samples;
}
