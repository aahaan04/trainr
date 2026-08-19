/**
 * Multi-hypothesis Kalman tracking in world space.
 *
 * State per hypothesis is constant-acceleration position+velocity, [x,y,z,vx,vy,vz].
 * Gravity is a known control input (never estimated), per Section 4; drag and Magnus
 * are absorbed into process noise sized from PHYSICS.MAX_AERO_ACCEL_MPS2, which is
 * what lets a hypothesis track a curving pitch without a curvature term in the
 * filter itself. The full aero-aware fit happens later in trajectory.ts.
 *
 * A handful of hypotheses (TRACKING.MAX_ACTIVE_HYPOTHESES) run in parallel so one
 * frame of clutter, or one missed detection, cannot kill the real track. Promotion
 * to "this is a pitch" requires TRACKING.MIN_DETECTIONS_FOR_PITCH samples on a
 * plausible plate-ward arc that backward-extrapolates to the calibrated release
 * region -- the primary defence against a fielder's glove being called a fastball.
 */

import { DEFAULT_PITCHING_DISTANCE_FT, PHYSICS, RELEASE, TRACKING, rubberZ } from '@/domain/constants';
import type { BallDetection, Mat3, TrackSample, Vec3 } from '@/domain/types';

export interface WorldObservation {
  detection: BallDetection;
  /** Reconstructed world position (the seam output -- see pipeline.ts). */
  position: Vec3;
  /** Camera-frame depth used to reconstruct `position`. Stored on the TrackSample. */
  rangeM: number;
  /** World-space measurement covariance of `position`, metres^2 (the seam supplies this too). */
  covariance: Mat3;
}

type M6 = Float64Array;

function buildF(dt: number): M6 {
  const F = new Float64Array(36);
  for (let i = 0; i < 6; i++) F[i * 6 + i] = 1;
  F[0 * 6 + 3] = dt;
  F[1 * 6 + 4] = dt;
  F[2 * 6 + 5] = dt;
  return F;
}

function buildQ(dt: number, sigmaA: number): M6 {
  const Q = new Float64Array(36);
  const dt2 = dt * dt;
  const dt3 = dt2 * dt;
  const dt4 = dt3 * dt;
  const qPos = sigmaA * sigmaA * dt4 * 0.25;
  const qPosVel = sigmaA * sigmaA * dt3 * 0.5;
  const qVel = sigmaA * sigmaA * dt2;
  for (const [pi, vi] of [
    [0, 3],
    [1, 4],
    [2, 5],
  ]) {
    Q[pi * 6 + pi] = qPos;
    Q[pi * 6 + vi] = qPosVel;
    Q[vi * 6 + pi] = qPosVel;
    Q[vi * 6 + vi] = qVel;
  }
  return Q;
}

function mat6MulVec(A: M6, v: Float64Array): Float64Array {
  const r = new Float64Array(6);
  for (let i = 0; i < 6; i++) {
    let s = 0;
    for (let k = 0; k < 6; k++) s += A[i * 6 + k] * v[k];
    r[i] = s;
  }
  return r;
}

function mat6Mul(A: M6, B: M6): M6 {
  const C = new Float64Array(36);
  for (let r = 0; r < 6; r++) {
    for (let c = 0; c < 6; c++) {
      let s = 0;
      for (let k = 0; k < 6; k++) s += A[r * 6 + k] * B[k * 6 + c];
      C[r * 6 + c] = s;
    }
  }
  return C;
}

function mat6Transpose(A: M6): M6 {
  const T = new Float64Array(36);
  for (let r = 0; r < 6; r++) for (let c = 0; c < 6; c++) T[c * 6 + r] = A[r * 6 + c];
  return T;
}

function mat6Add(A: M6, B: M6): M6 {
  const C = new Float64Array(36);
  for (let i = 0; i < 36; i++) C[i] = A[i] + B[i];
  return C;
}

