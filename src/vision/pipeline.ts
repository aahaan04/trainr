/**
 * Orchestrates segmentation -> blob extraction -> multi-hypothesis tracking ->
 * trajectory fit into the single class the regression harness drives frame by
 * frame, and that src/workers/visionWorker.ts wraps for the live app.
 *
 * THE WS4 SEAM: turning one camera's 2D detection + monocular depth into a 3D world
 * position is `Reconstruct3DFn`. The default, `monocularReconstruct3D`, is the only
 * option with one camera: it backs a ray through the detection's centroid out to
 * the depth implied by the ball's apparent diameter. WS4's two-camera triangulation
 * plugs in by passing a different `reconstruct3D` to the constructor -- same
 * signature, free to ignore `depthM` and instead consult the other camera's
 * simultaneous detection. Every call site that needs a world position (per-frame
 * tracking AND the final trajectory fit) goes through `this.reconstruct3D`, so a
 * WS4 override changes both uniformly.
 */

import {
  BALL,
  DEFAULT_BATTER_HEIGHT_M,
  DEFAULT_PITCHING_DISTANCE_FT,
  DEFAULT_RULE_SET,
  HSV_GATE_SEED,
  PLATE,
  TRACKING,
  ZONE_RULES,
  confidenceBand,
  zoneFromHeight,
} from '@/domain/constants';
import type {
  BallDetection,
  CameraExtrinsics,
  CameraIntrinsics,
  CameraRole,
  FittedTrajectory,
  HsvGate,
  PitchCall,
  PlateCrossing,
  PlatePlane,
  StrikeZone,
  Vec3,
} from '@/domain/types';
import { trajectoryPosition, trajectoryVelocity } from '@/domain/types';
import { cameraCenter, depthFromDiameterPx, matTransposeMulVec, rodriguesToMatrix, unprojectRay } from './camera';
import { DEFAULT_BLOB_GATE, BlobExtractor, fitRotatedRect, gateBlobs, type RawBlob } from './blobs';
import { createSegmenter, hueGateOk, rgbToHsvOpenCv, type Segmenter } from './segmentation';
import { KalmanHypothesis, TrackerManager, type WorldObservation } from './tracker';
import { fitTrajectory, type TimedPosition } from './trajectory';

export interface PipelineCameraConfig {
  intrinsics: CameraIntrinsics;
  extrinsics: CameraExtrinsics;
}

export interface Reconstruct3DContext {
  intrinsics: CameraIntrinsics;
  extrinsics: CameraExtrinsics;
  /** Camera-frame depth implied by the detection's apparent diameter. */
  depthM: number;
}

/** A reconstructed world position plus how much to trust it, per axis. */
export interface Reconstruction {
  position: Vec3;
  /** 3x3 row-major world-space covariance of `position`, in metres^2. */
  covariance: readonly [number, number, number, number, number, number, number, number, number];
}

export type Reconstruct3DFn = (detection: BallDetection, ctx: Reconstruct3DContext) => Reconstruction;

/** One pixel of measurement noise, in full-resolution pixels, for each geometry channel. */
const AXIS_PX_SIGMA = 3;
const CENTROID_PX_SIGMA = 1.5;
const MIN_RADIAL_SIGMA_M = 0.05;
const MIN_LATERAL_SIGMA_M = 0.02;

function outer3(a: Vec3, s: number): [number, number, number, number, number, number, number, number, number] {
  return [s * a.x * a.x, s * a.x * a.y, s * a.x * a.z, s * a.y * a.x, s * a.y * a.y, s * a.y * a.z, s * a.z * a.x, s * a.z * a.y, s * a.z * a.z];
}

function addMat9(
  a: readonly [number, number, number, number, number, number, number, number, number],
  b: readonly [number, number, number, number, number, number, number, number, number],
): [number, number, number, number, number, number, number, number, number] {
  return [a[0]+b[0], a[1]+b[1], a[2]+b[2], a[3]+b[3], a[4]+b[4], a[5]+b[5], a[6]+b[6], a[7]+b[7], a[8]+b[8]];
}

