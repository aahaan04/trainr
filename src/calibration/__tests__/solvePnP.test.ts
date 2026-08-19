import { describe, expect, it } from 'vitest';
import { PLATE_CORNER_ORDER, PLATE_MODEL_M } from '@/domain/constants';
import type { PlateCornerName, Vec2, Vec3 } from '@/domain/types';
import { intrinsicsFromFov, lookAt, projectPoint, reprojectionError } from '@/vision/camera';
import { buildCameraCalibration, estimatePoseUncertainty, isCalibrationAcceptable, PNP_MAX_REPROJECTION_ERROR_PX, solvePlatePnP } from '../solvePnP';

/** Deterministic PRNG so the noise added to synthetic taps is reproducible. */
function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function projectPlate(intr: ReturnType<typeof intrinsicsFromFov>, ext: ReturnType<typeof lookAt>, noisePx: number, rng: () => number) {
  const pts: Record<PlateCornerName, Vec2> = {} as Record<PlateCornerName, Vec2>;
  const world: Vec3[] = [];
  for (const name of PLATE_CORNER_ORDER) {
    const [x, y, z] = PLATE_MODEL_M[name];
    world.push({ x, y, z });
    const proj = projectPoint(intr, ext, { x, y, z });
    const nx = (rng() - 0.5) * 2 * noisePx;
    const ny = (rng() - 0.5) * 2 * noisePx;
    pts[name] = { x: proj.pixel.x + nx, y: proj.pixel.y + ny };
  }
  return { pts, world };
}

