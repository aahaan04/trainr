/**
 * The regression metrics from Section 15, computed against synthetic ground truth.
 *
 * This file also defines the PIPELINE ADAPTER: the single interface the vision and
 * fusion workstreams must satisfy for the regression suite to grade them. Keeping
 * it here rather than inside either workstream means neither one can quietly change
 * the shape it is measured on.
 */

import { ACCEPTANCE, BALL, PLATE, ZONE_RULES } from '@/domain/constants';
import type { BallDetection, FittedTrajectory, PitchCall, StrikeZone, Vec3 } from '@/domain/types';
import type { BuiltScenario } from './scenarios';
import type { SyntheticFrame } from './render';

/**
 * What a pipeline must expose to be graded. A real implementation wraps its worker;
 * the suite drives it frame by frame in order, exactly as the live app does.
 */
export interface PipelineAdapter {
  /** Called once before frames, with the camera parameters the scenario used. */
  reset(scenario: BuiltScenario): void | Promise<void>;
  /** Called per frame in order. Returns the detections accepted for that frame. */
  pushFrame(frame: SyntheticFrame): BallDetection[] | Promise<BallDetection[]>;
  /**
   * Called after the last frame. Returns the pitch the pipeline believes it saw, or
   * null. Returning a pitch for the `no-pitch-clutter-only` scenario is a false positive.
   */
  finish(): Promise<{ trajectory: FittedTrajectory; call: PitchCall } | null>;
}

export interface DetectionMetrics {
  /** Frames where the ball was genuinely visible and unoccluded. */
  visibleFrames: number;
  /** Of those, how many produced a detection within tolerance of ground truth. */
  hitFrames: number;
  detectionRate: number;
  /** Detections that landed nowhere near the real ball. */
  falseDetections: number;
  /** RMS centroid error in pixels, over hit frames. */
  centroidRmsPx: number;
  /** RMS error of the minor-axis estimate against the true ball diameter. */
  diameterRmsPx: number;
}

/** A detection counts as a hit if its centroid is within one ball diameter of truth. */
export function scoreDetections(
  frames: SyntheticFrame[],
  detectionsByFrame: BallDetection[][],
): DetectionMetrics {
  let visibleFrames = 0;
  let hitFrames = 0;
  let falseDetections = 0;
  let centroidSq = 0;
  let diameterSq = 0;
  let diameterN = 0;

  frames.forEach((frame, i) => {
    const truth = frame.truth;
    const dets = detectionsByFrame[i] ?? [];
    if (!truth || !truth.visible) {
      falseDetections += dets.length;
      return;
    }
    visibleFrames++;
    const tolerance = Math.max(truth.diameterPx, 6) + truth.streakPx * 0.5;

    let best: BallDetection | null = null;
    let bestD = Infinity;
    for (const d of dets) {
      const dist = Math.hypot(d.centroid.x - truth.pixel.x, d.centroid.y - truth.pixel.y);
      if (dist < bestD) {
        bestD = dist;
        best = d;
      }
    }
    if (best && bestD <= tolerance) {
      hitFrames++;
      centroidSq += bestD * bestD;
      const dErr = best.minorAxisPx - truth.diameterPx;
      diameterSq += dErr * dErr;
      diameterN++;
      falseDetections += dets.length - 1;
    } else {
      falseDetections += dets.length;
    }
  });

  return {
    visibleFrames,
    hitFrames,
    detectionRate: visibleFrames ? hitFrames / visibleFrames : 0,
    falseDetections,
    centroidRmsPx: hitFrames ? Math.sqrt(centroidSq / hitFrames) : Infinity,
    diameterRmsPx: diameterN ? Math.sqrt(diameterSq / diameterN) : Infinity,
  };
}

export interface TrajectoryMetrics {
  /** Euclidean error at the plate's front edge, in metres. */
  frontCrossingErrorM: number;
  backCrossingErrorM: number;
  releaseSpeedErrorMps: number;
  plateSpeedErrorMps: number;
}

/** Position where a fitted trajectory crosses a z plane, by bisection on the model. */
export function fittedCrossing(traj: FittedTrajectory, planeZ: number): { tS: number; p: Vec3 } | null {
  const zAt = (t: number) => traj.p0.z + traj.v0.z * t + 0.5 * traj.a.z * t * t;
  let lo = traj.tStartS;
  let hi = traj.tEndS;
  if ((zAt(lo) - planeZ) * (zAt(hi) - planeZ) > 0) {
    // Plane is outside the fitted span; extrapolate a little rather than give up,
    // since the fit often ends a frame or two short of the back point.
    hi = traj.tEndS + 0.15;
    if ((zAt(lo) - planeZ) * (zAt(hi) - planeZ) > 0) return null;
  }
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if ((zAt(lo) - planeZ) * (zAt(mid) - planeZ) <= 0) hi = mid;
    else lo = mid;
  }
  const t = (lo + hi) / 2;
  return {
    tS: t,
    p: {
      x: traj.p0.x + traj.v0.x * t + 0.5 * traj.a.x * t * t,
      y: traj.p0.y + traj.v0.y * t + 0.5 * traj.a.y * t * t,
      z: planeZ,
    },
  };
}

