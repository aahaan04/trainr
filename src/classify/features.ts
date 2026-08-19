/**
 * PitchMeasurements -> FeatureVector, plus z-scoring. FEATURE_KEYS order (from
 * domain/types.ts) is load-bearing: logistic weights and kNN examples are indexed
 * positionally against it, so nothing here may reorder or drop a key.
 */

import { FEATURE_KEYS, type FeatureVector, type PitchMeasurements } from '@/domain/types';

export function toFeatureVector(m: PitchMeasurements): FeatureVector {
  return {
    releaseSpeedMps: m.releaseSpeedMps,
    plateSpeedMps: m.plateSpeedMps,
    horizontalBreakM: m.horizontalBreakM,
    verticalBreakM: m.verticalBreakM,
    totalBreakM: m.totalBreakM,
    breakAngleRad: m.breakAngleRad,
    releaseHeightM: m.releaseHeightM,
    releaseSideM: m.releaseSideM,
    extensionM: m.extensionM,
    verticalApproachAngleRad: m.verticalApproachAngleRad,
    horizontalApproachAngleRad: m.horizontalApproachAngleRad,
  };
}

export function featureArray(v: FeatureVector): number[] {
  return FEATURE_KEYS.map((k) => v[k]);
}

export function vectorFromArray(arr: readonly number[]): FeatureVector {
  const out = {} as Record<string, number>;
  FEATURE_KEYS.forEach((k, i) => {
    out[k] = arr[i];
  });
  return out as FeatureVector;
}

const ZERO_VECTOR: FeatureVector = vectorFromArray(FEATURE_KEYS.map(() => 0));
const UNIT_VECTOR: FeatureVector = vectorFromArray(FEATURE_KEYS.map(() => 1));

export function meanStd(vectors: FeatureVector[]): { mean: FeatureVector; std: FeatureVector } {
  if (vectors.length === 0) return { mean: ZERO_VECTOR, std: UNIT_VECTOR };
  const n = vectors.length;
  const mean = {} as Record<string, number>;
  const std = {} as Record<string, number>;
  for (const k of FEATURE_KEYS) {
    let sum = 0;
    for (const v of vectors) sum += v[k];
    const m = sum / n;
    let sq = 0;
    for (const v of vectors) sq += (v[k] - m) ** 2;
    mean[k] = m;
    // A feature with zero spread (e.g. a single-pitch-type pool) must not blow up
    // z-scores, so it falls back to a std of 1 rather than 0.
    std[k] = Math.sqrt(sq / n) || 1;
  }
  return { mean: mean as FeatureVector, std: std as FeatureVector };
}

export function zScore(v: FeatureVector, mean: FeatureVector, std: FeatureVector): FeatureVector {
  const out = {} as Record<string, number>;
  for (const k of FEATURE_KEYS) out[k] = (v[k] - mean[k]) / (std[k] || 1);
  return out as FeatureVector;
}
