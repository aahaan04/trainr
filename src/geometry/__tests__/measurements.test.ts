import { describe, expect, it } from 'vitest';
import { DEFAULT_PITCHING_DISTANCE_FT, RELEASE } from '@/domain/constants';
import { toMph } from '@/domain/units';
import { presetByName, simulate } from '../../../harness/physics';
import { computeMeasurements } from '../measurements';
import { fitTrajectoryFromGroundTruth } from './fitHelper';

describe('vertical break sign convention', () => {
  it('is positive for the rise preset (drops less than gravity alone)', () => {
    const gt = simulate(presetByName('rise'));
    const traj = fitTrajectoryFromGroundTruth(gt);
    const m = computeMeasurements(traj);
    expect(m.verticalBreakM).toBeGreaterThan(0);
  });

  it('is negative for the drop preset (drops more than gravity alone)', () => {
    const gt = simulate(presetByName('drop'));
    const traj = fitTrajectoryFromGroundTruth(gt);
    const m = computeMeasurements(traj);
    expect(m.verticalBreakM).toBeLessThan(0);
  });

  it('gives the rise ball more positive break than the drop ball', () => {
    const rise = computeMeasurements(fitTrajectoryFromGroundTruth(simulate(presetByName('rise'))));
    const drop = computeMeasurements(fitTrajectoryFromGroundTruth(simulate(presetByName('drop'))));
    expect(rise.verticalBreakM).toBeGreaterThan(drop.verticalBreakM);
  });
});

describe('horizontal break sign', () => {
  it('separates curve and screw to opposite sides, matching the physics simulator', () => {
    const curve = computeMeasurements(fitTrajectoryFromGroundTruth(simulate(presetByName('curve'))));
    const screw = computeMeasurements(fitTrajectoryFromGroundTruth(simulate(presetByName('screw'))));
    expect(curve.horizontalBreakM).toBeGreaterThan(0);
    expect(screw.horizontalBreakM).toBeLessThan(0);
  });
});

describe('velocity, release and extension sanity', () => {
  it('measures release speed close to ground truth for the fastball preset', () => {
    const gt = simulate(presetByName('fastball'));
    const traj = fitTrajectoryFromGroundTruth(gt);
    const m = computeMeasurements(traj);
    const errMps = Math.abs(m.releaseSpeedMps - gt.releaseSpeedMps);
    expect(toMph(errMps)).toBeLessThan(2);
  });

  it('reports plate speed slower than release speed (drag)', () => {
    const traj = fitTrajectoryFromGroundTruth(simulate(presetByName('fastball')));
    const m = computeMeasurements(traj);
    expect(m.plateSpeedMps).toBeLessThan(m.releaseSpeedMps);
  });

  it('places release height and extension within the plausible windmill-delivery envelope', () => {
    const traj = fitTrajectoryFromGroundTruth(simulate(presetByName('fastball')));
    const m = computeMeasurements(traj, DEFAULT_PITCHING_DISTANCE_FT);
    expect(m.releaseHeightM).toBeGreaterThan(RELEASE.MIN_HEIGHT_M);
    expect(m.releaseHeightM).toBeLessThan(RELEASE.MAX_HEIGHT_M);
    expect(m.extensionM).toBeGreaterThan(RELEASE.MIN_STRIDE_M - 0.3);
    expect(m.extensionM).toBeLessThan(RELEASE.MAX_STRIDE_M + 0.3);
  });

  it('reports time to plate within the physics sanity window', () => {
    const traj = fitTrajectoryFromGroundTruth(simulate(presetByName('fastball')));
    const m = computeMeasurements(traj);
    expect(m.timeToPlateS).toBeGreaterThan(0.25);
    expect(m.timeToPlateS).toBeLessThan(0.7);
  });

  it('flags break as approximate only in single-camera mode', () => {
    const gt = simulate(presetByName('fastball'));
    const single = computeMeasurements(fitTrajectoryFromGroundTruth(gt, { cameraCount: 1 }));
    const dual = computeMeasurements(fitTrajectoryFromGroundTruth(gt, { cameraCount: 2 }));
    expect(single.breakIsApproximate).toBe(true);
    expect(dual.breakIsApproximate).toBe(false);
  });

  it('never exposes spin fields', () => {
    const m = computeMeasurements(fitTrajectoryFromGroundTruth(simulate(presetByName('fastball'))));
    expect('spinRate' in m).toBe(false);
    expect('spinAxis' in m).toBe(false);
  });
});
