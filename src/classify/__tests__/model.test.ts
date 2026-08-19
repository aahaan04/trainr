import { describe, expect, it } from 'vitest';
import type { PitchTypeId } from '@/domain/types';
import { buildModel, predictWithModel, applyPrediction } from '../model';
import { generateLabeledPitches, measurementsForType, mulberry32 } from './syntheticData';

const TYPES = ['fastball', 'changeup', 'drop', 'rise', 'curve', 'screw', 'dropCurve'] as const;

function accuracyAt(labelsPerType: number, trainSeed: number, testSeed: number, testPerType = 12) {
  const train = generateLabeledPitches(TYPES, labelsPerType, trainSeed, `train-${labelsPerType}`);
  const model = buildModel('pitcher-1', train);

  const testRng = mulberry32(testSeed);
  let correct = 0;
  let total = 0;
  const confusion: Record<string, Record<string, number>> = {};

  for (const type of TYPES) {
    for (let i = 0; i < testPerType; i++) {
      const measurements = measurementsForType(type, testRng);
      const prediction = predictWithModel(model, measurements, 'right', []);
      total++;
      if (prediction.type === type) correct++;
      confusion[type] ??= {};
      confusion[type][prediction.type] = (confusion[type][prediction.type] ?? 0) + 1;
    }
  }

  return { accuracy: correct / total, kind: model.kind, confusion };
}

describe('classifier accuracy on synthetic repertoires', () => {
  it('separates the 7-type repertoire above chance at 5 labels per type', () => {
    const result = accuracyAt(5, 1001, 2001);
    // eslint-disable-next-line no-console
    console.log(`[accuracy] 5/type -> ${(result.accuracy * 100).toFixed(1)}% (${result.kind})`, result.confusion);
    expect(result.accuracy).toBeGreaterThan(1 / TYPES.length);
  });

  it('separates the 7-type repertoire well at 20 labels per type', () => {
    const result = accuracyAt(20, 1002, 2002);
    // eslint-disable-next-line no-console
    console.log(`[accuracy] 20/type -> ${(result.accuracy * 100).toFixed(1)}% (${result.kind})`, result.confusion);
    expect(result.accuracy).toBeGreaterThan(1 / TYPES.length);
  });

  it('separates the 7-type repertoire well at 50 labels per type', () => {
    const result = accuracyAt(50, 1003, 2003);
    // eslint-disable-next-line no-console
    console.log(`[accuracy] 50/type -> ${(result.accuracy * 100).toFixed(1)}% (${result.kind})`, result.confusion);
    expect(result.accuracy).toBeGreaterThan(1 / TYPES.length);
  });

  it('graduates from kNN to logistic regression as labels accumulate', () => {
    const low = accuracyAt(5, 1001, 2001);
    const high = accuracyAt(50, 1003, 2003);
    expect(low.kind).toBe('knn');
    expect(high.kind).toBe('logistic');
  });
});

describe('manual label protection', () => {
  it('never lets a prediction overwrite an existing manual label', () => {
    const [pitch] = generateLabeledPitches(['fastball'], 1, 55);
    expect(pitch.labeledType).toBe('fastball');

    const wrongPrediction = { type: 'curve' as PitchTypeId, confidence: 0.99, reason: 'test', source: 'logistic' as const };
    const updated = applyPrediction(pitch, wrongPrediction);

    expect(updated.labeledType).toBe('fastball');
    expect(updated.predictedType).toBe('curve');
    expect(updated.predictionConfidence).toBe(0.99);
  });

  it('sets predictedType/confidence/reason without ever reading or requiring labeledType', () => {
    const [pitch] = generateLabeledPitches(['fastball'], 1, 56);
    const unlabeled = { ...pitch, labeledType: null };
    const prediction = { type: 'fastball' as PitchTypeId, confidence: 0.8, reason: 'x', source: 'rules' as const };
    const updated = applyPrediction(unlabeled, prediction);
    expect(updated.labeledType).toBeNull();
    expect(updated.predictedType).toBe('fastball');
  });
});