/**
 * Monocular depth-from-diameter is precise laterally (the centroid pins x/y well)
 * but poor along the viewing ray: at typical plate-cam ranges the ball is only a
 * handful of pixels wide even before the half-resolution mask downsamples it
 * further, so a single pixel of rotated-rect noise swings the depth estimate by a
 * large fraction of a metre. Modeling that as an ANISOTROPIC covariance -- tight
 * across the ray, loose along it -- is what lets the Kalman gate accept a real
 * track's noisy-but-correct depth jumps while still rejecting a lateral outlier
 * (e.g. a piece of clutter at a similar depth but the wrong x/y).
 */
function anisotropicCovariance(ray: Vec3, sigmaRadial: number, sigmaLateral: number): readonly [number, number, number, number, number, number, number, number, number] {
  const helper: Vec3 = Math.abs(ray.y) < 0.9 ? { x: 0, y: 1, z: 0 } : { x: 1, y: 0, z: 0 };
  let u: Vec3 = {
    x: ray.y * helper.z - ray.z * helper.y,
    y: ray.z * helper.x - ray.x * helper.z,
    z: ray.x * helper.y - ray.y * helper.x,
  };
  const un = Math.hypot(u.x, u.y, u.z) || 1;
  u = { x: u.x / un, y: u.y / un, z: u.z / un };
  const v: Vec3 = {
    x: ray.y * u.z - ray.z * u.y,
    y: ray.z * u.x - ray.x * u.z,
    z: ray.x * u.y - ray.y * u.x,
  };
  const radial = outer3(ray, sigmaRadial * sigmaRadial);
  const lat1 = outer3(u, sigmaLateral * sigmaLateral);
  const lat2 = outer3(v, sigmaLateral * sigmaLateral);
  return addMat9(addMat9(radial, lat1), lat2);
}

/** The monocular default: back-project the centroid to the depth implied by ball size. */
export function monocularReconstruct3D(detection: BallDetection, ctx: Reconstruct3DContext): Reconstruction {
  const { intrinsics, extrinsics, depthM } = ctx;
  const ray = unprojectRay(intrinsics, extrinsics, detection.centroid);
  const R = rodriguesToMatrix(extrinsics.rvec);
  const opticalAxisWorld = matTransposeMulVec(R, { x: 0, y: 0, z: 1 });
  const cosTheta = ray.x * opticalAxisWorld.x + ray.y * opticalAxisWorld.y + ray.z * opticalAxisWorld.z;
  const distance = depthM / Math.max(cosTheta, 1e-6);
  const center = cameraCenter(extrinsics);
  const position: Vec3 = {
    x: center.x + ray.x * distance,
    y: center.y + ray.y * distance,
    z: center.z + ray.z * distance,
  };

  const sigmaRadial = Math.max(MIN_RADIAL_SIGMA_M, (depthM * AXIS_PX_SIGMA) / Math.max(detection.minorAxisPx, 3));
  const sigmaLateral = Math.max(MIN_LATERAL_SIGMA_M, (depthM * CENTROID_PX_SIGMA) / intrinsics.fx);
  const covariance = anisotropicCovariance(ray, sigmaRadial, sigmaLateral);

  return { position, covariance };
}

export interface DecodedFrame {
  index: number;
  timestampMs: number;
  width: number;
  height: number;
  /** Seconds. Needed for the streak-length velocity cue. */
  exposureS: number;
  data: Uint8ClampedArray;
}

