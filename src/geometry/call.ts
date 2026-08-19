/**
 * The strike/ball decision (Section 4 + Section 16). Both plate planes are always
 * evaluated; a strike at either is a strike. Confidence comes from track quality —
 * detection count, fit residual, camera count — never from how clean the call looks,
 * so a borderline pitch tracked well is still reported honestly as borderline.
 */

import { ACCEPTANCE, BALL, TRACKING, confidenceBand } from '@/domain/constants';
import type { FittedTrajectory, PitchCall, StrikeZone } from '@/domain/types';
import { computeCrossing } from './plateCrossing';

function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v));
}

/**
 * Weighted blend of detection count, fit residual and camera count. Each term maps
 * to [0,1] independently before blending, so a track that is merely thin (few
 * detections) but otherwise clean does not collapse to zero confidence the way a
 * multiplicative score would.
 */
export function trackConfidence(traj: FittedTrajectory): number {
  const detectionScore = clamp01(
    (traj.inlierCount - TRACKING.MIN_DETECTIONS_FOR_PITCH) / TRACKING.MIN_DETECTIONS_FOR_PITCH,
  );
  const residualScore = clamp01(1 - traj.residualM / BALL.RADIUS_M);
  const cameraScore = traj.cameraCount === 2 ? 1 : 0.5;
  return clamp01(0.45 * detectionScore + 0.4 * residualScore + 0.15 * cameraScore);
}

export function callPitch(traj: FittedTrajectory, zone: StrikeZone): PitchCall {
  const front = computeCrossing(traj, 'front', zone);
  const back = computeCrossing(traj, 'back', zone);

  const strike = front.isStrike || back.isStrike;
  // Front edge is the conventional call point; the back point only overrides it for
  // a pitch that ducks into the zone late, which front.isStrike already excludes.
  const strikePlane = strike ? (front.isStrike ? 'front' : 'back') : null;

  const confidence = trackConfidence(traj);
  const band = confidenceBand(confidence);

  const caveats: string[] = [];
  if (band === 'flagged') {
    caveats.push('Track quality is too low to trust this call; treat it as provisional.');
  } else if (band === 'tentative') {
    caveats.push('Track quality is below the confident threshold.');
  }
  if (traj.cameraCount === 1) {
    caveats.push('Single-camera mode: depth and break are approximate.');
  }
  const nearestEdgeM = Math.min(Math.abs(front.marginM), Math.abs(back.marginM));
  if (nearestEdgeM <= ACCEPTANCE.BORDERLINE_MARGIN_M) {
    caveats.push('Pitch crossed close to the zone edge.');
  }

  return { result: strike ? 'strike' : 'ball', strikePlane, front, back, confidence, band, caveats };
}
