import { describe, expect, it } from 'vitest';
import { ACCEPTANCE, PLATE } from '@/domain/constants';
import { presetByName, simulate, aimedAt } from '../../../harness/physics';
import { defaultTestZone } from '../../../harness/metrics';
import { computeCrossing, solvePlaneCrossing } from '../plateCrossing';
import { fitTrajectoryFromGroundTruth } from './fitHelper';

describe('plate crossing: sub-frame accuracy against exact ground truth', () => {
  for (const name of ['fastball', 'drop', 'rise', 'curve', 'screw'] as const) {
    it(`recovers the ${name} preset's front and back crossings within tolerance`, () => {
      const gt = simulate(presetByName(name));
      const traj = fitTrajectoryFromGroundTruth(gt);
      const zone = defaultTestZone();

      const front = computeCrossing(traj, 'front', zone);
      const back = computeCrossing(traj, 'back', zone);

      const frontErr = Math.hypot(
        front.position.x - gt.crossings.front!.position.x,
        front.position.y - gt.crossings.front!.position.y,
      );
      const backErr = Math.hypot(
        back.position.x - gt.crossings.back!.position.x,
        back.position.y - gt.crossings.back!.position.y,
      );

      expect(frontErr).toBeLessThan(ACCEPTANCE.MAX_PLATE_CROSSING_ERROR_M);
      expect(backErr).toBeLessThan(ACCEPTANCE.MAX_PLATE_CROSSING_ERROR_M);
      expect(front.position.z).toBeCloseTo(PLATE.FRONT_Z_M, 9);
      expect(back.position.z).toBeCloseTo(PLATE.BACK_Z_M, 9);
    });
  }

  it('interpolates the model rather than snapping to a sample time', () => {
    const gt = simulate(presetByName('fastball'));
    const traj = fitTrajectoryFromGroundTruth(gt);
    const hit = solvePlaneCrossing(traj, PLATE.BACK_Z_M)!;
    // The ground-truth integrator steps every 0.5 ms; a sub-frame solve should not
    // land exactly on one of those steps for an arbitrary pitch.
    const nearestStepMs = Math.round(hit.tS / 0.0005) * 0.0005 * 1000;
    expect(Math.abs(hit.tS * 1000 - nearestStepMs)).toBeGreaterThan(0);
  });
});

describe('front/back plane: a pitch that misses front but clips back is a strike', () => {
  it('constructs the case explicitly with a dropCurve preset aimed to duck in late', () => {
    // The window for this rule is NARROW, and the numbers are worth stating because
    // they bound how much the front/back distinction can ever matter.
    //
    // The plate is 17 in deep, so the two planes are only 17-20 ms apart. Across that
    // gap the steepest preset (drop, heavy topspin) falls ~3.9 cm, and every other
    // preset falls less. The zone is inflated by a ball radius, 4.85 cm, on each side.
    // So the ball moves LESS between the planes than the inflation distance: the rule
    // only changes the call for pitches passing within ~2 cm of a zone edge.
    //
    // Aiming the back crossing 3 cm above the nominal top puts it ~1.8 cm inside the
    // inflated boundary while the front crossing sits ~1.8 cm outside it. That is the
    // widest split the physics allows, and it is what this case is pinned to.
    const zone = defaultTestZone();
    const spec = aimedAt(presetByName('drop'), 0, zone.topM + 0.03, 'drop-duck-in');
    const gt = simulate(spec);
    const traj = fitTrajectoryFromGroundTruth(gt);

    const front = computeCrossing(traj, 'front', zone);
    const back = computeCrossing(traj, 'back', zone);

    expect(back.isStrike).toBe(true);
    expect(front.isStrike).toBe(false);
    expect(front.position.y).toBeGreaterThan(back.position.y);
  });

  it('directly forces a front-miss/back-strike using independent x placement per plane', () => {
    // Build a synthetic FittedTrajectory directly: straight-line-ish horizontal
    // motion that sits outside the zone at the front plane and drifts inside by the
    // back plane, isolating the "evaluate both planes" rule from the physics model.
    const zone = defaultTestZone();
    const outsideAtFront = zone.halfWidthM + 0.06;
    const insideAtBack = 0.0;
    // Solve a constant-acceleration x(t) matching x(tFront)=outsideAtFront and
    // x(tBack)=insideAtBack, straight vertical/depth motion of a normal fastball.
    const fbGt = simulate(presetByName('fastball'));
    const traj = fitTrajectoryFromGroundTruth(fbGt);
    const tFront = solvePlaneCrossing(traj, PLATE.FRONT_Z_M)!.tS;
    const tBack = solvePlaneCrossing(traj, PLATE.BACK_Z_M)!.tS;

    // Linear x(t) through the two target points; overwrite p0.x/v0.x/a.x=0.
    const vx = (insideAtBack - outsideAtFront) / (tBack - tFront);
    const x0 = outsideAtFront - vx * tFront;
    const synthetic = { ...traj, p0: { ...traj.p0, x: x0 }, v0: { ...traj.v0, x: vx }, a: { ...traj.a, x: 0 } };

    const front = computeCrossing(synthetic, 'front', zone);
    const back = computeCrossing(synthetic, 'back', zone);

    expect(front.isStrike).toBe(false);
    expect(back.isStrike).toBe(true);

    const call = { result: back.isStrike ? 'strike' : 'ball', strikePlane: back.isStrike ? 'back' : null };
    expect(call.result).toBe('strike');
    expect(call.strikePlane).toBe('back');
  });
});