/**
 * Re-measures a gated candidate's axes on the FULL-RESOLUTION frame.
 *
 * Segmentation runs at half resolution for speed, which is fine for finding the
 * ball but not for measuring it. At release range the ball is only ~8 px across at
 * 720p, so ~4 px on the half-res mask, and thresholding erodes the dim blurred rim
 * below the gate. The minor axis then reads short, and since depth goes as
 * fx*D/minorAxis, depth reads LONG — worst exactly where the ball is smallest.
 *
 * Measured consequence before this refinement: a 62 mph fastball reconstructed over
 * a z span of -16.8 m to +1.9 m instead of the true -11.3 m to 0, which inflated
 * release speed to ~96 mph and pushed the rise ball past the tracker's plausible-
 * speed gate so it never promoted. The error is not a constant scale factor, it
 * grows with range, so it cannot be calibrated out with a fixed correction.
 *
 * Only the handful of blobs that already survived gating are re-measured, over
 * their own bounding box, so this costs a fraction of a full-frame pass.
 */
function refineAxesAtFullRes(
  frame: DecodedFrame,
  b: RawBlob,
  downscale: number,
  gate: HsvGate,
): { minorAxisPx: number; majorAxisPx: number } | null {
  const pad = Math.max(2, Math.ceil(b.majorAxisPx * 0.5)) * downscale;
  const cx = b.centroidX * downscale;
  const cy = b.centroidY * downscale;
  const half = (b.majorAxisPx * downscale) / 2 + pad;

  const x0 = Math.max(0, Math.floor(cx - half));
  const x1 = Math.min(frame.width - 1, Math.ceil(cx + half));
  const y0 = Math.max(0, Math.floor(cy - half));
  const y1 = Math.min(frame.height - 1, Math.ceil(cy + half));
  if (x1 <= x0 || y1 <= y0) return null;

  const pts: { x: number; y: number }[] = [];
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const i = (y * frame.width + x) * 4;
      const [h, s, v] = rgbToHsvOpenCv(frame.data[i], frame.data[i + 1], frame.data[i + 2]);
      if (hueGateOk(gate, h, s, v)) pts.push({ x, y });
    }
  }
  if (pts.length < 4) return null;

  const fit = fitRotatedRect(pts);
  return { minorAxisPx: fit.minorAxisPx, majorAxisPx: fit.majorAxisPx };
}

export interface PipelineOptions {
  hsvGate?: HsvGate;
  pitchingDistanceFt?: number;
  zone?: StrikeZone;
  reconstruct3D?: Reconstruct3DFn;
  role?: CameraRole;
  segmenter?: Segmenter;
}

function clamp01(x: number): number {
  return Math.min(1, Math.max(0, x));
}

function blobConfidence(b: RawBlob): number {
  const fillScore = clamp01((b.fillRatio - DEFAULT_BLOB_GATE.minFillRatio) / (1 - DEFAULT_BLOB_GATE.minFillRatio));
  const hueScore = clamp01(1 - b.hueVariance / DEFAULT_BLOB_GATE.maxHueVariance);
  const aspect = b.majorAxisPx / Math.max(b.minorAxisPx, 1e-6);
  const aspectScore = clamp01(1 - aspect / (DEFAULT_BLOB_GATE.maxAspectRatio * 1.5));
  return clamp01(0.3 + 0.35 * fillScore + 0.2 * hueScore + 0.15 * aspectScore);
}

function defaultZone(): StrikeZone {
  const { bottomM, topM } = zoneFromHeight(DEFAULT_BATTER_HEIGHT_M, DEFAULT_RULE_SET);
  return {
    ruleSet: DEFAULT_RULE_SET,
    bottomM,
    topM,
    halfWidthM: PLATE.HALF_WIDTH_M,
    source: 'default',
    frozenAtMs: 0,
    approximate: true,
    batterHeightM: DEFAULT_BATTER_HEIGHT_M,
  };
}

/** Same rule ZONE_RULES documents: ball centre vs. a zone box inflated by one ball radius. */
function evaluateZoneLocal(centre: Vec3, zone: StrikeZone): { inside: boolean; marginM: number } {
  const halfW = zone.halfWidthM + ZONE_RULES.INFLATION_M;
  const bottom = zone.bottomM - ZONE_RULES.INFLATION_M;
  const top = zone.topM + ZONE_RULES.INFLATION_M;
  const dx = Math.abs(centre.x) - halfW;
  const dy = Math.max(bottom - centre.y, centre.y - top);
  const outside = dx > 0 || dy > 0;
  const marginM = outside ? Math.hypot(Math.max(dx, 0), Math.max(dy, 0)) : Math.max(dx, dy);
  return { inside: !outside, marginM };
}

