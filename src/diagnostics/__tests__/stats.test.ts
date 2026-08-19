import { describe, expect, it } from 'vitest';
import { intervalStats, meanLuma, mean, percentile } from '../stats';

describe('percentile', () => {
  it('interpolates between samples', () => {
    expect(percentile([0, 10], 0.5)).toBeCloseTo(5, 9);
    expect(percentile([0, 10, 20, 30], 0.5)).toBeCloseTo(15, 9);
  });

  it('handles the degenerate cases', () => {
    expect(percentile([], 0.5)).toBeNaN();
    expect(percentile([7], 0.9)).toBe(7);
  });
});

describe('intervalStats', () => {
  it('measures a clean 60 fps stream', () => {
    const stamps = Array.from({ length: 61 }, (_, i) => i * (1000 / 60));
    const s = intervalStats(stamps);
    expect(s.fps).toBeCloseTo(60, 6);
    expect(s.medianIntervalMs).toBeCloseTo(16.667, 2);
    expect(s.longIntervals).toBe(0);
    expect(s.durationS).toBeCloseTo(1, 6);
  });

  /**
   * The case the report exists to catch: a camera reporting 60 fps that stalls
   * periodically. Throughput must reflect the stalls, and the stalls must be
   * counted rather than averaged away.
   */
  it('counts stalls and reports throughput below the nominal rate', () => {
    const stamps: number[] = [0];
    for (let i = 1; i <= 60; i++) {
      stamps.push(stamps[i - 1] + (i % 10 === 0 ? 60 : 16.667));
    }
    const s = intervalStats(stamps);
    expect(s.longIntervals).toBe(6);
    expect(s.fps).toBeLessThan(50);
    expect(s.medianIntervalMs).toBeCloseTo(16.667, 2);
    // The stalls must show up in the tail, not the middle.
    expect(s.p95IntervalMs).toBeGreaterThan(50);
  });

  it('returns a safe result for too few samples', () => {
    const s = intervalStats([5]);
    expect(s.frames).toBe(1);
    expect(s.fps).toBe(0);
    expect(s.longIntervals).toBe(0);
  });
});

describe('meanLuma', () => {
  it('reads pure white and pure black correctly', () => {
    const white = new Uint8ClampedArray(4 * 100).fill(255);
    expect(meanLuma(white, 1).meanLuma).toBeCloseTo(255, 6);

    const black = new Uint8ClampedArray(4 * 100);
    expect(meanLuma(black, 1).meanLuma).toBeCloseTo(0, 6);
  });

  it('weights green most heavily, per Rec. 601', () => {
    const green = new Uint8ClampedArray(4 * 10);
    for (let i = 0; i < green.length; i += 4) green[i + 1] = 255;
    const red = new Uint8ClampedArray(4 * 10);
    for (let i = 0; i < red.length; i += 4) red[i] = 255;
    expect(meanLuma(green, 1).meanLuma).toBeGreaterThan(meanLuma(red, 1).meanLuma);
  });

  it('subsamples by the requested stride', () => {
    const buf = new Uint8ClampedArray(4 * 100).fill(128);
    expect(meanLuma(buf, 10).sampledPixels).toBe(10);
  });
});

describe('mean', () => {
  it('averages', () => {
    expect(mean([1, 2, 3])).toBeCloseTo(2, 9);
    expect(mean([])).toBeNaN();
  });
});
