/**
 * Section 3.3 — ball colour calibration. Fits a per-session HSV gate from the
 * actual game ball under the actual light, because HSV_GATE_SEED is explicitly a
 * seed, not a shippable constant (see constants.ts).
 *
 * Pure pixel math throughout — no DOM dependency beyond a plain {data,width,height}
 * shape any canvas ImageData structurally satisfies — so this is fully unit tested
 * against synthetic images.
 */

import type { HsvGate } from '@/domain/types';
import { HSV_GATE_SEED, HSV_OPENCV_MAX } from '@/domain/constants';

/** Anything with ImageData's shape. Kept structural (not `ImageData` itself) so this runs in Node tests too. */
export interface RgbaImage {
  data: Uint8ClampedArray | Uint8Array;
  width: number;
  height: number;
}

export interface HsvSample {
  h: number;
  s: number;
  v: number;
}

/** RGB (0-255) -> HSV in OpenCV convention: H 0-179, S 0-255, V 0-255. */
export function rgbToHsv(r: number, g: number, b: number): HsvSample {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const delta = max - min;

  let hDeg = 0;
  if (delta > 1e-9) {
    if (max === rn) hDeg = 60 * (((gn - bn) / delta) % 6);
    else if (max === gn) hDeg = 60 * ((bn - rn) / delta + 2);
    else hDeg = 60 * ((rn - gn) / delta + 4);
  }
  if (hDeg < 0) hDeg += 360;

  const s = max <= 1e-9 ? 0 : delta / max;
  const v = max;

  return { h: hDeg / 2, s: s * 255, v: v * 255 };
}

function withinGate(sample: HsvSample, gate: HsvGate): boolean {
  return (
    sample.h >= gate.hMin &&
    sample.h <= gate.hMax &&
    sample.s >= gate.sMin &&
    sample.s <= gate.sMax &&
    sample.v >= gate.vMin &&
    sample.v <= gate.vMax
  );
}

export interface YellowRegion {
  /** Pixel indices (row-major, one per image pixel) belonging to the largest connected component. */
  pixelIndices: number[];
  bbox: { x: number; y: number; width: number; height: number };
  samples: HsvSample[];
}

/**
 * Finds the largest 4-connected region whose pixels fall inside `seedGate`, via a
 * flood-fill union-find over the image. This is the "largest yellow-ish region" the
 * user's held ball produces against a background that is not solid optic yellow.
 */
export function largestYellowRegion(image: RgbaImage, seedGate: HsvGate = HSV_GATE_SEED): YellowRegion | null {
  const { width, height, data } = image;
  const n = width * height;
  const inGate = new Uint8Array(n);
  const hsv: HsvSample[] = new Array(n);

  for (let i = 0; i < n; i++) {
    const o = i * 4;
    const s = rgbToHsv(data[o], data[o + 1], data[o + 2]);
    hsv[i] = s;
    inGate[i] = withinGate(s, seedGate) ? 1 : 0;
  }

  const visited = new Uint8Array(n);
  let bestIndices: number[] = [];

  for (let start = 0; start < n; start++) {
    if (!inGate[start] || visited[start]) continue;
    const stack = [start];
    visited[start] = 1;
    const component: number[] = [];
    while (stack.length > 0) {
      const idx = stack.pop()!;
      component.push(idx);
      const x = idx % width;
      const y = (idx / width) | 0;
      const neighbors = [
        x > 0 ? idx - 1 : -1,
        x < width - 1 ? idx + 1 : -1,
        y > 0 ? idx - width : -1,
        y < height - 1 ? idx + width : -1,
      ];
      for (const nb of neighbors) {
        if (nb >= 0 && inGate[nb] && !visited[nb]) {
          visited[nb] = 1;
          stack.push(nb);
        }
      }
    }
    if (component.length > bestIndices.length) bestIndices = component;
  }

  if (bestIndices.length === 0) return null;

  let minX = width;
  let maxX = 0;
  let minY = height;
  let maxY = 0;
  for (const idx of bestIndices) {
    const x = idx % width;
    const y = (idx / width) | 0;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }

  return {
    pixelIndices: bestIndices,
    bbox: { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 },
    samples: bestIndices.map((idx) => hsv[idx]),
  };
}

