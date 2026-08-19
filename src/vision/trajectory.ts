/**
 * Robust least-squares fit of a constant-acceleration trajectory (p0, v0, a) to a
 * set of timed 3D positions. Per-axis quadratic regression, iteratively reweighted
 * (IRLS, Huber loss on a MAD-derived scale) so a handful of bad monocular-depth
 * samples cannot drag the whole fit off course.
 *
 * Camera-agnostic on purpose: this module never touches pixels, intrinsics, or
 * extrinsics. Turning a 2D detection plus a depth estimate into a world position is
 * src/vision/pipeline.ts's job (and the seam WS4's triangulation plugs into) --
 * this file only ever sees (time, position, weight) triples.
 */

import type { FittedTrajectory, Vec3 } from '@/domain/types';

export interface TimedPosition {
  tS: number;
  position: Vec3;
  /** Prior confidence in [0,1], e.g. detection confidence. Combined with the robust weight. */
  weight: number;
}

export interface TrajectoryFitResult {
  trajectory: FittedTrajectory;
  /** Parallel to the (time-sorted) input; true where the final fit kept the sample. */
  inliers: boolean[];
}

const MAX_ITERS = 8;
const HUBER_K = 1.5;
const MIN_SIGMA_M = 0.01;

/** Gaussian elimination with partial pivoting, specialised to 3x3 (the quadratic design matrix). */
function solve3x3(A: readonly (readonly number[])[], b: readonly number[]): number[] | null {
  const M = A.map((row, i) => [...row, b[i]]);
  for (let col = 0; col < 3; col++) {
    let piv = col;
    for (let r = col + 1; r < 3; r++) if (Math.abs(M[r][col]) > Math.abs(M[piv][col])) piv = r;
    if (Math.abs(M[piv][col]) < 1e-12) return null;
    [M[col], M[piv]] = [M[piv], M[col]];
    for (let r = 0; r < 3; r++) {
      if (r === col) continue;
      const f = M[r][col] / M[col][col];
      for (let c = col; c < 4; c++) M[r][c] -= f * M[col][c];
    }
  }
  return [M[0][3] / M[0][0], M[1][3] / M[1][1], M[2][3] / M[2][2]];
}

function median(sorted: number[]): number {
  const n = sorted.length;
  if (n === 0) return 0;
  return n % 2 === 1 ? sorted[(n - 1) / 2] : (sorted[n / 2 - 1] + sorted[n / 2]) / 2;
}

export function fitTrajectory(
  samples: TimedPosition[],
  t0Ms: number,
  cameraCount: 1 | 2 = 1,
): TrajectoryFitResult {
  if (samples.length < 3) {
    throw new Error(`fitTrajectory needs at least 3 samples, got ${samples.length}`);
  }
  const ordered = [...samples].sort((s1, s2) => s1.tS - s2.tS);
  const n = ordered.length;
  const baseWeight = ordered.map((s) => Math.max(s.weight, 1e-3));
  const w = [...baseWeight];

  let p0: Vec3 = { x: 0, y: 0, z: 0 };
  let v0: Vec3 = { x: 0, y: 0, z: 0 };
  let a: Vec3 = { x: 0, y: 0, z: 0 };

  for (let iter = 0; iter < MAX_ITERS; iter++) {
    const ATA = [
      [0, 0, 0],
      [0, 0, 0],
      [0, 0, 0],
    ];
    const ATbx = [0, 0, 0];
    const ATby = [0, 0, 0];
    const ATbz = [0, 0, 0];

    for (let i = 0; i < n; i++) {
      const t = ordered[i].tS;
      const row = [1, t, 0.5 * t * t];
      const wi = w[i];
      const p = ordered[i].position;
      for (let r = 0; r < 3; r++) {
        for (let c = 0; c < 3; c++) ATA[r][c] += wi * row[r] * row[c];
        ATbx[r] += wi * row[r] * p.x;
        ATby[r] += wi * row[r] * p.y;
        ATbz[r] += wi * row[r] * p.z;
      }
    }

    const solX = solve3x3(ATA, ATbx);
    const solY = solve3x3(ATA, ATby);
    const solZ = solve3x3(ATA, ATbz);
    if (!solX || !solY || !solZ) break;

    p0 = { x: solX[0], y: solY[0], z: solZ[0] };
    v0 = { x: solX[1], y: solY[1], z: solZ[1] };
    a = { x: solX[2], y: solY[2], z: solZ[2] };

    const residuals = ordered.map((s) => {
      const t = s.tS;
      const px = p0.x + v0.x * t + 0.5 * a.x * t * t;
      const py = p0.y + v0.y * t + 0.5 * a.y * t * t;
      const pz = p0.z + v0.z * t + 0.5 * a.z * t * t;
      return Math.hypot(px - s.position.x, py - s.position.y, pz - s.position.z);
    });
    const sortedAbs = [...residuals].sort((x, y) => x - y);
    const med = median(sortedAbs);
    const mad = median(residuals.map((r) => Math.abs(r - med)).sort((x, y) => x - y));
    const sigma = Math.max(mad * 1.4826, MIN_SIGMA_M);

    for (let i = 0; i < n; i++) {
      const rNorm = residuals[i] / sigma;
      const huber = rNorm <= HUBER_K ? 1 : HUBER_K / rNorm;
      w[i] = baseWeight[i] * huber;
    }
  }

  const finalResiduals = ordered.map((s) => {
    const t = s.tS;
    const px = p0.x + v0.x * t + 0.5 * a.x * t * t;
    const py = p0.y + v0.y * t + 0.5 * a.y * t * t;
    const pz = p0.z + v0.z * t + 0.5 * a.z * t * t;
    return Math.hypot(px - s.position.x, py - s.position.y, pz - s.position.z);
  });
  const sortedFinal = [...finalResiduals].sort((x, y) => x - y);
  const medFinal = median(sortedFinal);
  const madFinal = median(finalResiduals.map((r) => Math.abs(r - medFinal)).sort((x, y) => x - y));
  const sigmaFinal = Math.max(madFinal * 1.4826, MIN_SIGMA_M);
  const inlierThreshold = Math.max(3 * sigmaFinal, 0.08);
  const inliers = finalResiduals.map((r) => r <= inlierThreshold);

  const inlierResiduals = finalResiduals.filter((_, i) => inliers[i]);
  const rmsSource = inlierResiduals.length > 0 ? inlierResiduals : finalResiduals;
  const residualM = Math.sqrt(rmsSource.reduce((sum, r) => sum + r * r, 0) / rmsSource.length);

  const trajectory: FittedTrajectory = {
    p0,
    v0,
    a,
    t0Ms,
    tStartS: ordered[0].tS,
    tEndS: ordered[n - 1].tS,
    residualM,
    sampleCount: n,
    inlierCount: inlierResiduals.length,
    cameraCount,
  };

  return { trajectory, inliers };
}
