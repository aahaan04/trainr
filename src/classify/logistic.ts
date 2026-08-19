/**
 * Multinomial logistic regression, fit on-device with batch gradient descent on
 * z-scored features. No ML library — Section 6.3 asks for something small and
 * interpretable, and these datasets are hundreds of rows at most, so plain softmax
 * + gradient descent converges in well under a frame's worth of wall-clock time.
 */

import { FEATURE_KEYS } from '@/domain/types';
import type { FeatureVector, PitchTypeId } from '@/domain/types';
import { featureArray } from './features';

export interface LogisticFit {
  classes: PitchTypeId[];
  /** [class][feature]. */
  weights: number[][];
  bias: number[];
  iterations: number;
  finalLoss: number;
}

export interface LogisticTrainOptions {
  epochs?: number;
  learningRate?: number;
  l2?: number;
}

function softmax(logits: number[]): number[] {
  const max = Math.max(...logits);
  const exp = logits.map((v) => Math.exp(v - max));
  const sum = exp.reduce((a, b) => a + b, 0) || 1;
  return exp.map((v) => v / sum);
}

export function trainLogistic(
  X: FeatureVector[],
  y: PitchTypeId[],
  classes: readonly PitchTypeId[],
  opts: LogisticTrainOptions = {},
): LogisticFit {
  const { epochs = 400, learningRate = 0.3, l2 = 0.01 } = opts;
  const nFeatures = FEATURE_KEYS.length;
  const nClasses = classes.length;
  const n = X.length;

  const rows = X.map(featureArray);
  const labelIdx = y.map((label) => classes.indexOf(label));

  const weights: number[][] = Array.from({ length: nClasses }, () => new Array(nFeatures).fill(0));
  const bias: number[] = new Array(nClasses).fill(0);

  let finalLoss = 0;

  for (let epoch = 0; epoch < epochs; epoch++) {
    const gradW: number[][] = Array.from({ length: nClasses }, () => new Array(nFeatures).fill(0));
    const gradB: number[] = new Array(nClasses).fill(0);
    let loss = 0;

    for (let i = 0; i < n; i++) {
      const x = rows[i];
      const logits = weights.map((w, c) => bias[c] + w.reduce((s, wj, j) => s + wj * x[j], 0));
      const probs = softmax(logits);
      const trueIdx = labelIdx[i];
      loss -= Math.log(Math.max(probs[trueIdx], 1e-12));

      for (let c = 0; c < nClasses; c++) {
        const err = probs[c] - (c === trueIdx ? 1 : 0);
        gradB[c] += err;
        for (let j = 0; j < nFeatures; j++) gradW[c][j] += err * x[j];
      }
    }

    for (let c = 0; c < nClasses; c++) {
      bias[c] -= (learningRate * gradB[c]) / n;
      for (let j = 0; j < nFeatures; j++) {
        const reg = l2 * weights[c][j];
        weights[c][j] -= learningRate * (gradW[c][j] / n + reg);
      }
    }

    finalLoss = loss / n + (l2 / 2) * weights.flat().reduce((s, w) => s + w * w, 0);
  }

  return { classes: [...classes], weights, bias, iterations: epochs, finalLoss };
}

export function predictLogisticProbs(fit: LogisticFit, features: FeatureVector): number[] {
  const x = featureArray(features);
  const logits = fit.weights.map((w, c) => fit.bias[c] + w.reduce((s, wj, j) => s + wj * x[j], 0));
  return softmax(logits);
}