function percentile(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

/**
 * Fits a gate at the 5th-95th percentile of the sample, padded outward. Padding
 * scales with the observed spread (a tight, consistent sample needs little padding;
 * a noisy one needs more) with a floor so a near-uniform sample still gets a usable
 * margin.
 */
export function fitHsvGate(samples: readonly HsvSample[], paddingFraction = 0.15): HsvGate {
  if (samples.length === 0) return { ...HSV_GATE_SEED };

  const hs = samples.map((s) => s.h).sort((a, b) => a - b);
  const ss = samples.map((s) => s.s).sort((a, b) => a - b);
  const vs = samples.map((s) => s.v).sort((a, b) => a - b);

  const hLo = percentile(hs, 0.05);
  const hHi = percentile(hs, 0.95);
  const sLo = percentile(ss, 0.05);
  const sHi = percentile(ss, 0.95);
  const vLo = percentile(vs, 0.05);
  const vHi = percentile(vs, 0.95);

  const pad = (lo: number, hi: number, floor: number) => Math.max(floor, (hi - lo) * paddingFraction);
  const hPad = pad(hLo, hHi, 2);
  const sPad = pad(sLo, sHi, 12);
  const vPad = pad(vLo, vHi, 12);

  return {
    hMin: clamp(Math.round(hLo - hPad), 0, HSV_OPENCV_MAX.h),
    hMax: clamp(Math.round(hHi + hPad), 0, HSV_OPENCV_MAX.h),
    sMin: clamp(Math.round(sLo - sPad), 0, HSV_OPENCV_MAX.s),
    sMax: clamp(Math.round(sHi + sPad), 0, HSV_OPENCV_MAX.s),
    vMin: clamp(Math.round(vLo - vPad), 0, HSV_OPENCV_MAX.v),
    vMax: clamp(Math.round(vHi + vPad), 0, HSV_OPENCV_MAX.v),
  };
}

/**
 * Slow moving average toward a freshly-fit gate from confirmed in-session
 * detections, so the gate tracks changing light (clouds rolling in, a shadow
 * crossing the plate) without one noisy frame yanking it around. The vision
 * pipeline calls this opportunistically, not every frame — see call-site note in
 * the setup wizard's ball-colour step.
 */
export function updateGateMovingAverage(current: HsvGate, freshSample: HsvGate, alpha = 0.05): HsvGate {
  const lerp = (a: number, b: number) => a + (b - a) * alpha;
  return {
    hMin: lerp(current.hMin, freshSample.hMin),
    hMax: lerp(current.hMax, freshSample.hMax),
    sMin: lerp(current.sMin, freshSample.sMin),
    sMax: lerp(current.sMax, freshSample.sMax),
    vMin: lerp(current.vMin, freshSample.vMin),
    vMax: lerp(current.vMax, freshSample.vMax),
  };
}

/**
 * The negative colour model: a tight (unpadded) gate around a sampled
 * background/uniform/equipment region, stored in `CameraSetupRecord.negativeColorSamples`
 * so the tracker can penalize candidates that match a known non-ball colour instead
 * of only requiring a positive HSV match.
 */
export function fitNegativeGate(samples: readonly HsvSample[]): HsvGate {
  return fitHsvGate(samples, 0.05);
}

/** Convenience: samples every pixel of an RgbaImage, e.g. a small crop the user drew around a non-ball region. */
export function sampleAllPixels(image: RgbaImage): HsvSample[] {
  const { data, width, height } = image;
  const n = width * height;
  const out: HsvSample[] = new Array(n);
  for (let i = 0; i < n; i++) {
    const o = i * 4;
    out[i] = rgbToHsv(data[o], data[o + 1], data[o + 2]);
  }
  return out;
}