/** Closed-form 3x3 inverse via the adjugate. Used for the position-only innovation covariance. */
function invert3x3(m: ArrayLike<number>): Float64Array | null {
  const m0 = m[0], m1 = m[1], m2 = m[2];
  const m3 = m[3], m4 = m[4], m5 = m[5];
  const m6 = m[6], m7 = m[7], m8 = m[8];
  const c0 = m4 * m8 - m5 * m7;
  const c1 = -(m3 * m8 - m5 * m6);
  const c2 = m3 * m7 - m4 * m6;
  const c3 = -(m1 * m8 - m2 * m7);
  const c4 = m0 * m8 - m2 * m6;
  const c5 = -(m0 * m7 - m1 * m6);
  const c6 = m1 * m5 - m2 * m4;
  const c7 = -(m0 * m5 - m2 * m3);
  const c8 = m0 * m4 - m1 * m3;
  const det = m0 * c0 + m1 * c1 + m2 * c2;
  if (Math.abs(det) < 1e-12) return null;
  const inv = 1 / det;
  return new Float64Array([c0 * inv, c3 * inv, c6 * inv, c1 * inv, c4 * inv, c7 * inv, c2 * inv, c5 * inv, c8 * inv]);
}

function newInitialCov(posVar: number, velVar: number): Float64Array {
  const P = new Float64Array(36);
  for (let i = 0; i < 3; i++) P[i * 6 + i] = posVar;
  for (let i = 3; i < 6; i++) P[i * 6 + i] = velVar;
  return P;
}

export class KalmanHypothesis {
  state: Float64Array = new Float64Array(6);
  cov: Float64Array;
  lastTimestampMs: number | null = null;
  coastFrames = 0;
  samples: TrackSample[] = [];
  /** Parallel to `samples`. Kept out of the TrackSample contract; recomputed by the
   * pipeline from (detection, rangeM) whenever downstream code needs it, so this is
   * purely an internal bookkeeping convenience for arc/release-region gating. */
  worldPositions: Vec3[] = [];
  readonly id: string;

  constructor(id: string, initialPosition: Vec3, initTimeMs: number, initialVelocity: Vec3 = { x: 0, y: 0, z: 0 }) {
    this.id = id;
    this.state[0] = initialPosition.x;
    this.state[1] = initialPosition.y;
    this.state[2] = initialPosition.z;
    this.state[3] = initialVelocity.x;
    this.state[4] = initialVelocity.y;
    this.state[5] = initialVelocity.z;
    this.cov = newInitialCov(0.25, 400);
    this.lastTimestampMs = initTimeMs;
  }

  get position(): Vec3 {
    return { x: this.state[0], y: this.state[1], z: this.state[2] };
  }

  predict(nowMs: number, gravity: Vec3, sigmaA: number): void {
    if (this.lastTimestampMs === null) {
      this.lastTimestampMs = nowMs;
      return;
    }
    const dt = (nowMs - this.lastTimestampMs) / 1000;
    this.lastTimestampMs = nowMs;
    if (dt <= 0) return;

    const F = buildF(dt);
    const predicted = mat6MulVec(F, this.state);
    predicted[0] += 0.5 * gravity.x * dt * dt;
    predicted[1] += 0.5 * gravity.y * dt * dt;
    predicted[2] += 0.5 * gravity.z * dt * dt;
    predicted[3] += gravity.x * dt;
    predicted[4] += gravity.y * dt;
    predicted[5] += gravity.z * dt;
    this.state = predicted;

    const Q = buildQ(dt, sigmaA);
    const FP = mat6Mul(F, this.cov);
    this.cov = mat6Add(mat6Mul(FP, mat6Transpose(F)), Q);
  }

  private innovationCov(R: Mat3): Float64Array {
    const P = this.cov;
    return new Float64Array([
      P[0] + R[0], P[1] + R[1], P[2] + R[2],
      P[6] + R[3], P[7] + R[4], P[8] + R[5],
      P[12] + R[6], P[13] + R[7], P[14] + R[8],
    ]);
  }

