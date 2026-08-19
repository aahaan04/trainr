import { describe, expect, it } from 'vitest';
import { CONFIDENCE, TRACKING } from '@/domain/constants';
import { presetByName, simulate, aimedAt } from '../../../harness/physics';
import { defaultTestZone, referenceCall } from '../../../harness/metrics';
import { buildScenario, scenarioById } from '../../../harness/scenarios';
import { callPitch } from '../call';
import { fitTrajectoryFromGroundTruth } from './fitHelper';
import type { FittedTrajectory } from '@/domain/types';

describe('callPitch agrees with the harness reference call', () => {
  it('calls a pitch down the middle a strike', () => {
    const gt = simulate(presetByName('fastball'));
    const traj = fitTrajectoryFromGroundTruth(gt);
    const call = callPitch(traj, defaultTestZone());
    expect(call.result).toBe('strike');
    expect(call.strikePlane).not.toBeNull();
  });

  it('calls a pitch aimed a foot outside a ball', () => {
    const spec = aimedAt(presetByName('fastball'), 0.6, 0.8, 'way-outside');
    const gt = simulate(spec);
    const traj = fitTrajectoryFromGroundTruth(gt);
    const call = callPitch(traj, defaultTestZone());
    expect(call.result).toBe('ball');
    expect(call.strikePlane).toBeNull();
  });

  it('matches referenceCall for every preset pitch down the pipe', () => {
    for (const name of ['fastball', 'changeup', 'drop', 'rise', 'curve', 'screw', 'dropCurve'] as const) {
      const built = buildScenario({ ...scenarioById('daylight-fastball-60fps'), pitch: presetByName(name) }, 320, 180);
      const traj = fitTrajectoryFromGroundTruth(built.groundTruth);
      const zone = defaultTestZone();
      const mine = callPitch(traj, zone);
      const ref = referenceCall(built, zone);
      expect(mine.result).toBe(ref.result);
    }
  });

  it('produces the front-miss/back-strike front/back-plane case', () => {
    const zone = defaultTestZone();
    const spec = aimedAt(presetByName('drop'), 0, zone.topM + 0.03, 'drop-duck-in');
    const gt = simulate(spec);
    const traj = fitTrajectoryFromGroundTruth(gt);
    const call = callPitch(traj, zone);
    expect(call.result).toBe('strike');
    expect(call.strikePlane).toBe('back');
    expect(call.front.isStrike).toBe(false);
    expect(call.back.isStrike).toBe(true);
  });
});

describe('confidence', () => {
  function baseTraj(overrides: Partial<FittedTrajectory> = {}): FittedTrajectory {
    const gt = simulate(presetByName('fastball'));
    const traj = fitTrajectoryFromGroundTruth(gt);
    return { ...traj, ...overrides };
  }

  it('is confident for a clean, well-sampled, two-camera track', () => {
    const traj = baseTraj({ residualM: 0.001, inlierCount: 30, sampleCount: 30, cameraCount: 2 });
    const call = callPitch(traj, defaultTestZone());
    expect(call.confidence).toBeGreaterThanOrEqual(CONFIDENCE.CONFIDENT);
    expect(call.band).toBe('confident');
  });

  it('flags a thin, noisy, single-camera track and adds caveats', () => {
    const traj = baseTraj({
      residualM: 0.08,
      inlierCount: TRACKING.MIN_DETECTIONS_FOR_PITCH,
      sampleCount: TRACKING.MIN_DETECTIONS_FOR_PITCH,
      cameraCount: 1,
    });
    const call = callPitch(traj, defaultTestZone());
    expect(call.confidence).toBeLessThan(CONFIDENCE.CONFIDENT);
    expect(call.caveats.length).toBeGreaterThan(0);
    expect(call.caveats.some((c) => c.toLowerCase().includes('single-camera'))).toBe(true);
  });

  it('never reports a flagged-band call as confident', () => {
    const traj = baseTraj({ residualM: 0.2, inlierCount: 5, sampleCount: 5, cameraCount: 1 });
    const call = callPitch(traj, defaultTestZone());
    expect(call.band).not.toBe('confident');
  });
});
