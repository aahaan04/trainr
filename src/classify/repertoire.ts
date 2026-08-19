/**
 * Repertoire separation (Section 6.3): if two pitch types sit on top of each other
 * in feature space, a batter cannot read the difference out of the delivery any
 * better than the tracker can. Overlap is measured with leave-one-out 1-NN error
 * restricted to each pair — a point whose nearest neighbour (excluding itself)
 * carries the other label is a "confusion". This needs no distributional
 * assumptions and degrades gracefully on the small samples a bullpen produces.
 */

import { CLASSIFIER } from '@/domain/constants';
import { FEATURE_KEYS } from '@/domain/types';
import type { FeatureVector, PitchTypeId } from '@/domain/types';
import { meanStd, zScore } from './features';

export interface RepertoireExample {
  type: PitchTypeId;
  features: FeatureVector;
}

export interface RepertoirePair {
  a: PitchTypeId;
  b: PitchTypeId;
  countA: number;
  countB: number;
  /** Fraction of the pooled leave-one-out 1-NN calls that crossed the label boundary. */
  overlapRate: number;
  warn: boolean;
}

const MIN_PER_TYPE = 3;

function distance(a: FeatureVector, b: FeatureVector): number {
  let sum = 0;
  for (const k of FEATURE_KEYS) {
    const d = a[k] - b[k];
    sum += d * d;
  }
  return Math.sqrt(sum);
}

function pairOverlap(a: RepertoireExample[], b: RepertoireExample[]): number {
  const pool = [...a, ...b];
  const z = meanStd(pool.map((p) => p.features));
  const scaled = pool.map((p) => ({ type: p.type, features: zScore(p.features, z.mean, z.std) }));

  let confusions = 0;
  for (let i = 0; i < scaled.length; i++) {
    let bestJ = -1;
    let bestDist = Infinity;
    for (let j = 0; j < scaled.length; j++) {
      if (j === i) continue;
      const d = distance(scaled[i].features, scaled[j].features);
      if (d < bestDist) {
        bestDist = d;
        bestJ = j;
      }
    }
    if (bestJ >= 0 && scaled[bestJ].type !== scaled[i].type) confusions++;
  }
  return scaled.length > 0 ? confusions / scaled.length : 0;
}

/** All present-type pairs with enough examples each, ranked worst overlap first. */
export function analyzeRepertoire(examples: readonly RepertoireExample[]): RepertoirePair[] {
  const byType = new Map<PitchTypeId, RepertoireExample[]>();
  for (const ex of examples) {
    const list = byType.get(ex.type) ?? [];
    list.push(ex);
    byType.set(ex.type, list);
  }

  const types = [...byType.keys()].filter((t) => (byType.get(t)?.length ?? 0) >= MIN_PER_TYPE).sort();
  const pairs: RepertoirePair[] = [];

  for (let i = 0; i < types.length; i++) {
    for (let j = i + 1; j < types.length; j++) {
      const a = types[i];
      const b = types[j];
      const groupA = byType.get(a)!;
      const groupB = byType.get(b)!;
      const overlapRate = pairOverlap(groupA, groupB);
      pairs.push({
        a,
        b,
        countA: groupA.length,
        countB: groupB.length,
        overlapRate,
        warn: overlapRate >= CLASSIFIER.REPERTOIRE_OVERLAP_WARN,
      });
    }
  }

  return pairs.sort((x, y) => y.overlapRate - x.overlapRate);
}

export function repertoireWarningCopy(pair: RepertoirePair, label: (t: PitchTypeId) => string): string {
  const pct = Math.round(pair.overlapRate * 100);
  return `Your ${label(pair.a)} and ${label(pair.b)} look about ${pct}% alike to the tracker — a batter likely can't tell them apart either.`;
}