export function scoreTrajectory(built: BuiltScenario, traj: FittedTrajectory): TrajectoryMetrics {
  const gt = built.groundTruth;
  const dist = (a: Vec3, b: Vec3) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

  const front = fittedCrossing(traj, PLATE.FRONT_Z_M);
  const back = fittedCrossing(traj, PLATE.BACK_Z_M);

  const speedAt = (t: number) =>
    Math.hypot(
      traj.v0.x + traj.a.x * t,
      traj.v0.y + traj.a.y * t,
      traj.v0.z + traj.a.z * t,
    );

  return {
    frontCrossingErrorM:
      front && gt.crossings.front ? dist(front.p, gt.crossings.front.position) : Infinity,
    backCrossingErrorM: back && gt.crossings.back ? dist(back.p, gt.crossings.back.position) : Infinity,
    releaseSpeedErrorMps: Math.abs(speedAt(traj.tStartS) - gt.releaseSpeedMps),
    plateSpeedErrorMps:
      back && gt.crossings.back ? Math.abs(speedAt(back.tS) - gt.crossings.back.speedMps) : Infinity,
  };
}

// ---------------------------------------------------------------------------
// Reference call, computed from exact ground truth. This is the "manual frame-by-
// frame review" the acceptance criteria compare against, but exact rather than
// hand-annotated, which makes it a strictly harder standard.
// ---------------------------------------------------------------------------

export interface ReferenceCall {
  result: 'strike' | 'ball';
  strikePlane: 'front' | 'back' | null;
  /** Signed distance to the nearest inflated-zone edge; negative is inside. */
  marginM: number;
  /** Within BORDERLINE_MARGIN_M of an edge, i.e. the hard cases. */
  borderline: boolean;
}

/**
 * The rule that matters: a strike if ANY PART of the ball touches ANY PART of the
 * zone over ANY PART of the plate. Implemented as the ball CENTRE against a zone
 * inflated by one ball radius, evaluated at BOTH plate planes.
 */
export function evaluateZone(centre: Vec3, zone: StrikeZone): { inside: boolean; marginM: number } {
  const halfW = zone.halfWidthM + ZONE_RULES.INFLATION_M;
  const bottom = zone.bottomM - ZONE_RULES.INFLATION_M;
  const top = zone.topM + ZONE_RULES.INFLATION_M;

  // Signed distance to the box boundary: negative inside, positive outside.
  const dx = Math.abs(centre.x) - halfW;
  const dy = Math.max(bottom - centre.y, centre.y - top);
  const outside = dx > 0 || dy > 0;
  const marginM = outside
    ? Math.hypot(Math.max(dx, 0), Math.max(dy, 0))
    : Math.max(dx, dy);
  return { inside: !outside, marginM };
}

export function referenceCall(built: BuiltScenario, zone: StrikeZone): ReferenceCall {
  const planes: ('front' | 'back')[] = ['front', 'back'];
  let best: ReferenceCall = { result: 'ball', strikePlane: null, marginM: Infinity, borderline: false };

  for (const plane of planes) {
    const c = built.groundTruth.crossings[plane];
    if (!c) continue;
    const { inside, marginM } = evaluateZone(c.position, zone);
    // Keep whichever plane is most favourable to a strike.
    if (marginM < best.marginM) {
      best = {
        result: inside ? 'strike' : 'ball',
        strikePlane: inside ? plane : null,
        marginM,
        borderline: Math.abs(marginM) <= ACCEPTANCE.BORDERLINE_MARGIN_M,
      };
    }
  }
  return best;
}

/** A default zone for a 5'6" batter, used when a scenario does not specify one. */
export function defaultTestZone(): StrikeZone {
  return {
    ruleSet: 'ncaa',
    bottomM: 0.444,
    topM: 1.146,
    halfWidthM: PLATE.HALF_WIDTH_M,
    source: 'default',
    frozenAtMs: 0,
    approximate: true,
  };
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

export interface ScenarioReport {
  scenarioId: string;
  detection: DetectionMetrics;
  trajectory: TrajectoryMetrics | null;
  callAgreed: boolean | null;
  borderline: boolean;
  promoted: boolean;
  notes: string[];
}

export function formatReport(reports: ScenarioReport[]): string {
  const lines = ['scenario                     det%   cent_px  front_in  velo_mph  call'];
  for (const r of reports) {
    const det = (r.detection.detectionRate * 100).toFixed(0).padStart(4);
    const cent = r.detection.centroidRmsPx.toFixed(1).padStart(7);
    const front = r.trajectory ? (r.trajectory.frontCrossingErrorM / 0.0254).toFixed(2).padStart(8) : '       -';
    const velo = r.trajectory ? (r.trajectory.releaseSpeedErrorMps / 0.44704).toFixed(2).padStart(8) : '       -';
    const call = r.callAgreed === null ? '  -' : r.callAgreed ? ' ok' : 'MISS';
    lines.push(`${r.scenarioId.padEnd(28)}${det}  ${cent}  ${front}  ${velo}  ${call}`);
  }
  return lines.join('\n');
}

export const THRESHOLDS = ACCEPTANCE;
export const BALL_DIAMETER_M = BALL.DIAMETER_M;
