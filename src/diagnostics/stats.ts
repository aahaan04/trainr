/**
 * Pure statistics for the capability probe, split out so the numbers the report
 * quotes are unit-tested rather than trusted.
 */

export function percentile(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) return NaN;
  if (sorted.length === 1) return sorted[0];
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

export function mean(values: readonly number[]): number {
  if (values.length === 0) return NaN;
  let s = 0;
  for (const v of values) s += v;
  return s / values.length;
}

export interface IntervalStats {
  frames: number;
  durationS: number;
  fps: number;
  meanIntervalMs: number;
  medianIntervalMs: number;
  p95IntervalMs: number;
  longIntervals: number;
}

/**
 * Turns a list of frame presentation timestamps into delivery statistics.
 *
 * fps is computed from the total span rather than 1000/meanInterval, because a
 * handful of very long stalls skews the mean interval far more than it changes the
 * real throughput, and throughput is the number that matters for the pipeline
 * budget. `longIntervals` counts gaps over 1.5x the median, which is the honest way
 * to surface dropped frames: a camera that reports 60 fps while stalling every
 * tenth frame is not delivering 60 fps.
 */
export function intervalStats(timestampsMs: readonly number[]): IntervalStats {
  const n = timestampsMs.length;
  if (n < 2) {
    return {
      frames: n,
      durationS: 0,
      fps: 0,
      meanIntervalMs: NaN,
      medianIntervalMs: NaN,
      p95IntervalMs: NaN,
      longIntervals: 0,
    };
  }
  const intervals: number[] = [];
  for (let i = 1; i < n; i++) intervals.push(timestampsMs[i] - timestampsMs[i - 1]);
  const sorted = [...intervals].sort((a, b) => a - b);
  const median = percentile(sorted, 0.5);
  const durationS = (timestampsMs[n - 1] - timestampsMs[0]) / 1000;

  return {
    frames: n,
    durationS,
    fps: durationS > 0 ? (n - 1) / durationS : 0,
    meanIntervalMs: mean(intervals),
    medianIntervalMs: median,
    p95IntervalMs: percentile(sorted, 0.95),
    longIntervals: intervals.filter((v) => v > median * 1.5).length,
  };
}

/** Mean luma over an RGBA buffer, subsampled for speed. Rec. 601 weights. */
export function meanLuma(rgba: Uint8ClampedArray, stridePixels = 7): { meanLuma: number; sampledPixels: number } {
  let sum = 0;
  let count = 0;
  const step = Math.max(1, stridePixels) * 4;
  for (let i = 0; i < rgba.length; i += step) {
    sum += 0.299 * rgba[i] + 0.587 * rgba[i + 1] + 0.114 * rgba[i + 2];
    count++;
  }
  return { meanLuma: count ? sum / count : 0, sampledPixels: count };
}
