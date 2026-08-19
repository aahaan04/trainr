/**
 * Section 3.4 AUTO path: MediaPipe Tasks Vision pose landmarker -> StrikeZone.
 *
 * Split in two on purpose:
 *   - `zoneFromPoseLandmarks` is pure geometry (landmarks + calibration -> StrikeZone)
 *     and is fully unit tested with synthetic landmarks projected through a
 *     synthetic camera.
 *   - `PoseZoneEstimator` wraps the actual MediaPipe wasm runtime, which needs a
 *     real browser and the model files this module loads from same-origin
 *     `/mediapipe/wasm/` and `/models/` (never a CDN, so the app cold-starts
 *     offline) — UNTESTABLE here, exercised by hand.
 *
 * MediaPipe's 33-point BlazePose topology has no dedicated "armpit" landmark, so
 * the shoulder landmark is used as the forward-armpit proxy (NCAA/NFHS) — the
 * standard simplification, since the armpit sits only a few centimetres below the
 * shoulder along a body that's already only approximately modelled here.
 */

import type { CameraCalibration, Handedness, RuleSetId, StrikeZone, Vec2 } from '@/domain/types';
import { PLATE } from '@/domain/constants';
import { cameraCenter, intersectPlaneZ, unprojectRay } from '@/vision/camera';

export interface PoseLandmark {
  x: number;
  y: number;
  z: number;
  visibility?: number;
}

// BlazePose 33-point topology (MediaPipe Tasks Vision PoseLandmarker).
const LEFT_SHOULDER = 11;
const RIGHT_SHOULDER = 12;
const LEFT_KNEE = 25;
const RIGHT_KNEE = 26;

const MIN_VISIBILITY = 0.5;

function landmarkPixel(lm: PoseLandmark, videoWidth: number, videoHeight: number): Vec2 {
  return { x: lm.x * videoWidth, y: lm.y * videoHeight };
}

function isVisible(lm: PoseLandmark | undefined): lm is PoseLandmark {
  return !!lm && (lm.visibility === undefined || lm.visibility >= MIN_VISIBILITY);
}

function heightAt(
  lm: PoseLandmark,
  calibration: CameraCalibration,
  videoWidth: number,
  videoHeight: number,
  batterZ: number,
): number | null {
  const pixel = landmarkPixel(lm, videoWidth, videoHeight);
  const origin = cameraCenter(calibration.extrinsics);
  const dir = unprojectRay(calibration.intrinsics, calibration.extrinsics, pixel);
  const hit = intersectPlaneZ(origin, dir, batterZ);
  return hit ? hit.y : null;
}

export interface PoseZoneInput {
  landmarks: readonly PoseLandmark[];
  videoWidth: number;
  videoHeight: number;
  calibration: CameraCalibration;
  ruleSet: RuleSetId;
  handedness: Handedness;
  /** World Z of the batter's stance (box position). Landmarks are unprojected onto this plane. */
  batterZ: number;
  frozenAtMs: number;
  batterId?: string;
}

/**
 * Converts one frame of pose landmarks into a StrikeZone by unprojecting the
 * relevant landmark pixels onto the vertical plane at the batter's stance depth
 * and reading off world height (Y). Returns null when the needed landmarks are not
 * visible or the geometry is degenerate — callers fall back to manual/height mode.
 */
export function zoneFromPoseLandmarks(input: PoseZoneInput): StrikeZone | null {
  const { landmarks, videoWidth, videoHeight, calibration, ruleSet, handedness, batterZ } = input;

  const leftShoulder = landmarks[LEFT_SHOULDER];
  const rightShoulder = landmarks[RIGHT_SHOULDER];
  const leftKnee = landmarks[LEFT_KNEE];
  const rightKnee = landmarks[RIGHT_KNEE];

  // A right-handed batter's front (pitcher-facing) side is conventionally their
  // left; a left-handed batter's front side is their right.
  const forward = handedness === 'right' ? leftShoulder : rightShoulder;
  const back = handedness === 'right' ? rightShoulder : leftShoulder;

  const topLandmark = ruleSet === 'usaSoftball' ? back : forward;
  if (!isVisible(topLandmark)) return null;
  const topM = heightAt(topLandmark, calibration, videoWidth, videoHeight, batterZ);
  if (topM === null) return null;

  const kneeHeights: number[] = [];
  if (isVisible(leftKnee)) {
    const h = heightAt(leftKnee, calibration, videoWidth, videoHeight, batterZ);
    if (h !== null) kneeHeights.push(h);
  }
  if (isVisible(rightKnee)) {
    const h = heightAt(rightKnee, calibration, videoWidth, videoHeight, batterZ);
    if (h !== null) kneeHeights.push(h);
  }
  if (kneeHeights.length === 0) return null;
  const bottomM = kneeHeights.reduce((a, b) => a + b, 0) / kneeHeights.length;

  if (!(topM > bottomM) || !Number.isFinite(topM) || !Number.isFinite(bottomM)) return null;

  return {
    ruleSet,
    bottomM,
    topM,
    halfWidthM: PLATE.HALF_WIDTH_M,
    source: 'pose',
    frozenAtMs: input.frozenAtMs,
    batterId: input.batterId,
    approximate: false,
  };
}

// ---------------------------------------------------------------------------
// MediaPipe runtime wrapper
// ---------------------------------------------------------------------------

/** Same-origin only — never a CDN — so the app cold-starts with no network. */
export const MEDIAPIPE_WASM_BASE_PATH = '/mediapipe/wasm';
export const POSE_MODEL_ASSET_PATH = '/models/pose_landmarker_lite.task';

export interface PoseDetection {
  landmarks: PoseLandmark[] | null;
  timestampMs: number;
}

/**
 * Thin, lazily-initialised wrapper around `@mediapipe/tasks-vision`'s PoseLandmarker
 * in VIDEO running mode. The `@mediapipe/tasks-vision` import is dynamic so pages
 * that never open the zone-setup step don't pay for the wasm loader bundle.
 */
export class PoseZoneEstimator {
  private landmarker: import('@mediapipe/tasks-vision').PoseLandmarker | null = null;
  private initError: Error | null = null;

  static isSupported(): boolean {
    return typeof WebAssembly !== 'undefined' && typeof document !== 'undefined';
  }

  async init(): Promise<void> {
    if (this.landmarker || this.initError) return;
    if (!PoseZoneEstimator.isSupported()) {
      this.initError = new Error('WebAssembly is not available in this browser.');
      throw this.initError;
    }
    try {
      const { FilesetResolver, PoseLandmarker } = await import('@mediapipe/tasks-vision');
      const fileset = await FilesetResolver.forVisionTasks(MEDIAPIPE_WASM_BASE_PATH);
      this.landmarker = await PoseLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: POSE_MODEL_ASSET_PATH, delegate: 'GPU' },
        runningMode: 'VIDEO',
        numPoses: 1,
      });
    } catch (err) {
      this.initError = err instanceof Error ? err : new Error(String(err));
      throw this.initError;
    }
  }

  get ready(): boolean {
    return this.landmarker !== null;
  }

  detectForVideo(video: HTMLVideoElement, timestampMs: number): PoseDetection {
    if (!this.landmarker) return { landmarks: null, timestampMs };
    const result = this.landmarker.detectForVideo(video, timestampMs);
    const landmarks = result.landmarks[0] ?? null;
    return { landmarks, timestampMs };
  }

  dispose(): void {
    this.landmarker?.close();
    this.landmarker = null;
  }
}
