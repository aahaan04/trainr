/**
 * Cold-start classification (Section 6.3): no learned model yet, so a pitch type is
 * suggested from where a measurement sits relative to the rest of the pitcher's
 * unlabelled pool. Fastest cluster -> fastball. Same shape, 6-12 mph slower ->
 * changeup (COLD_START bounds). Dominant horizontal break -> curve or screw, split
 * by which side of the pitcher's body it breaks toward. Dominant vertical break ->
 * drop or rise. Moderate amounts of both at once -> drop curve.
 */

import { COLD_START } from '@/domain/constants';
import { mph, toInches, toMph } from '@/domain/units';
import type { Handedness, PitchMeasurements, PitchPrediction, PitchTypeId } from '@/domain/types';

/** A RH pitcher's arm side is world -X (see harness/physics.ts spin sign notes). */
export function breakSide(horizontalBreakM: number, handedness: Handedness): 'armSide' | 'gloveSide' {
  const negativeIsArmSide = handedness === 'right';
  const isNegative = horizontalBreakM < 0;
  if (negativeIsArmSide) return isNegative ? 'armSide' : 'gloveSide';
  return isNegative ? 'gloveSide' : 'armSide';
}

interface PoolStats {
  maxSpeedMps: number;
  horizAbsMean: number;
  horizAbsStd: number;
  vertMean: number;
  vertStd: number;
}

function mean(xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

function std(xs: number[], m: number): number {
  return Math.sqrt(mean(xs.map((x) => (x - m) ** 2)));
}

function analyzePool(pool: readonly PitchMeasurements[]): PoolStats {
  const speeds = pool.map((m) => m.plateSpeedMps);
  const horizAbs = pool.map((m) => Math.abs(m.horizontalBreakM));
  const vert = pool.map((m) => m.verticalBreakM);
  const horizAbsMean = mean(horizAbs);
  const vertMean = mean(vert);
  return {
    maxSpeedMps: Math.max(...speeds),
    horizAbsMean,
    horizAbsStd: std(horizAbs, horizAbsMean),
    vertMean,
    vertStd: std(vert, vertMean),
  };
}

/**
 * How many standard deviations a pitch's break sits above the pool's own mean.
 * Z-scored rather than ratio-to-max so that a pool with near-zero break variance
 * (e.g. a fastball/changeup-only bullpen) can't spuriously read every pitch as "the
 * biggest break in the set" just because ratios are noisy near zero.
 */
const DOMINANT_Z = 1.25;
const COMBO_Z = 0.5;
/** Within this of the pool's fastest pitch, a pitch counts as "the fast cluster". */
const FASTBALL_BAND_MPS = mph(3);

function reasonSpeedBreak(m: PitchMeasurements, breakLabel: string): string {
  const mph = Math.round(toMph(m.plateSpeedMps));
  return `${mph} mph, ${breakLabel}`;
}

function breakPhrase(inches: number, side: 'armSide' | 'gloveSide' | null, vertical: 'drop' | 'rise' | null): string {
  const parts: string[] = [];
  if (side) parts.push(`${inches.toFixed(0)} in of ${side === 'armSide' ? 'arm-side' : 'glove-side'} break`);
  if (vertical) parts.push(`${inches.toFixed(0)} in of ${vertical === 'drop' ? 'extra drop' : 'ride'}`);
  return parts.join(', ') || `${inches.toFixed(0)} in of break`;
}

/**
 * `pool` is every unlabelled measurement being reasoned about together (typically
 * the pitcher's whole cold-start bullpen so far); `target` must be one of its
 * members, or a pitch to be compared against it.
 */
export function coldStartPredict(
  target: PitchMeasurements,
  pool: readonly PitchMeasurements[],
  handedness: Handedness,
): PitchPrediction {
  const stats = analyzePool(pool.length > 0 ? pool : [target]);

  const breakZ = stats.horizAbsStd > 1e-6 ? (Math.abs(target.horizontalBreakM) - stats.horizAbsMean) / stats.horizAbsStd : 0;
  const vertZ = stats.vertStd > 1e-6 ? (target.verticalBreakM - stats.vertMean) / stats.vertStd : 0;
  const dropZ = Math.max(0, -vertZ);
  const riseZ = Math.max(0, vertZ);

  const strongestIsBreak = breakZ >= dropZ && breakZ >= riseZ;
  const strongestIsDrop = dropZ >= breakZ && dropZ >= riseZ;
  const strongestIsRise = riseZ >= breakZ && riseZ >= dropZ;

  if (breakZ >= DOMINANT_Z && strongestIsBreak) {
    const side = breakSide(target.horizontalBreakM, handedness);
    const type: PitchTypeId = side === 'gloveSide' ? 'curve' : 'screw';
    return {
      type,
      confidence: Math.min(0.9, 0.45 + 0.15 * breakZ),
      reason: reasonSpeedBreak(target, breakPhrase(toInches(Math.abs(target.horizontalBreakM)), side, null)),
      source: 'rules',
    };
  }

  if (dropZ >= DOMINANT_Z && strongestIsDrop) {
    return {
      type: 'drop',
      confidence: Math.min(0.9, 0.45 + 0.15 * dropZ),
      reason: reasonSpeedBreak(target, breakPhrase(toInches(Math.abs(target.verticalBreakM)), null, 'drop')),
      source: 'rules',
    };
  }

  if (riseZ >= DOMINANT_Z && strongestIsRise) {
    return {
      type: 'rise',
      confidence: Math.min(0.9, 0.45 + 0.15 * riseZ),
      reason: reasonSpeedBreak(target, breakPhrase(toInches(Math.abs(target.verticalBreakM)), null, 'rise')),
      source: 'rules',
    };
  }

  if (breakZ >= COMBO_Z && dropZ >= COMBO_Z) {
    const side = breakSide(target.horizontalBreakM, handedness);
    return {
      type: 'dropCurve',
      confidence: Math.min(0.85, 0.4 + 0.1 * (breakZ + dropZ)),
      reason: reasonSpeedBreak(
        target,
        breakPhrase(toInches(Math.abs(target.horizontalBreakM)), side, null) +
          `, ${toInches(Math.abs(target.verticalBreakM)).toFixed(0)} in of extra drop`,
      ),
      source: 'rules',
    };
  }

  const deltaFromFastMps = stats.maxSpeedMps - target.plateSpeedMps;
  if (deltaFromFastMps <= FASTBALL_BAND_MPS) {
    return {
      type: 'fastball',
      confidence: 0.55 + 0.3 * (1 - Math.min(1, deltaFromFastMps / FASTBALL_BAND_MPS)),
      reason: `${Math.round(toMph(target.plateSpeedMps))} mph, the fastest cluster in this session`,
      source: 'rules',
    };
  }

  if (deltaFromFastMps >= COLD_START.CHANGEUP_MIN_DELTA_MPS && deltaFromFastMps <= COLD_START.CHANGEUP_MAX_DELTA_MPS) {
    return {
      type: 'changeup',
      confidence: 0.55,
      reason: `${Math.round(toMph(target.plateSpeedMps))} mph, ${Math.round(toMph(deltaFromFastMps))} mph off the fastball with a similar shape`,
      source: 'rules',
    };
  }

  return {
    type: 'fastball',
    confidence: 0.3,
    reason: `${Math.round(toMph(target.plateSpeedMps))} mph, not enough of a pattern yet to say more`,
    source: 'rules',
  };
}

export function coldStartPredictBatch(
  pool: readonly PitchMeasurements[],
  handedness: Handedness,
): PitchPrediction[] {
  return pool.map((m) => coldStartPredict(m, pool, handedness));
}
