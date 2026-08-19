/**
 * k-NN fallback (Section 6.3) for pitcher datasets too small to fit logistic
 * regression on. Operates on already z-scored feature vectors: callers are
 * responsible for scaling with the same mean/std used to build `examples`.
 */

import { FEATURE_KEYS } from '@/domain/types';
import type { FeatureVector, PitchPrediction, PitchTypeId } from '@/domain/types';

export interface KnnExample {
  features: FeatureVector;
  label: PitchTypeId;
}

function distance(a: FeatureVector, b: FeatureVector): number {
  let sum = 0;
  for (const k of FEATURE_KEYS) {
    const d = a[k] - b[k];
    sum += d * d;
  }
  return Math.sqrt(sum);
}

export function knnPredict(target: FeatureVector, examples: readonly KnnExample[], k: number): PitchPrediction {
  if (examples.length === 0) {
    return { type: 'fastball', confidence: 0, reason: 'No prior pitches to compare against yet.', source: 'knn' };
  }

  const ranked = examples
    .map((ex) => ({ ex, dist: distance(target, ex.features) }))
    .sort((a, b) => a.dist - b.dist)
    .slice(0, Math.max(1, Math.min(k, examples.length)));

  const votes = new Map<PitchTypeId, number>();
  for (const { ex, dist } of ranked) {
    // Inverse-distance weighting; a near-exact match should dominate a tied vote.
    const weight = 1 / (dist + 1e-6);
    votes.set(ex.label, (votes.get(ex.label) ?? 0) + weight);
  }

  let bestType: PitchTypeId = ranked[0].ex.label;
  let bestWeight = -Infinity;
  let totalWeight = 0;
  for (const [type, weight] of votes) {
    totalWeight += weight;
    if (weight > bestWeight) {
      bestWeight = weight;
      bestType = type;
    }
  }

  const agreeing = ranked.filter((r) => r.ex.label === bestType).length;
  const confidence = totalWeight > 0 ? bestWeight / totalWeight : 0;

  return {
    type: bestType,
    confidence,
    reason: `Closest to ${agreeing} of your last ${ranked.length} similar pitches.`,
    source: 'knn',
  };
}