  /** Mahalanobis distance to a candidate position, without mutating state. */
  gateDistance(z: Vec3, R: Mat3): number {
    const innov = [z.x - this.state[0], z.y - this.state[1], z.z - this.state[2]];
    const Sinv = invert3x3(this.innovationCov(R));
    if (!Sinv) return Infinity;
    let d2 = 0;
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) d2 += innov[i] * Sinv[i * 3 + j] * innov[j];
    return Math.sqrt(Math.max(d2, 0));
  }

  applyUpdate(z: Vec3, R: Mat3): void {
    const P = this.cov;
    const innov = [z.x - this.state[0], z.y - this.state[1], z.z - this.state[2]];
    const Sinv = invert3x3(this.innovationCov(R));
    if (!Sinv) return;

    const K = new Float64Array(18);
    for (let r = 0; r < 6; r++) {
      for (let c = 0; c < 3; c++) {
        let s = 0;
        for (let k = 0; k < 3; k++) s += P[r * 6 + k] * Sinv[k * 3 + c];
        K[r * 3 + c] = s;
      }
    }

    for (let r = 0; r < 6; r++) {
      this.state[r] += K[r * 3] * innov[0] + K[r * 3 + 1] * innov[1] + K[r * 3 + 2] * innov[2];
    }

    const newP = new Float64Array(36);
    for (let r = 0; r < 6; r++) {
      for (let j = 0; j < 6; j++) {
        let khp = 0;
        for (let k = 0; k < 3; k++) khp += K[r * 3 + k] * P[k * 6 + j];
        newP[r * 6 + j] = P[r * 6 + j] - khp;
      }
    }
    this.cov = newP;
  }
}

export interface PromotionOptions {
  pitchingDistanceFt: number;
}

function isPlausibleArc(h: KalmanHypothesis): boolean {
  const pos = h.worldPositions;
  const n = pos.length;
  if (n < 2) return false;
  const first = pos[0];
  const last = pos[n - 1];
  if (last.z - first.z <= 0.3) return false;

  let forwardSteps = 0;
  for (let i = 1; i < n; i++) if (pos[i].z >= pos[i - 1].z - 0.05) forwardSteps++;
  if (forwardSteps / (n - 1) < 0.7) return false;

  const t0 = h.samples[0].detection.timestampMs;
  const t1 = h.samples[n - 1].detection.timestampMs;
  const dt = (t1 - t0) / 1000;
  if (dt <= 0) return false;
  const speed = Math.hypot(last.x - first.x, last.y - first.y, last.z - first.z) / dt;
  return speed >= PHYSICS.MIN_SPEED_MPS * 0.7 && speed <= PHYSICS.MAX_SPEED_MPS * 1.3;
}

/** Ordinary least squares slope+intercept. Used to denoise the per-frame monocular jitter. */
function linearRegression(t: readonly number[], v: readonly number[]): { slope: number; intercept: number } {
  const n = t.length;
  let sumT = 0;
  let sumV = 0;
  let sumTT = 0;
  let sumTV = 0;
  for (let i = 0; i < n; i++) {
    sumT += t[i];
    sumV += v[i];
    sumTT += t[i] * t[i];
    sumTV += t[i] * v[i];
  }
  const denom = n * sumTT - sumT * sumT;
  if (Math.abs(denom) < 1e-9) return { slope: 0, intercept: sumV / n };
  const slope = (n * sumTV - sumT * sumV) / denom;
  const intercept = (sumV - slope * sumT) / n;
  return { slope, intercept };
}