export class VisionPipeline {
  private gate: HsvGate;
  private pitchingDistanceFt: number;
  private zone: StrikeZone;
  private reconstruct3D: Reconstruct3DFn;
  private role: CameraRole;
  private segmenter: Segmenter;
  private blobExtractor = new BlobExtractor();
  private tracker = new TrackerManager();
  private cam: PipelineCameraConfig | null = null;

  constructor(opts: PipelineOptions = {}) {
    this.gate = opts.hsvGate ?? HSV_GATE_SEED;
    this.pitchingDistanceFt = opts.pitchingDistanceFt ?? DEFAULT_PITCHING_DISTANCE_FT;
    this.zone = opts.zone ?? defaultZone();
    this.reconstruct3D = opts.reconstruct3D ?? monocularReconstruct3D;
    this.role = opts.role ?? 'plate';
    this.segmenter = opts.segmenter ?? createSegmenter({ gate: this.gate });
  }

  /** Matches PipelineAdapter.reset(scenario) structurally: scenario carries intrinsics/extrinsics. */
  reset(config: PipelineCameraConfig): void {
    this.cam = { intrinsics: config.intrinsics, extrinsics: config.extrinsics };
    this.segmenter.reset();
    this.tracker.reset();
  }

  pushFrame(frame: DecodedFrame): BallDetection[] {
    if (!this.cam) throw new Error('VisionPipeline.reset must be called before pushFrame');
    const cam = this.cam;

    const seg = this.segmenter.process(frame);
    const rawBlobs = this.blobExtractor.extract(seg.mask, seg.hue, seg.maskWidth, seg.maskHeight);
    const candidates = gateBlobs(rawBlobs);
    const downscale = frame.width / seg.maskWidth;

    const detections: BallDetection[] = [];
    const observations: WorldObservation[] = [];

    for (const b of candidates) {
      const refined = refineAxesAtFullRes(frame, b, downscale, this.gate);
      const minorAxisPx = refined ? refined.minorAxisPx : b.minorAxisPx * downscale;
      const majorAxisPx = refined ? refined.majorAxisPx : b.majorAxisPx * downscale;
      const centroid = { x: b.centroidX * downscale, y: b.centroidY * downscale };
      const rangeM = depthFromDiameterPx(cam.intrinsics, BALL.DIAMETER_M, minorAxisPx);
      const metersPerPixel = rangeM / cam.intrinsics.fx;
      const streakSpeedMps = frame.exposureS > 1e-6 ? (majorAxisPx * metersPerPixel) / frame.exposureS : null;

      const detection: BallDetection = {
        role: this.role,
        frameIndex: frame.index,
        timestampMs: frame.timestampMs,
        centroid,
        minorAxisPx,
        majorAxisPx,
        angleRad: b.angleRad,
        areaPx: b.areaPx * downscale * downscale,
        meanHue: b.meanHue,
        hueVariance: b.hueVariance,
        streakSpeedMps,
        confidence: blobConfidence(b),
      };
      detections.push(detection);

      const { position, covariance } = this.reconstruct3D(detection, {
        intrinsics: cam.intrinsics,
        extrinsics: cam.extrinsics,
        depthM: rangeM,
      });
      observations.push({ detection, position, rangeM, covariance });
    }

    this.tracker.step(frame.timestampMs, observations);
    return detections;
  }

