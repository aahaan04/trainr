/**
 * Two-camera regression. This is the experiment that decides whether the
 * single-camera velocity shortfall measured in regression.test.ts is a defect in
 * the pipeline or a limit of the geometry.
 *
 * The single-camera numbers point at an answer. Each camera's WEAK axis is its own
 * depth axis, because depth comes only from the ball's apparent diameter, and those
 * two axes are perpendicular to each other:
 *
 *   plate cam  depth runs ALONG the pitch line -> velocity is poor, the call is good
 *   side cam   depth runs ACROSS the plate     -> velocity is good, the call is poor
 *
 * Triangulation removes apparent diameter from the reconstruction entirely: every
 * axis is then pinned by some camera's well-measured image coordinate. If that
 * explanation is right, the dual-camera path should clear both the +/-2 mph velocity
 * criterion and the 2-inch plate-crossing criterion that neither camera clears alone.
 */

import { describe, expect, it } from 'vitest';
import { ACCEPTANCE, BALL, PLATE } from '@/domain/constants';
import { toInches, toMph } from '@/domain/units';
import type { CameraCalibration, Vec2, Vec3 } from '@/domain/types';
import { cameraCenter, projectPoint } from '@/vision/camera';
import { triangulateDLT } from '@/geometry/triangulate';
import { fitTrajectory } from '../trajectory';
import { presetByName, simulate, stateAt } from '../../../harness/physics';
import { plateCam, sideCam } from '../../../harness/scenarios';
import { fittedCrossing } from '../../../harness/metrics';

function calibFor(
  role: 'plate' | 'side',
  cam: ReturnType<typeof plateCam>,
): CameraCalibration {
  return {
    role,
    intrinsics: cam.intrinsics,
    extrinsics: cam.extrinsics,
    tappedCorners: {} as CameraCalibration['tappedCorners'],
    reprojectionErrorPx: 0,
    positionWorld: cameraCenter(cam.extrinsics),
    calibratedAt: 0,
  };
}

/** Deterministic centroid noise, so this measures geometry rather than luck. */
function jitter(seed: number) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface DualResult {
  releaseSpeedErrorMph: number;
  frontCrossingErrorIn: number;
  samples: number;
  worstSampleErrorM: number;
}

/**
 * Both cameras observe the same instants, which is what the clock-sync work in
 * src/net exists to achieve on real hardware. `centroidNoisePx` stands in for
 * blob-centroid error; 1 px is what the single-camera runs actually measured.
 */
function runDual(pitchName: string, fps: number, centroidNoisePx: number, seed: number): DualResult {
  const gt = simulate(presetByName(pitchName));
  const pcam = plateCam();
  const scam = sideCam();
  const plateCalib = calibFor('plate', pcam);
  const sideCalib = calibFor('side', scam);
  const rand = jitter(seed);

  const dt = 1 / fps;
  const samples: { position: Vec3; tS: number }[] = [];
  let worstSampleErrorM = 0;

  for (let t = 0; t <= gt.samples[gt.samples.length - 1].tS; t += dt) {
    const st = stateAt(gt, t);
    if (!st) continue;

    const pPlate = projectPoint(pcam.intrinsics, pcam.extrinsics, st.position);
    const pSide = projectPoint(scam.intrinsics, scam.extrinsics, st.position);
    if (!pPlate.visible || !pSide.visible) continue;

    const noisy = (p: Vec2): Vec2 => ({
      x: p.x + (rand() - 0.5) * 2 * centroidNoisePx,
      y: p.y + (rand() - 0.5) * 2 * centroidNoisePx,
    });

    const tri = triangulateDLT([
      { pixel: noisy(pPlate.pixel), calibration: plateCalib },
      { pixel: noisy(pSide.pixel), calibration: sideCalib },
    ]);
    const err = Math.hypot(
      tri.position.x - st.position.x,
      tri.position.y - st.position.y,
      tri.position.z - st.position.z,
    );
    worstSampleErrorM = Math.max(worstSampleErrorM, err);
    samples.push({ position: tri.position, tS: t });
  }

  const fit = fitTrajectory(
    samples.map((s) => ({ tS: s.tS, position: s.position, weight: 1 })),
    0,
    2,
  );
  const traj = fit.trajectory;

  const speedAt = (t: number) =>
    Math.hypot(traj.v0.x + traj.a.x * t, traj.v0.y + traj.a.y * t, traj.v0.z + traj.a.z * t);

  const front = fittedCrossing(traj, PLATE.FRONT_Z_M);
  const frontErrM =
    front && gt.crossings.front
      ? Math.hypot(
          front.p.x - gt.crossings.front.position.x,
          front.p.y - gt.crossings.front.position.y,
        )
      : Infinity;

  return {
    releaseSpeedErrorMph: toMph(Math.abs(speedAt(traj.tStartS) - gt.releaseSpeedMps)),
    frontCrossingErrorIn: toInches(frontErrM),
    samples: samples.length,
    worstSampleErrorM,
  };
}

describe('two-camera triangulation', () => {
  const pitches = ['fastball', 'drop', 'rise', 'curve'] as const;
  const results = new Map<string, DualResult>();

  for (const name of pitches) {
    results.set(name, runDual(name, 60, 1.0, 12345));
  }

  it('reports the measured dual-camera table', () => {
    const lines = ['pitch       samples  worst_sample_cm  velo_mph  front_in'];
    for (const [name, r] of results) {
      lines.push(
        `${name.padEnd(12)}${String(r.samples).padStart(5)}` +
          `${(r.worstSampleErrorM * 100).toFixed(2).padStart(16)}` +
          `${r.releaseSpeedErrorMph.toFixed(2).padStart(10)}` +
          `${r.frontCrossingErrorIn.toFixed(2).padStart(10)}`,
      );
    }
    console.log(lines.join('\n'));
    expect(results.size).toBe(pitches.length);
  });

  for (const name of pitches) {
    it(`${name}: release speed within ${toMph(ACCEPTANCE.MAX_VELOCITY_ERROR_MPS).toFixed(1)} mph`, () => {
      expect(results.get(name)!.releaseSpeedErrorMph).toBeLessThanOrEqual(
        toMph(ACCEPTANCE.MAX_VELOCITY_ERROR_MPS),
      );
    });

    it(`${name}: plate crossing within ${toInches(ACCEPTANCE.MAX_PLATE_CROSSING_ERROR_M).toFixed(0)} in`, () => {
      expect(results.get(name)!.frontCrossingErrorIn).toBeLessThanOrEqual(
        toInches(ACCEPTANCE.MAX_PLATE_CROSSING_ERROR_M),
      );
    });
  }

  it('reconstructs every sample to better than one ball radius', () => {
    for (const [name, r] of results) {
      expect(r.worstSampleErrorM, `${name} worst sample error`).toBeLessThan(BALL.RADIUS_M);
    }
  });
});
