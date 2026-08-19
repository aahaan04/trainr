import { describe, expect, it } from 'vitest';
import type { CameraCalibration, Vec3 } from '@/domain/types';
import { plateCam, sideCam } from '../../../harness/scenarios';
import { projectPoint } from '@/vision/camera';
import { triangulateDLT, reconstructSamples } from '../triangulate';

function calFrom(cam: ReturnType<typeof plateCam>, role: 'plate' | 'side'): CameraCalibration {
  return {
    role,
    intrinsics: cam.intrinsics,
    extrinsics: cam.extrinsics,
    tappedCorners: {} as CameraCalibration['tappedCorners'],
    reprojectionErrorPx: 0,
    positionWorld: cam.position,
    calibratedAt: 0,
  };
}

describe('DLT triangulation', () => {
  const plate = plateCam();
  const side = sideCam();
  const calPlate = calFrom(plate, 'plate');
  const calSide = calFrom(side, 'side');

  const points: Vec3[] = [
    { x: 0, y: 0.8, z: -0.4318 },
    { x: 0.3, y: 1.1, z: -3.5 },
    { x: -0.2, y: 0.5, z: -8.0 },
    { x: 0.05, y: 1.5, z: -11.5 },
  ];

  it('recovers a known 3D point to sub-millimetre with clean synthetic input', () => {
    for (const p of points) {
      const pxPlate = projectPoint(calPlate.intrinsics, calPlate.extrinsics, p).pixel;
      const pxSide = projectPoint(calSide.intrinsics, calSide.extrinsics, p).pixel;
      const result = triangulateDLT([
        { pixel: pxPlate, calibration: calPlate },
        { pixel: pxSide, calibration: calSide },
      ]);
      expect(Math.hypot(result.position.x - p.x, result.position.y - p.y, result.position.z - p.z)).toBeLessThan(
        0.001,
      );
      expect(result.sigmaM).toBeGreaterThan(0);
      expect(Number.isFinite(result.sigmaM)).toBe(true);
    }
  });

  it('degrades gracefully (small bounded error) with pixel noise added', () => {
    const p = points[1];
    const noisePx = 1.5;
    let maxErr = 0;
    // Deterministic pseudo-noise so the test is reproducible.
    let seed = 42;
    const rand = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    };
    for (let i = 0; i < 50; i++) {
      const pxPlate = projectPoint(calPlate.intrinsics, calPlate.extrinsics, p).pixel;
      const pxSide = projectPoint(calSide.intrinsics, calSide.extrinsics, p).pixel;
      const noisyPlate = { x: pxPlate.x + (rand() - 0.5) * 2 * noisePx, y: pxPlate.y + (rand() - 0.5) * 2 * noisePx };
      const noisySide = { x: pxSide.x + (rand() - 0.5) * 2 * noisePx, y: pxSide.y + (rand() - 0.5) * 2 * noisePx };
      const result = triangulateDLT([
        { pixel: noisyPlate, calibration: calPlate },
        { pixel: noisySide, calibration: calSide },
      ]);
      const err = Math.hypot(result.position.x - p.x, result.position.y - p.y, result.position.z - p.z);
      maxErr = Math.max(maxErr, err);
      expect(result.sigmaM).toBeGreaterThan(0);
    }
    // A couple of px of noise at these ranges should not blow up to metres of error.
    expect(maxErr).toBeLessThan(0.15);
  });

  it('throws on fewer than two observations', () => {
    const pxPlate = projectPoint(calPlate.intrinsics, calPlate.extrinsics, points[0]).pixel;
    expect(() => triangulateDLT([{ pixel: pxPlate, calibration: calPlate }])).toThrow();
  });

  it('reports growing uncertainty for a monocular-only single camera', () => {
    const near = { x: 0, y: 0.8, z: -2 };
    const far = { x: 0, y: 0.8, z: -11 };
    const pxNear = projectPoint(calPlate.intrinsics, calPlate.extrinsics, near).pixel;
    const pxFar = projectPoint(calPlate.intrinsics, calPlate.extrinsics, far).pixel;

    const samples = reconstructSamples(
      {
        plate: [
          { pixel: pxNear, minorAxisPx: 12, timestampMs: 0 },
          { pixel: pxFar, minorAxisPx: 3, timestampMs: 16 },
        ],
      },
      { plate: calPlate },
    );
    expect(samples).toHaveLength(2);
    expect(samples.every((s) => s.cameraCount === 1)).toBe(true);
    // Farther sample (smaller apparent diameter) should carry more uncertainty.
    expect(samples[1].sigmaM).toBeGreaterThan(samples[0].sigmaM);
  });

  it('uses DLT (cameraCount 2) when both cameras report a time-matched detection', () => {
    const p: Vec3 = { x: 0.1, y: 0.9, z: -5 };
    const pxPlate = projectPoint(calPlate.intrinsics, calPlate.extrinsics, p).pixel;
    const pxSide = projectPoint(calSide.intrinsics, calSide.extrinsics, p).pixel;
    const samples = reconstructSamples(
      {
        plate: [{ pixel: pxPlate, minorAxisPx: 10, timestampMs: 100 }],
        side: [{ pixel: pxSide, minorAxisPx: 10, timestampMs: 102 }],
      },
      { plate: calPlate, side: calSide },
      { matchToleranceMs: 8 },
    );
    expect(samples).toHaveLength(1);
    expect(samples[0].cameraCount).toBe(2);
    expect(Math.hypot(samples[0].position.x - p.x, samples[0].position.y - p.y, samples[0].position.z - p.z)).toBeLessThan(
      0.005,
    );
  });
});
