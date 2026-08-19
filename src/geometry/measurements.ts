/**
 * Pitch measurements (Section 4). Break is always measured against a model, never
 * against a raw sample: horizontal break is lateral deviation from a straight line
 * along the release velocity, vertical break is deviation from a gravity-only fall.
 *
 * Sign convention (matches harness/foundation.test.ts): vertical break is POSITIVE
 * when the ball drops LESS than gravity alone — the standard way a rise ball shows
 * up. Do not flip this.
 */

import { DEFAULT_PITCHING_DISTANCE_FT, PHYSICS, PLATE, rubberZ } from '@/domain/constants';
import { trajectoryPosition, trajectoryVelocity } from '@/domain/types';
import type { FittedTrajectory, PitchMeasurements } from '@/domain/types';
import { solvePlaneCrossing } from './plateCrossing';

export function computeMeasurements(
  traj: FittedTrajectory,
  pitchingDistanceFt: number = DEFAULT_PITCHING_DISTANCE_FT,
): PitchMeasurements {
  const releasePos = trajectoryPosition(traj, traj.tStartS);
  const releaseVel = trajectoryVelocity(traj, traj.tStartS);
  const releaseSpeedMps = Math.hypot(releaseVel.x, releaseVel.y, releaseVel.z);

  const hit = solvePlaneCrossing(traj, PLATE.BACK_Z_M) ?? solvePlaneCrossing(traj, PLATE.BACK_Z_M, 0.5);
  if (!hit) throw new Error('trajectory never reaches the plate');

  const plateVel = trajectoryVelocity(traj, hit.tS);
  const plateSpeedMps = Math.hypot(plateVel.x, plateVel.y, plateVel.z);
  const timeToPlateS = hit.tS - traj.tStartS;

  const straightX = releasePos.x + releaseVel.x * timeToPlateS;
  const horizontalBreakM = hit.position.x - straightX;

  const gravityOnlyY = releasePos.y + releaseVel.y * timeToPlateS - 0.5 * PHYSICS.GRAVITY_MPS2 * timeToPlateS * timeToPlateS;
  const verticalBreakM = hit.position.y - gravityOnlyY;

  const totalBreakM = Math.hypot(horizontalBreakM, verticalBreakM);
  const breakAngleRad = Math.atan2(verticalBreakM, horizontalBreakM);

  const extensionM = releasePos.z - rubberZ(pitchingDistanceFt);

  // Positive vertical approach angle = arriving on a downward slope, the usual case.
  const verticalApproachAngleRad = Math.atan2(-plateVel.y, Math.hypot(plateVel.x, plateVel.z));
  // Positive horizontal approach angle = arriving from the first-base side.
  const horizontalApproachAngleRad = Math.atan2(plateVel.x, plateVel.z);

  return {
    releasePoint: releasePos,
    releaseSpeedMps,
    plateSpeedMps,
    timeToPlateS,
    horizontalBreakM,
    verticalBreakM,
    totalBreakM,
    breakAngleRad,
    extensionM,
    releaseHeightM: releasePos.y,
    releaseSideM: releasePos.x,
    verticalApproachAngleRad,
    horizontalApproachAngleRad,
    breakIsApproximate: traj.cameraCount === 1,
  };
}
