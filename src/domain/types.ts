/**
 * Shared type contracts. These are the interfaces between workstreams; every
 * module reads and writes these shapes rather than inventing its own.
 *
 * Data flow:
 *
 *   capture/calibration  ->  CameraCalibration, HsvGate, StrikeZone, FramePacket
 *   vision/tracking      ->  BallDetection[] per frame, then PitchTrack on promotion
 *   geometry/fusion      ->  FittedTrajectory, PlateCrossing, PitchCall, PitchMeasurements
 *   classification/stats ->  PitchPrediction, session aggregates
 *   ui                   ->  renders all of the above
 *
 * All world-space quantities are in the frame documented at the top of constants.ts:
 * origin at the plate's back point, +X to first base, +Y up, +Z away from the pitcher.
 */

import type {
  CameraRole,
  ConfidenceBand,
  Handedness,
  HsvGate,
  PitchTypeId,
  PlateCornerName,
  PlatePlane,
  RuleSetId,
} from './constants';

export type { CameraRole, ConfidenceBand, Handedness, HsvGate, PitchTypeId, PlateCornerName, PlatePlane, RuleSetId };

// ---------------------------------------------------------------------------
// Geometry primitives
// ---------------------------------------------------------------------------

export type Vec2 = { x: number; y: number };
export type Vec3 = { x: number; y: number; z: number };

/** Row-major 3x3. */
export type Mat3 = readonly [number, number, number, number, number, number, number, number, number];

// ---------------------------------------------------------------------------
// Camera
// ---------------------------------------------------------------------------

export interface CameraIntrinsics {
  /** Focal lengths in pixels. */
  fx: number;
  fy: number;
  /** Principal point in pixels. */
  cx: number;
  cy: number;
  /** Single radial distortion coefficient. Most webcams need nothing more. */
  k1: number;
  width: number;
  height: number;
}

export interface CameraExtrinsics {
  /** Rodrigues rotation vector, world -> camera. */
  rvec: readonly [number, number, number];
  /** Translation, world -> camera, in metres. */
  tvec: readonly [number, number, number];
}

export interface CameraCalibration {
  role: CameraRole;
  intrinsics: CameraIntrinsics;
  extrinsics: CameraExtrinsics;
  /** Tapped image-space plate corners that produced this solve. */
  tappedCorners: Record<PlateCornerName, Vec2>;
  /** RMS reprojection error in pixels. Above threshold the user must recalibrate. */
  reprojectionErrorPx: number;
  /** Camera centre in world metres, derived from extrinsics. Cached for convenience. */
  positionWorld: Vec3;
  calibratedAt: number;
}

export interface CameraSetupRecord {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  pitchingDistanceFt: number;
  cameras: Partial<Record<CameraRole, CameraCalibration>>;
  hsvGate: HsvGate;
  /** Background and off-target yellows sampled during calibration, as a penalty model. */
  negativeColorSamples: readonly HsvGate[];
  notes?: string;
}

// ---------------------------------------------------------------------------
// Frames and detections
// ---------------------------------------------------------------------------

export interface FramePacket {
  role: CameraRole;
  /** Monotonic frame index within the session. */
  index: number;
  /** requestVideoFrameCallback mediaTime, in seconds. */
  mediaTime: number;
  /** Host-clock timestamp in ms, already corrected for cross-device offset. */
  timestampMs: number;
  width: number;
  height: number;
  /** Exposure in seconds, measured or assumed. Needed for streak-length velocity. */
  exposureS: number;
  bitmap: ImageBitmap;
}

/**
 * A single blob accepted as a candidate ball in one frame of one camera.
 *
 * IMPORTANT: at 60 mph with a 1/60 s exposure the ball travels ~4.6 diameters per
 * frame, so it images as a STREAK, not a circle. `minorAxisPx` is the true ball
 * diameter and is what depth estimation uses. `majorAxisPx` is the blur streak and
 * is a velocity cue. Never gate candidates on circularity.
 */
export interface BallDetection {
  role: CameraRole;
  frameIndex: number;
  timestampMs: number;
  /** Blob centroid in full-resolution image pixels. */
  centroid: Vec2;
  /** Minor axis of the min-area rotated rect. Approximates the true ball diameter. */
  minorAxisPx: number;
  /** Major axis. Blur streak length, not the ball. */
  majorAxisPx: number;
  /** Streak orientation in radians, image space. */
  angleRad: number;
  areaPx: number;
  meanHue: number;
  hueVariance: number;
  /** Speed implied by streak length and exposure, in m/s. Cross-checked against displacement. */
  streakSpeedMps: number | null;
  confidence: number;
}

