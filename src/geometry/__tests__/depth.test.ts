import { describe, expect, it } from 'vitest';
import type { CameraCalibration, Vec3 } from '@/domain/types';
import { plateCam } from '../../../harness/scenarios';
import { apparentDiameterPx, projectPoint } from '@/vision/camera';
import { BALL } from '@/domain/constants';
import { depthSigmaM, monocularSample } from '../depth';

function calFrom(cam: ReturnType<typeof plateCam>): CameraCalibration {
  return {
    role: 'plate',
    intrinsics: cam.intrinsics,
    extrinsics: cam.extrinsics,
    tappedCorners: {} as CameraCalibration['tappedCorners'],
    reprojectionErrorPx: 0,
    positionWorld: cam.position,
    calibratedAt: 0,
  };
}

describe('monocular depth from apparent diameter', () => {
  const cam = plateCam();
  const cal = calFrom(cam);

  it('recovers a known world point from its projected pixel and true apparent diameter', () => {
    const truth: Vec3 = { x: 0.1, y: 0.9, z: -6 };
    const proj = projectPoint(cal.intrinsics, cal.extrinsics, truth);
    const depthAtTruth = proj.depthM;
    const minorAxisPx = apparentDiameterPx(cal.intrinsics, BALL.DIAMETER_M, depthAtTruth);

    const sample = monocularSample(cal, proj.pixel, minorAxisPx);
    expect(Math.hypot(sample.position.x - truth.x, sample.position.y - truth.y, sample.position.z - truth.z)).toBeLessThan(
      0.01,
    );
  });

  it('grows uncertainty at longer range for the same pixel noise', () => {
    const near = depthSigmaM(3, 30, 0.75);
    const far = depthSigmaM(11, 8, 0.75);
    expect(far).toBeGreaterThan(near);
  });

  it('produces a finite, positive sigma for a realistic in-flight sample', () => {
    const truth: Vec3 = { x: 0, y: 0.8, z: -0.4318 };
    const proj = projectPoint(cal.intrinsics, cal.extrinsics, truth);
    const minorAxisPx = apparentDiameterPx(cal.intrinsics, BALL.DIAMETER_M, proj.depthM);
    const sample = monocularSample(cal, proj.pixel, minorAxisPx);
    expect(sample.sigmaM).toBeGreaterThan(0);
    expect(Number.isFinite(sample.sigmaM)).toBe(true);
  });
});
