/**
 * Test-only helper: fits a constant-acceleration FittedTrajectory to exact
 * harness/physics.ts ground-truth samples, standing in for WS3's real fitter so
 * this workstream's geometry (crossings, call, measurements) can be exercised
 * without waiting on src/vision/trajectory.ts to exist. Not shipped.
 */

import type { FittedTrajectory, Vec3 } from '@/domain/types';
import type { GroundTruth } from '../../../harness/physics';

function solve3(a: number[][], b: number[]): [number, number, number] {
  const m = a.map((row) => [...row]);
  const rhs = [...b];
  for (let col = 0; col < 3; col++) {
    let pivot = col;
    for (let r = col + 1; r < 3; r++) if (Math.abs(m[r][col]) > Math.abs(m[pivot][col])) pivot = r;
    [m[col], m[pivot]] = [m[pivot], m[col]];
    [rhs[col], rhs[pivot]] = [rhs[pivot], rhs[col]];
    for (let r = col + 1; r < 3; r++) {
      const f = m[r][col] / m[col][col];
      for (let c = col; c < 3; c++) m[r][c] -= f * m[col][c];
      rhs[r] -= f * rhs[col];
    }
  }
  const x: [number, number, number] = [0, 0, 0];
  for (let r = 2; r >= 0; r--) {
    let sum = rhs[r];
    for (let c = r + 1; c < 3; c++) sum -= m[r][c] * x[c];
    x[r] = sum / m[r][r];
  }
  return x;
}

/** Least-squares quadratic y = c0 + c1*t + c2*t^2. */
function quadraticFit(ts: readonly number[], ys: readonly number[]): [number, number, number] {
  let S0 = 0,
    S1 = 0,
    S2 = 0,
    S3 = 0,
    S4 = 0,
    Sy = 0,
    Sty = 0,
    St2y = 0;
  for (let i = 0; i < ts.length; i++) {
    const t = ts[i];
    const y = ys[i];
    const t2 = t * t;
    S0 += 1;
    S1 += t;
    S2 += t2;
    S3 += t2 * t;
    S4 += t2 * t2;
    Sy += y;
    Sty += t * y;
    St2y += t2 * y;
  }
  return solve3(
    [
      [S0, S1, S2],
      [S1, S2, S3],
      [S2, S3, S4],
    ],
    [Sy, Sty, St2y],
  );
}

export interface FitOptions {
  cameraCount?: 1 | 2;
  /** Subsample every Nth ground-truth sample, mimicking a lower capture fps. */
  stride?: number;
  /** How far past the back crossing to keep integrating, seconds. */
  tailS?: number;
}

export function fitTrajectoryFromGroundTruth(gt: GroundTruth, opts: FitOptions = {}): FittedTrajectory {
  const stride = opts.stride ?? 1;
  const backTs = gt.crossings.back?.tS ?? gt.flightTimeS;
  const cutoff = backTs + (opts.tailS ?? 0.03);
  const samples = gt.samples.filter((s, i) => s.tS <= cutoff && i % stride === 0);
  if (samples.length < 5) throw new Error('not enough ground-truth samples to fit');

  const ts = samples.map((s) => s.tS);
  const [x0, vx, ax2] = quadraticFit(ts, samples.map((s) => s.position.x));
  const [y0, vy, ay2] = quadraticFit(ts, samples.map((s) => s.position.y));
  const [z0, vz, az2] = quadraticFit(ts, samples.map((s) => s.position.z));

  const p0: Vec3 = { x: x0, y: y0, z: z0 };
  const v0: Vec3 = { x: vx, y: vy, z: vz };
  const a: Vec3 = { x: 2 * ax2, y: 2 * ay2, z: 2 * az2 };

  let sq = 0;
  for (const s of samples) {
    const t = s.tS;
    const px = p0.x + v0.x * t + 0.5 * a.x * t * t;
    const py = p0.y + v0.y * t + 0.5 * a.y * t * t;
    const pz = p0.z + v0.z * t + 0.5 * a.z * t * t;
    sq += (px - s.position.x) ** 2 + (py - s.position.y) ** 2 + (pz - s.position.z) ** 2;
  }
  const residualM = Math.sqrt(sq / samples.length);

  return {
    p0,
    v0,
    a,
    t0Ms: 0,
    tStartS: ts[0],
    tEndS: ts[ts.length - 1],
    residualM,
    sampleCount: samples.length,
    inlierCount: samples.length,
    cameraCount: opts.cameraCount ?? 2,
  };
}