/** The minimal payload the secondary device sends over the data channel. A few hundred bytes per pitch. */
export interface RemoteDetectionPacket {
  t: number;
  x: number;
  y: number;
  m: number;
  c: number;
}

// ---------------------------------------------------------------------------
// Tracking
// ---------------------------------------------------------------------------

export interface TrackSample {
  detection: BallDetection;
  /** Depth estimate from apparent size, in metres from the camera. Null before promotion. */
  rangeM: number | null;
  /** Whether the fit kept this sample or rejected it as an outlier. */
  inlier: boolean;
}

export interface PitchTrack {
  id: string;
  role: CameraRole;
  samples: TrackSample[];
  startedAtMs: number;
  endedAtMs: number;
  /** Set once the track is promoted from candidate to pitch. */
  promoted: boolean;
}

/**
 * The fitted physical model. Everything downstream reads from this, never from raw
 * samples. Position at time t is p0 + v0*t + 0.5*a*t^2, with `a` absorbing gravity
 * plus the aerodynamic force.
 */
export interface FittedTrajectory {
  /** Position at t = 0, which is `t0Ms` on the host clock. */
  p0: Vec3;
  v0: Vec3;
  /** Constant acceleration term: gravity plus a constant aero approximation. */
  a: Vec3;
  t0Ms: number;
  /** Time span the fit is valid over, relative to t0. */
  tStartS: number;
  tEndS: number;
  /** RMS residual against the contributing samples, in metres. */
  residualM: number;
  sampleCount: number;
  inlierCount: number;
  /** How many cameras contributed. 2 upgrades break/release from approximate to accurate. */
  cameraCount: 1 | 2;
}

export function trajectoryPosition(traj: FittedTrajectory, tS: number): Vec3 {
  return {
    x: traj.p0.x + traj.v0.x * tS + 0.5 * traj.a.x * tS * tS,
    y: traj.p0.y + traj.v0.y * tS + 0.5 * traj.a.y * tS * tS,
    z: traj.p0.z + traj.v0.z * tS + 0.5 * traj.a.z * tS * tS,
  };
}

export function trajectoryVelocity(traj: FittedTrajectory, tS: number): Vec3 {
  return {
    x: traj.v0.x + traj.a.x * tS,
    y: traj.v0.y + traj.a.y * tS,
    z: traj.v0.z + traj.a.z * tS,
  };
}

// ---------------------------------------------------------------------------
// Strike zone and the call
// ---------------------------------------------------------------------------

export interface StrikeZone {
  ruleSet: RuleSetId;
  /** Vertical bounds in world metres above the ground. */
  bottomM: number;
  topM: number;
  /** Horizontal extent is always the plate width, but stored so overlays never re-derive it. */
  halfWidthM: number;
  source: 'pose' | 'manual' | 'height' | 'default';
  /**
   * Frozen at the moment of RELEASE, not at crossing, so a batter dropping into a
   * crouch cannot shrink their own zone.
   */
  frozenAtMs: number;
  batterId?: string;
  batterHeightM?: number;
  /** True when derived from anthropometric ratios rather than observed pose. */
  approximate: boolean;
}

export interface PlateCrossing {
  plane: PlatePlane;
  /** Ball centre at the crossing, in world metres. */
  position: Vec3;
  /** Host-clock time of the crossing, interpolated sub-frame. */
  timestampMs: number;
  /** Speed at the crossing. */
  speedMps: number;
  /** True if the ball touched the inflated zone at this plane. */
  isStrike: boolean;
  /** Signed distance to the nearest inflated-zone boundary. Negative means inside. */
  marginM: number;
}

export interface PitchCall {
  result: 'strike' | 'ball';
  /** Which plane produced the strike. Null on a ball. */
  strikePlane: PlatePlane | null;
  front: PlateCrossing;
  back: PlateCrossing;
  confidence: number;
  band: ConfidenceBand;
  /** Populated when confidence is below the confident band; shown in the UI. */
  caveats: string[];
}

// ---------------------------------------------------------------------------
// Measurements
// ---------------------------------------------------------------------------

