/**
 * Train/predict orchestration (Section 6.3). Cold start (no model) uses rules.ts;
 * once a pitcher has enough labels per type the model graduates rules -> kNN ->
 * logistic regression. Training reads labelled history and writes a PitcherModel to
 * db.models; prediction never touches `labeledType` on a PitchRecord — that field is
 * ground truth and is set only by a human tap, never by this module.
 */

import { CLASSIFIER } from '@/domain/constants';
import { toInches, toMph } from '@/domain/units';
import { db } from '@/storage/db';
import { labeledPitchesForPitcher } from '@/storage/db';
import type {
  Handedness,
  PitchMeasurements,
  PitcherModel,
  PitchPrediction,
  PitchRecord,
  PitchTypeId,
} from '@/domain/types';
import { meanStd, toFeatureVector, zScore } from './features';
import { knnPredict, type KnnExample } from './knn';
import { predictLogisticProbs, trainLogistic } from './logistic';
import { breakSide, coldStartPredict } from './rules';

function describePitch(m: PitchMeasurements, handedness: Handedness): string {
  const mphVal = Math.round(toMph(m.plateSpeedMps));
  const horizIn = toInches(m.horizontalBreakM);
  const vertIn = toInches(m.verticalBreakM);
  if (Math.abs(horizIn) < 1 && Math.abs(vertIn) < 1) return `${mphVal} mph, minimal break`;
  if (Math.abs(horizIn) >= Math.abs(vertIn)) {
    const side = breakSide(m.horizontalBreakM, handedness);
    return `${mphVal} mph, ${Math.abs(horizIn).toFixed(0)} in of ${side === 'armSide' ? 'arm-side' : 'glove-side'} break`;
  }
  const vertical = vertIn < 0 ? 'extra drop' : 'ride';
  return `${mphVal} mph, ${Math.abs(vertIn).toFixed(0)} in of ${vertical}`;
}

/** Builds a model from a set of already-labelled pitch records, no DB access. */
export function buildModel(pitcherId: string, labeled: readonly PitchRecord[]): PitcherModel {
  const counts = new Map<PitchTypeId, number>();
  for (const p of labeled) {
    if (!p.labeledType) continue;
    counts.set(p.labeledType, (counts.get(p.labeledType) ?? 0) + 1);
  }
  const includedClasses = [...counts.entries()]
    .filter(([, c]) => c >= CLASSIFIER.KNN_FALLBACK_MIN)
    .map(([t]) => t)
    .sort();

  const trainingRows = labeled.filter((p) => p.labeledType && includedClasses.includes(p.labeledType));
  const trainingFeatures = trainingRows.map((p) => toFeatureVector(p.measurements));
  const allFeatures = labeled.map((p) => toFeatureVector(p.measurements));
  const { mean, std } = meanStd(trainingFeatures.length > 0 ? trainingFeatures : allFeatures);

  const base = {
    pitcherId,
    mean,
    std,
    trainedAt: Date.now(),
    trainingCount: labeled.length,
  };

  if (includedClasses.length < 2) {
    return { ...base, kind: 'rules', classes: includedClasses };
  }

  const minCount = Math.min(...includedClasses.map((t) => counts.get(t)!));

  if (minCount >= CLASSIFIER.MIN_LABELS_PER_TYPE) {
    const zRows = trainingFeatures.map((v) => zScore(v, mean, std));
    const labels = trainingRows.map((p) => p.labeledType as PitchTypeId);
    const fit = trainLogistic(zRows, labels, includedClasses);
    return { ...base, kind: 'logistic', classes: includedClasses, weights: fit.weights, bias: fit.bias };
  }

  const examples: KnnExample[] = trainingRows.map((p, i) => ({
    features: zScore(trainingFeatures[i], mean, std),
    label: p.labeledType as PitchTypeId,
  }));
  return { ...base, kind: 'knn', classes: includedClasses, examples };
}

export async function trainModel(pitcherId: string): Promise<PitcherModel> {
  const labeled = await labeledPitchesForPitcher(pitcherId);
  return buildModel(pitcherId, labeled);
}

export async function trainAndPersist(pitcherId: string): Promise<PitcherModel> {
  const model = await trainModel(pitcherId);
  await db.models.put(model);
  return model;
}

/** Predicts with an already-built model. Pure, synchronous — safe for tests and the UI thread. */
export function predictWithModel(
  model: PitcherModel,
  measurements: PitchMeasurements,
  handedness: Handedness,
  coldStartPool: readonly PitchMeasurements[] = [],
): PitchPrediction {
  const features = toFeatureVector(measurements);

  if (model.kind === 'logistic' && model.weights && model.bias) {
    const z = zScore(features, model.mean, model.std);
    const probs = predictLogisticProbs(
      { classes: model.classes, weights: model.weights, bias: model.bias, iterations: 0, finalLoss: 0 },
      z,
    );
    let bestIdx = 0;
    for (let i = 1; i < probs.length; i++) if (probs[i] > probs[bestIdx]) bestIdx = i;
    return {
      type: model.classes[bestIdx],
      confidence: probs[bestIdx],
      reason: describePitch(measurements, handedness),
      source: 'logistic',
    };
  }

  if (model.kind === 'knn' && model.examples) {
    const z = zScore(features, model.mean, model.std);
    const prediction = knnPredict(z, model.examples, CLASSIFIER.KNN_K);
    return { ...prediction, reason: describePitch(measurements, handedness) };
  }

  const pool = coldStartPool.length > 0 ? coldStartPool : [measurements];
  return coldStartPredict(measurements, pool, handedness);
}

/** Loads (or lazily builds) the pitcher's model, then predicts. */
export async function predictPitch(
  pitcherId: string,
  measurements: PitchMeasurements,
  handedness: Handedness,
  coldStartPool: readonly PitchMeasurements[] = [],
): Promise<PitchPrediction> {
  const model = (await db.models.get(pitcherId)) ?? (await trainAndPersist(pitcherId));
  return predictWithModel(model, measurements, handedness, coldStartPool);
}

/**
 * Sets predictedType/predictionConfidence/predictionReason on a pitch record.
 * `labeledType` is ground truth from a human tap and is NEVER read or written here,
 * regardless of what the prediction says — Section 6.3's non-negotiable rule.
 */
export function applyPrediction(pitch: PitchRecord, prediction: PitchPrediction): PitchRecord {
  return {
    ...pitch,
    predictedType: prediction.type,
    predictionConfidence: prediction.confidence,
    predictionReason: prediction.reason,
  };
}

type IdleScheduler = (cb: () => void) => void;

const scheduleIdle: IdleScheduler =
  typeof requestIdleCallback === 'function' ? (cb) => requestIdleCallback(cb) : (cb) => setTimeout(cb, 0);

/** Retrains off the main thread's critical path. Fire-and-forget by design. */
export function scheduleRetrain(pitcherId: string): void {
  scheduleIdle(() => {
    void trainAndPersist(pitcherId);
  });
}