  async finish(): Promise<{ trajectory: FittedTrajectory; call: PitchCall } | null> {
    if (!this.cam) return null;
    const promoted = this.tracker.findPromoted(this.pitchingDistanceFt);
    if (!promoted) return null;
    const cam = this.cam;

    const t0Ms = promoted.samples[0].detection.timestampMs;
    const timed: TimedPosition[] = promoted.samples.map((s) => ({
      tS: (s.detection.timestampMs - t0Ms) / 1000,
      position: this.reconstruct3D(s.detection, {
        intrinsics: cam.intrinsics,
        extrinsics: cam.extrinsics,
        depthM: s.rangeM ?? 0,
      }).position,
      weight: s.detection.confidence,
    }));

    let fit;
    try {
      fit = fitTrajectory(timed, t0Ms, 1);
    } catch {
      return null;
    }

    return { trajectory: fit.trajectory, call: this.buildCall(fit.trajectory, promoted) };
  }

  private computeCrossing(traj: FittedTrajectory, plane: PlatePlane, planeZ: number): PlateCrossing | null {
    const zAt = (t: number) => trajectoryPosition(traj, t).z;
    let lo = traj.tStartS;
    let hi = traj.tEndS;
    if ((zAt(lo) - planeZ) * (zAt(hi) - planeZ) > 0) {
      hi = traj.tEndS + 0.2;
      if ((zAt(lo) - planeZ) * (zAt(hi) - planeZ) > 0) return null;
    }
    for (let i = 0; i < 60; i++) {
      const mid = (lo + hi) / 2;
      if ((zAt(lo) - planeZ) * (zAt(mid) - planeZ) <= 0) hi = mid;
      else lo = mid;
    }
    const t = (lo + hi) / 2;
    const position = trajectoryPosition(traj, t);
    const velocity = trajectoryVelocity(traj, t);
    const speedMps = Math.hypot(velocity.x, velocity.y, velocity.z);
    const { inside, marginM } = evaluateZoneLocal(position, this.zone);
    return { plane, position, timestampMs: traj.t0Ms + t * 1000, speedMps, isStrike: inside, marginM };
  }

  private overallConfidence(traj: FittedTrajectory, promoted: KalmanHypothesis): number {
    const inlierRatio = traj.inlierCount / Math.max(traj.sampleCount, 1);
    const residualScore = clamp01(1 - traj.residualM / 0.3);
    const avgDetConfidence =
      promoted.samples.reduce((sum, s) => sum + s.detection.confidence, 0) / Math.max(promoted.samples.length, 1);
    const countScore = clamp01((promoted.samples.length - TRACKING.MIN_DETECTIONS_FOR_PITCH) / TRACKING.MIN_DETECTIONS_FOR_PITCH / 2);
    return clamp01(0.15 + inlierRatio * 0.25 + residualScore * 0.2 + avgDetConfidence * 0.3 + countScore * 0.1);
  }

  private buildCall(traj: FittedTrajectory, promoted: KalmanHypothesis): PitchCall {
    const lastPos = trajectoryPosition(traj, traj.tEndS);
    const lastVel = trajectoryVelocity(traj, traj.tEndS);
    const fallback: PlateCrossing = {
      plane: 'back',
      position: lastPos,
      timestampMs: traj.t0Ms + traj.tEndS * 1000,
      speedMps: Math.hypot(lastVel.x, lastVel.y, lastVel.z),
      isStrike: false,
      marginM: Infinity,
    };
    const front = this.computeCrossing(traj, 'front', PLATE.FRONT_Z_M) ?? fallback;
    const back = this.computeCrossing(traj, 'back', PLATE.BACK_Z_M) ?? fallback;

    const isStrike = front.isStrike || back.isStrike;
    const strikePlane: PlatePlane | null = front.isStrike ? 'front' : back.isStrike ? 'back' : null;
    const confidence = this.overallConfidence(traj, promoted);
    const band = confidenceBand(confidence);
    const caveats: string[] = [];
    if (traj.cameraCount === 1) caveats.push('Single-camera trajectory: break and release figures are approximate.');
    if (band !== 'confident') caveats.push('Detection confidence is reduced for this pitch; treat the call as provisional.');

    return { result: isStrike ? 'strike' : 'ball', strikePlane, front, back, confidence, band, caveats };
  }
}
