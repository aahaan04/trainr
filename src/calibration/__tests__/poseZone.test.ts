import { describe, expect, it } from 'vitest';
import type { CameraCalibration, Vec3 } from '@/domain/types';
import { PLATE } from '@/domain/constants';
import { cameraCenter, intrinsicsFromFov, lookAt, projectPoint } from '@/vision/camera';
import { zoneFromPoseLandmarks, type PoseLandmark } from '../poseZone';

// A side-on camera sees a standing batter's full height well; use that placement
// (not the grazing plate-cam angle) so this test isolates zone geometry rather
// than PnP conditioning, which is covered in solvePnP.test.ts.
// z differs between eye and target so the batter-box plane isn't viewed edge-on
// (a camera whose sightline lies IN the z = batterZ plane can't resolve it via
// intersectPlaneZ, which needs a ray component across that plane).
const eye: Vec3 = { x: 6, y: 1.2, z: -1.5 };
const target: Vec3 = { x: 0, y: 1, z: -0.3 };
const extrinsics = lookAt(eye, target);
const intrinsics = intrinsicsFromFov(1280, 720, 55, 0);

const calibration: CameraCalibration = {
  role: 'side',
  intrinsics,
  extrinsics,
  tappedCorners: {
    backPoint: { x: 0, y: 0 },
    thirdBaseSide: { x: 0, y: 0 },
    firstBaseSide: { x: 0, y: 0 },
    thirdBaseFront: { x: 0, y: 0 },
    firstBaseFront: { x: 0, y: 0 },
  },
  reprojectionErrorPx: 0,
  positionWorld: cameraCenter(extrinsics),
  calibratedAt: Date.now(),
};

const VIDEO_W = 1280;
const VIDEO_H = 720;
const BATTER_Z = -0.3;

function landmarkFor(world: Vec3): PoseLandmark {
  const proj = projectPoint(intrinsics, extrinsics, world);
  return { x: proj.pixel.x / VIDEO_W, y: proj.pixel.y / VIDEO_H, z: 0, visibility: 1 };
}

function buildLandmarks(heights: { leftShoulderY: number; rightShoulderY: number; leftKneeY: number; rightKneeY: number }) {
  const landmarks: PoseLandmark[] = new Array(33).fill({ x: 0.5, y: 0.5, z: 0, visibility: 0 });
  landmarks[11] = landmarkFor({ x: -0.15, y: heights.leftShoulderY, z: BATTER_Z });
  landmarks[12] = landmarkFor({ x: 0.15, y: heights.rightShoulderY, z: BATTER_Z });
  landmarks[25] = landmarkFor({ x: -0.12, y: heights.leftKneeY, z: BATTER_Z });
  landmarks[26] = landmarkFor({ x: 0.12, y: heights.rightKneeY, z: BATTER_Z });
  return landmarks;
}

describe('zoneFromPoseLandmarks', () => {
  const heights = { leftShoulderY: 1.42, rightShoulderY: 1.35, leftKneeY: 0.48, rightKneeY: 0.52 };
  const landmarks = buildLandmarks(heights);

  it('NCAA + right-handed batter uses the forward (left) shoulder for the top', () => {
    const zone = zoneFromPoseLandmarks({
      landmarks,
      videoWidth: VIDEO_W,
      videoHeight: VIDEO_H,
      calibration,
      ruleSet: 'ncaa',
      handedness: 'right',
      batterZ: BATTER_Z,
      frozenAtMs: 12345,
    });
    expect(zone).not.toBeNull();
    expect(zone!.topM).toBeCloseTo(heights.leftShoulderY, 1);
    expect(zone!.bottomM).toBeCloseTo((heights.leftKneeY + heights.rightKneeY) / 2, 1);
    expect(zone!.source).toBe('pose');
    expect(zone!.approximate).toBe(false);
    expect(zone!.halfWidthM).toBe(PLATE.HALF_WIDTH_M);
    expect(zone!.frozenAtMs).toBe(12345);
  });

  it('USA Softball + right-handed batter uses the back (right) shoulder for the top', () => {
    const zone = zoneFromPoseLandmarks({
      landmarks,
      videoWidth: VIDEO_W,
      videoHeight: VIDEO_H,
      calibration,
      ruleSet: 'usaSoftball',
      handedness: 'right',
      batterZ: BATTER_Z,
      frozenAtMs: 1,
    });
    expect(zone).not.toBeNull();
    expect(zone!.topM).toBeCloseTo(heights.rightShoulderY, 1);
  });

  it('left-handed batter flips which shoulder is forward vs. back', () => {
    const ncaaLeft = zoneFromPoseLandmarks({
      landmarks,
      videoWidth: VIDEO_W,
      videoHeight: VIDEO_H,
      calibration,
      ruleSet: 'ncaa',
      handedness: 'left',
      batterZ: BATTER_Z,
      frozenAtMs: 1,
    });
    expect(ncaaLeft!.topM).toBeCloseTo(heights.rightShoulderY, 1);
  });

  it('returns null when the needed landmark is not visible', () => {
    const blind = buildLandmarks(heights);
    blind[11] = { ...blind[11], visibility: 0.1 };
    const zone = zoneFromPoseLandmarks({
      landmarks: blind,
      videoWidth: VIDEO_W,
      videoHeight: VIDEO_H,
      calibration,
      ruleSet: 'ncaa',
      handedness: 'right',
      batterZ: BATTER_Z,
      frozenAtMs: 1,
    });
    expect(zone).toBeNull();
  });

  it('falls back to the one visible knee when the other is occluded', () => {
    const oneKnee = buildLandmarks(heights);
    oneKnee[26] = { ...oneKnee[26], visibility: 0.05 };
    const zone = zoneFromPoseLandmarks({
      landmarks: oneKnee,
      videoWidth: VIDEO_W,
      videoHeight: VIDEO_H,
      calibration,
      ruleSet: 'ncaa',
      handedness: 'right',
      batterZ: BATTER_Z,
      frozenAtMs: 1,
    });
    expect(zone).not.toBeNull();
    expect(zone!.bottomM).toBeCloseTo(heights.leftKneeY, 1);
  });

  it('returns null for a degenerate pose where top is below bottom', () => {
    const inverted = buildLandmarks({ leftShoulderY: 0.3, rightShoulderY: 0.3, leftKneeY: 1.4, rightKneeY: 1.4 });
    const zone = zoneFromPoseLandmarks({
      landmarks: inverted,
      videoWidth: VIDEO_W,
      videoHeight: VIDEO_H,
      calibration,
      ruleSet: 'ncaa',
      handedness: 'right',
      batterZ: BATTER_Z,
      frozenAtMs: 1,
    });
    expect(zone).toBeNull();
  });
});