export interface PitchMeasurements {
  releasePoint: Vec3;
  releaseSpeedMps: number;
  plateSpeedMps: number;
  timeToPlateS: number;
  /** Lateral deviation from a straight line along the initial velocity vector. */
  horizontalBreakM: number;
  /** Deviation from a gravity-only trajectory. Positive = dropped LESS than gravity alone. */
  verticalBreakM: number;
  totalBreakM: number;
  breakAngleRad: number;
  /** Distance from the rubber toward the plate at release. */
  extensionM: number;
  releaseHeightM: number;
  releaseSideM: number;
  verticalApproachAngleRad: number;
  horizontalApproachAngleRad: number;
  /**
   * True in single-camera mode. Break and release figures MUST be labelled
   * approximate in the UI when this is set. Section 16.
   */
  breakIsApproximate: boolean;
}

// ---------------------------------------------------------------------------
// Classification
// ---------------------------------------------------------------------------

/** The feature vector fed to the per-pitcher classifier. Order is stable and load-bearing. */
export const FEATURE_KEYS = [
  'releaseSpeedMps',
  'plateSpeedMps',
  'horizontalBreakM',
  'verticalBreakM',
  'totalBreakM',
  'breakAngleRad',
  'releaseHeightM',
  'releaseSideM',
  'extensionM',
  'verticalApproachAngleRad',
  'horizontalApproachAngleRad',
] as const;

export type FeatureKey = (typeof FEATURE_KEYS)[number];
export type FeatureVector = Record<FeatureKey, number>;

export interface PitchPrediction {
  type: PitchTypeId;
  confidence: number;
  /** One-line human reason, e.g. "62 mph, 9 in of arm-side run". */
  reason: string;
  source: 'rules' | 'knn' | 'logistic';
}

export interface PitcherModel {
  pitcherId: string;
  kind: 'rules' | 'knn' | 'logistic';
  /** z-scoring parameters. */
  mean: FeatureVector;
  std: FeatureVector;
  classes: PitchTypeId[];
  /** Logistic weights, [class][feature], plus a bias per class. */
  weights?: number[][];
  bias?: number[];
  /** kNN training set, used when sample counts are too small for logistic regression. */
  examples?: { features: FeatureVector; label: PitchTypeId }[];
  trainedAt: number;
  trainingCount: number;
}

// ---------------------------------------------------------------------------
// Persisted entities (Section 7)
// ---------------------------------------------------------------------------

export interface Pitcher {
  id: string;
  name: string;
  handedness: Handedness;
  notes?: string;
  createdAt: number;
}

export interface Batter {
  id: string;
  name: string;
  heightM: number;
  handedness: Handedness;
  /** Saved zone override, if the user has tuned one. */
  savedZone?: { bottomM: number; topM: number };
  createdAt: number;
}

export interface Session {
  id: string;
  pitcherId: string;
  startedAt: number;
  endedAt?: number;
  location?: string;
  cameraSetupId: string;
  cameraMode: 'single' | 'dual';
  ruleSet: RuleSetId;
  pitchingDistanceFt: number;
  environmentNotes?: string;
  /** Whether the pitcher declared intent before each pitch. */
  callBeforeMode: boolean;
}

export interface IntendedPitch {
  type: PitchTypeId;
  /** Target in the zone plane, world metres. */
  target: Vec2;
}

export interface PitchRecord {
  id: string;
  sessionId: string;
  sequence: number;
  timestampMs: number;

  labeledType: PitchTypeId | null;
  customTypeName?: string;
  predictedType: PitchTypeId | null;
  predictionConfidence: number | null;
  predictionReason?: string;

  call: PitchCall;
  measurements: PitchMeasurements;
  trajectory: FittedTrajectory;
  zone: StrikeZone;

  intended?: IntendedPitch;
  /** Distance from intended target to actual crossing, when call-before was used. */
  commandMissM?: number;

  trackingConfidence: number;
  cameraCount: 1 | 2;
  /** Achieved clock sync in ms at the time of this pitch, dual-camera mode only. */
  syncOffsetMs?: number;

  clipId?: string;
}

export interface ClipRecord {
  id: string;
  sessionId: string;
  pitchId: string;
  createdAt: number;
  durationS: number;
  bytes: number;
  blob: Blob;
}

export interface AppSettings {
  id: 'singleton';
  ruleSet: RuleSetId;
  pitchingDistanceFt: number;
  units: 'imperial' | 'metric';
  sunlightMode: boolean;
  audioFeedback: boolean;
  activePitcherId?: string;
  activeCameraSetupId?: string;
  clipRetentionCount: number;
  commandRadiusM: number;
}