describe('solvePlatePnP', () => {
  // Realistic plate-cam placement: 16 ft behind the plate, 4.5 ft lens height,
  // looking at the plate. Matches CAMERA_PLACEMENT.plate ideal numbers.
  const eye: Vec3 = { x: 0, y: 1.372, z: 4.877 }; // 4.5 ft up, 16 ft back (+Z, behind plate)
  const target: Vec3 = { x: 0, y: 0.3, z: -3 };
  const trueExt = lookAt(eye, target);
  const trueIntr = intrinsicsFromFov(1280, 720, 60, 0.0);

  it('recovers pose to sub-pixel accuracy with noiseless taps', () => {
    const rng = mulberry32(1);
    const { pts } = projectPlate(trueIntr, trueExt, 0, rng);
    const result = solvePlatePnP(pts, intrinsicsFromFov(1280, 720, 60, 0));

    expect(result.reprojectionErrorPx).toBeLessThan(0.5);
    expect(isCalibrationAcceptable(result)).toBe(true);

    // Compare recovered camera center to ground truth.
    const calib = buildCameraCalibration('plate', result, pts);
    const dx = calib.positionWorld.x - eye.x;
    const dy = calib.positionWorld.y - eye.y;
    const dz = calib.positionWorld.z - eye.z;
    const posErrM = Math.hypot(dx, dy, dz);
    expect(posErrM).toBeLessThan(0.05);
  });

  /**
   * MEASURED CONDITIONING, plate cam at the Section 3.1 ideal placement.
   *
   * From 16 ft back at 4.5 ft height the plate images as ~91 x 24 px at 720p: the
   * depth direction is compressed into 24 px by the grazing view angle. Measured
   * camera-position error over 40 seeds per noise level:
   *
   *   tap noise   median      p90       worst     mean reprojection
   *   0.25 px     0.073 m     0.22 m    0.25 m    0.09 px
   *   0.5  px     0.131 m     0.44 m    0.52 m    0.18 px
   *   1    px     0.244 m     0.77 m    1.18 m    0.37 px
   *   2    px     0.588 m     3.04 m    11.71 m   0.83 px
   *
   * The last row is the important one, and it is why `assessPoseCredibility` and
   * `estimatePoseUncertainty` exist: at 2 px of tap error the pose can be off by
   * METRES while reprojection error stays comfortably under one pixel. Reprojection
   * error measures whether the solve explains the taps, not whether the taps were
   * in the right place, so it cannot detect this on its own.
   *
   * Practical consequence: magnifier-on-drag is not a nicety, it is what keeps tap
   * noise near 1 px and the solve usable.
   */
  it('is accurate at the ~1 px tap precision that magnifier-on-drag makes achievable', () => {
    const rng = mulberry32(42);
    const { pts } = projectPlate(trueIntr, trueExt, 1, rng);
    const result = solvePlatePnP(pts, intrinsicsFromFov(1280, 720, 60, 0));

    expect(result.reprojectionErrorPx).toBeLessThan(PNP_MAX_REPROJECTION_ERROR_PX);

    const calib = buildCameraCalibration('plate', result, pts);
    const posErrM = Math.hypot(
      calib.positionWorld.x - eye.x,
      calib.positionWorld.y - eye.y,
      calib.positionWorld.z - eye.z,
    );
    expect(posErrM).toBeLessThan(1.2);
  });

  it('reports metre-scale uncertainty for sloppy taps that reprojection error calls clean', () => {
    const rng = mulberry32(11);
    const { pts } = projectPlate(trueIntr, trueExt, 0, rng);
    const result = solvePlatePnP(pts, intrinsicsFromFov(1280, 720, 60, 0));

    // The solve itself looks immaculate on the tapped points.
    expect(result.reprojectionErrorPx).toBeLessThan(0.01);

    // But re-solving from taps jittered by a plausible 2 px shows the pose is not
    // actually pinned down. The wizard must surface this, not the sub-pixel number.
    const u = estimatePoseUncertainty(pts, intrinsicsFromFov(1280, 720, 60, 0), 2, 24);
    expect(u.positionSpreadM).toBeGreaterThan(0.5);
  });

  it('recovers pose for the side camera placement too', () => {
    // The side cam sees the plate across its full 17 in width rather than end-on, so
    // it images ~207 x 35 px and the solve is better conditioned than the plate cam's.
    const sideEye: Vec3 = { x: 6.096, y: 1.067, z: -2 }; // 20 ft to first-base side, 3.5 ft up
    const sideTarget: Vec3 = { x: 0, y: 0.5, z: -6 };
    const sideExt = lookAt(sideEye, sideTarget);
    const rng = mulberry32(7);
    const { pts } = projectPlate(trueIntr, sideExt, 0.5, rng);
    const result = solvePlatePnP(pts, intrinsicsFromFov(1280, 720, 55, 0));

    expect(result.reprojectionErrorPx).toBeLessThan(PNP_MAX_REPROJECTION_ERROR_PX);
    const calib = buildCameraCalibration('side', result, pts);
    const posErrM = Math.hypot(
      calib.positionWorld.x - sideEye.x,
      calib.positionWorld.y - sideEye.y,
      calib.positionWorld.z - sideEye.z,
    );
    expect(posErrM).toBeLessThan(1.0);
  });

  it('flags a degenerate (collinear) tap as an error', () => {
    const badPts: Record<PlateCornerName, Vec2> = {
      backPoint: { x: 640, y: 100 },
      thirdBaseSide: { x: 640, y: 200 },
      firstBaseSide: { x: 640, y: 300 },
      thirdBaseFront: { x: 640, y: 400 },
      firstBaseFront: { x: 640, y: 500 },
    };
    expect(() => solvePlatePnP(badPts, intrinsicsFromFov(1280, 720, 60, 0))).toThrow();
  });

  it('reprojecting the refined solve against reprojectionError() agrees with the reported figure', () => {
    const rng = mulberry32(99);
    const { pts, world } = projectPlate(trueIntr, trueExt, 1, rng);
    const result = solvePlatePnP(pts, intrinsicsFromFov(1280, 720, 60, 0));
    const independentCheck = reprojectionError(result.intrinsics, result.extrinsics, world, PLATE_CORNER_ORDER.map((k) => pts[k]));
    expect(independentCheck).toBeCloseTo(result.reprojectionErrorPx, 6);
  });
});