/**
 * Backward-extrapolates to the plausible release z and checks the window.
 *
 * Fits a straight line through ALL of the track's samples (not just the first two
 * or three) before extrapolating: monocular depth-from-diameter quantizes hard at
 * long range -- a few consecutive frames can report an identical apparent diameter
 * -- so a local two-point finite difference on the earliest samples occasionally
 * measures a near-zero z-velocity and sends the backward extrapolation to
 * absurd times. Regressing over the whole track averages that quantization noise
 * out; by the time a hypothesis has MIN_DETECTIONS_FOR_PITCH samples this is stable.
 */
function originatesNearRelease(h: KalmanHypothesis, pitchingDistanceFt: number): boolean {
  const pos = h.worldPositions;
  const n = pos.length;
  if (n < 2) return false;
  const t0 = h.samples[0].detection.timestampMs;
  const tRel = h.samples.map((s) => (s.detection.timestampMs - t0) / 1000);

  const fx = linearRegression(tRel, pos.map((p) => p.x));
  const fy = linearRegression(tRel, pos.map((p) => p.y));
  const fz = linearRegression(tRel, pos.map((p) => p.z));
  if (fz.slope <= 0) return false;

  const targetZ = rubberZ(pitchingDistanceFt) + RELEASE.TYPICAL_STRIDE_M;
  const tRelease = (targetZ - fz.intercept) / fz.slope;
  const accelY = -PHYSICS.GRAVITY_MPS2;
  const releaseX = fx.intercept + fx.slope * tRelease;
  const releaseY = fy.intercept + fy.slope * tRelease + 0.5 * accelY * tRelease * tRelease;

  const lateralOk = Math.abs(releaseX) <= RELEASE.LATERAL_HALF_WINDOW_M * 2;
  const heightOk = releaseY >= RELEASE.MIN_HEIGHT_M * 0.4 && releaseY <= RELEASE.MAX_HEIGHT_M * 1.8;
  return lateralOk && heightOk;
}

export function isPromotable(h: KalmanHypothesis, opts: PromotionOptions): boolean {
  return (
    h.samples.length >= TRACKING.MIN_DETECTIONS_FOR_PITCH &&
    isPlausibleArc(h) &&
    originatesNearRelease(h, opts.pitchingDistanceFt)
  );
}

export function findPromotableTrack(
  hypotheses: readonly KalmanHypothesis[],
  opts: PromotionOptions,
): KalmanHypothesis | null {
  let best: KalmanHypothesis | null = null;
  for (const h of hypotheses) {
    if (!isPromotable(h, opts)) continue;
    if (!best || h.samples.length > best.samples.length) best = h;
  }
  return best;
}

export class TrackerManager {
  private hypotheses: KalmanHypothesis[] = [];
  /** Tracks that coasted out but were long enough to still be a completed pitch. */
  private retired: KalmanHypothesis[] = [];
  private nextId = 1;

  constructor(
    private readonly gravity: Vec3 = { x: 0, y: -PHYSICS.GRAVITY_MPS2, z: 0 },
    private readonly sigmaA: number = PHYSICS.MAX_AERO_ACCEL_MPS2,
  ) {}

  get all(): readonly KalmanHypothesis[] {
    return this.hypotheses;
  }

  reset(): void {
    this.hypotheses = [];
    this.retired = [];
    this.nextId = 1;
  }

