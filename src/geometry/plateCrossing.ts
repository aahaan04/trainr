/**
 * Plate-plane crossings (Section 1 + Section 4). Two rules, non-negotiable:
 *
 *   1. A strike is any part of the ball touching any part of the zone, anywhere
 *      over the plate. Implemented as the ball CENTRE against the zone inflated by
 *      one ball radius on all sides (`evaluateZone`, kept byte-for-byte identical to
 *      harness/metrics.ts::evaluateZone — a randomised sweep test asserts agreement).
 *   2. Both plate planes (front edge, back point) are evaluated; either qualifying
 *      is a strike. A curve can miss the front and clip the back.
 *
 * Crossings are found by solving the fitted model's own quadratic for the plane,
 * never by picking the nearest sampled frame.
 */

import { PLATE, ZONE_RULES } from '@/domain/constants';
import { trajectoryPosition, trajectoryVelocity } from '@/domain/types';
import type { FittedTrajectory, PlateCrossing, PlatePlane, StrikeZone, Vec3 } from '@/domain/types';

export interface PlaneHit {
  tS: number;
  position: Vec3;
}

/**
 * Solves z0 + vz*t + 0.5*az*t^2 = planeZ analytically. Allows a small extrapolation
 * past the fitted span, since a real fit often ends a frame or two short of the back
 * point; prefers roots inside the fitted span when more than one is plausible.
 */
export function solvePlaneCrossing(
  traj: FittedTrajectory,
  planeZ: number,
  extrapolateS = 0.15,
): PlaneHit | null {
  const z0 = traj.p0.z - planeZ;
  const vz = traj.v0.z;
  const az = traj.a.z;

  const roots: number[] = [];
  if (Math.abs(az) < 1e-9) {
    if (Math.abs(vz) > 1e-9) roots.push(-z0 / vz);
  } else {
    const disc = vz * vz - 2 * az * z0;
    if (disc >= 0) {
      const sq = Math.sqrt(disc);
      roots.push((-vz + sq) / az, (-vz - sq) / az);
    }
  }

  const lo = traj.tStartS - extrapolateS;
  const hi = traj.tEndS + extrapolateS;
  const valid = roots.filter((t) => t >= lo && t <= hi);
  if (valid.length === 0) return null;

  valid.sort((a, b) => {
    const aIn = a >= traj.tStartS && a <= traj.tEndS ? 0 : 1;
    const bIn = b >= traj.tStartS && b <= traj.tEndS ? 0 : 1;
    if (aIn !== bIn) return aIn - bIn;
    return a - b;
  });

  const tS = valid[0];
  return { tS, position: trajectoryPosition(traj, tS) };
}

export function planeZFor(plane: PlatePlane): number {
  return plane === 'front' ? PLATE.FRONT_Z_M : PLATE.BACK_Z_M;
}

/**
 * Reference implementation of the inflation rule. Must stay identical to
 * harness/metrics.ts::evaluateZone; a randomised sweep test in
 * src/geometry/__tests__ asserts the two never diverge.
 */
export function evaluateZone(centre: Vec3, zone: StrikeZone): { inside: boolean; marginM: number } {
  const halfW = zone.halfWidthM + ZONE_RULES.INFLATION_M;
  const bottom = zone.bottomM - ZONE_RULES.INFLATION_M;
  const top = zone.topM + ZONE_RULES.INFLATION_M;

  const dx = Math.abs(centre.x) - halfW;
  const dy = Math.max(bottom - centre.y, centre.y - top);
  const outside = dx > 0 || dy > 0;
  const marginM = outside ? Math.hypot(Math.max(dx, 0), Math.max(dy, 0)) : Math.max(dx, dy);
  return { inside: !outside, marginM };
}

export function computeCrossing(traj: FittedTrajectory, plane: PlatePlane, zone: StrikeZone): PlateCrossing {
  const planeZ = planeZFor(plane);
  const hit = solvePlaneCrossing(traj, planeZ) ?? solvePlaneCrossing(traj, planeZ, 0.5);
  if (!hit) {
    throw new Error(`trajectory never reaches the ${plane} plate plane`);
  }
  const { inside, marginM } = evaluateZone(hit.position, zone);
  const vel = trajectoryVelocity(traj, hit.tS);
  return {
    plane,
    position: hit.position,
    timestampMs: traj.t0Ms + hit.tS * 1000,
    speedMps: Math.hypot(vel.x, vel.y, vel.z),
    isStrike: inside,
    marginM,
  };
}