  step(nowMs: number, observations: readonly WorldObservation[]): void {
    for (const h of this.hypotheses) h.predict(nowMs, this.gravity, this.sigmaA);

    const used = new Set<number>();
    const order = this.hypotheses
      .map((_, i) => i)
      .sort((i, j) => this.hypotheses[j].samples.length - this.hypotheses[i].samples.length);

    for (const hi of order) {
      const h = this.hypotheses[hi];
      let bestIdx = -1;
      let bestDist = Infinity;
      for (let oi = 0; oi < observations.length; oi++) {
        if (used.has(oi)) continue;
        const d = h.gateDistance(observations[oi].position, observations[oi].covariance);
        if (d < bestDist) {
          bestDist = d;
          bestIdx = oi;
        }
      }
      if (bestIdx >= 0 && bestDist <= TRACKING.ASSOCIATION_GATE_SIGMA) {
        const obs = observations[bestIdx];
        const weight = this.crossCheckWeight(h, obs);
        h.applyUpdate(obs.position, obs.covariance);
        h.samples.push({
          detection: weight === 1 ? obs.detection : { ...obs.detection, confidence: obs.detection.confidence * weight },
          rangeM: obs.rangeM,
          inlier: true,
        });
        h.worldPositions.push(obs.position);
        h.coastFrames = 0;
        used.add(bestIdx);
      } else {
        h.coastFrames++;
      }
    }

    // A track that coasts out is usually clutter, but it can also be a COMPLETED
    // pitch: the ball leaves the frame and the hypothesis starves. Dropping it
    // outright loses the pitch entirely. This is not hypothetical — the side cam,
    // where the ball exits laterally with frames still to come, built a clean
    // 24-sample track and then discarded it, which is why side-cam scenarios
    // reported 100% detection and no pitch at all. The plate cam masked the bug
    // because the ball flies at the lens and stays in frame to the last frame.
    //
    // So anything long enough to be a candidate is archived on the way out and
    // considered again at finish(); everything else is discarded as before.
    const survivors: KalmanHypothesis[] = [];
    for (const h of this.hypotheses) {
      if (h.coastFrames <= TRACKING.MAX_COAST_FRAMES) {
        survivors.push(h);
      } else if (h.samples.length >= TRACKING.MIN_DETECTIONS_FOR_PITCH) {
        this.retired.push(h);
      }
    }
    this.hypotheses = survivors;

    for (let oi = 0; oi < observations.length; oi++) {
      if (used.has(oi)) continue;
      if (this.hypotheses.length >= TRACKING.MAX_ACTIVE_HYPOTHESES) this.evictWeakest();
      if (this.hypotheses.length < TRACKING.MAX_ACTIVE_HYPOTHESES) {
        this.hypotheses.push(this.spawn(observations[oi], nowMs));
      }
    }
  }

  findPromoted(pitchingDistanceFt: number = DEFAULT_PITCHING_DISTANCE_FT): KalmanHypothesis | null {
    return findPromotableTrack([...this.hypotheses, ...this.retired], { pitchingDistanceFt });
  }

  private crossCheckWeight(h: KalmanHypothesis, obs: WorldObservation): number {
    if (h.worldPositions.length === 0 || obs.detection.streakSpeedMps == null) return 1;
    const prevPos = h.worldPositions[h.worldPositions.length - 1];
    const prevT = h.samples[h.samples.length - 1].detection.timestampMs;
    const dt = (obs.detection.timestampMs - prevT) / 1000;
    if (dt <= 0) return 1;
    const disp = Math.hypot(obs.position.x - prevPos.x, obs.position.y - prevPos.y, obs.position.z - prevPos.z) / dt;
    const streak = obs.detection.streakSpeedMps;
    const ratio = Math.min(disp, streak) / Math.max(disp, streak, 1e-6);
    const minRatio = 1 - TRACKING.SPEED_CROSSCHECK_TOLERANCE;
    return ratio >= minRatio ? 1 : Math.max(0.2, ratio / minRatio);
  }

  private evictWeakest(): void {
    if (this.hypotheses.length === 0) return;
    let worst = 0;
    for (let i = 1; i < this.hypotheses.length; i++) {
      if (this.hypotheses[i].samples.length < this.hypotheses[worst].samples.length) worst = i;
    }
    this.hypotheses.splice(worst, 1);
  }

  private spawn(obs: WorldObservation, nowMs: number): KalmanHypothesis {
    const h = new KalmanHypothesis(`h${this.nextId++}`, obs.position, nowMs);
    h.samples.push({ detection: obs.detection, rangeM: obs.rangeM, inlier: true });
    h.worldPositions.push(obs.position);
    return h;
  }
}
