/**
 * Connected-component blob extraction over the segmentation mask, plus a min-area
 * rotated-rect fit for each component.
 *
 * Section 2 is explicit: at pitch speeds the ball is a streak, not a circle, so
 * NOTHING here gates on circularity. The rotated rect's minor axis approximates the
 * true ball diameter (used for depth); the major axis is the motion-blur streak
 * (used as a velocity cue). Gating is area, aspect ratio, hue consistency, and a
 * fill-ratio "streak coherence" check that a real streak still passes.
 */

import { TRACKING } from '@/domain/constants';

export interface RawBlob {
  /** Pixel count in mask space. */
  areaPx: number;
  centroidX: number;
  centroidY: number;
  minorAxisPx: number;
  majorAxisPx: number;
  angleRad: number;
  meanHue: number;
  hueVariance: number;
  /** areaPx / (major*minor). Rejects scattered noise blobs a convex hull would paper over. */
  fillRatio: number;
}

export interface Point {
  x: number;
  y: number;
}

function cross(o: Point, a: Point, b: Point): number {
  return (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
}

/** Monotone-chain convex hull. Blob-sized inputs only (a handful to a few hundred points). */
function convexHull(pts: readonly Point[]): Point[] {
  const sorted = [...pts].sort((a, b) => a.x - b.x || a.y - b.y);
  const lower: Point[] = [];
  for (const p of sorted) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper: Point[] = [];
  for (let i = sorted.length - 1; i >= 0; i--) {
    const p = sorted[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  lower.pop();
  upper.pop();
  return lower.concat(upper);
}

interface RectResult {
  width: number;
  height: number;
  angleRad: number;
}

/** Rotating calipers over the hull edges. O(hull^2), fine for blob-sized hulls. */
function minAreaRect(hull: Point[]): RectResult {
  if (hull.length === 0) return { width: 1, height: 1, angleRad: 0 };
  if (hull.length === 1) return { width: 1, height: 1, angleRad: 0 };
  if (hull.length === 2) {
    const dx = hull[1].x - hull[0].x;
    const dy = hull[1].y - hull[0].y;
    return { width: Math.hypot(dx, dy) || 1, height: 1, angleRad: Math.atan2(dy, dx) };
  }

  let best: RectResult | null = null;
  let bestArea = Infinity;
  for (let i = 0; i < hull.length; i++) {
    const p1 = hull[i];
    const p2 = hull[(i + 1) % hull.length];
    const eLen = Math.hypot(p2.x - p1.x, p2.y - p1.y) || 1;
    const ux = (p2.x - p1.x) / eLen;
    const uy = (p2.y - p1.y) / eLen;
    const vx = -uy;
    const vy = ux;
    let minU = Infinity;
    let maxU = -Infinity;
    let minV = Infinity;
    let maxV = -Infinity;
    for (const p of hull) {
      const u = p.x * ux + p.y * uy;
      const v = p.x * vx + p.y * vy;
      if (u < minU) minU = u;
      if (u > maxU) maxU = u;
      if (v < minV) minV = v;
      if (v > maxV) maxV = v;
    }
    const width = maxU - minU;
    const height = maxV - minV;
    const area = width * height;
    if (area < bestArea) {
      bestArea = area;
      best = { width: Math.max(width, 1e-6), height: Math.max(height, 1e-6), angleRad: Math.atan2(uy, ux) };
    }
  }
  return best!;
}

function normalizeAngle(a: number): number {
  let x = a % Math.PI;
  if (x > Math.PI / 2) x -= Math.PI;
  if (x < -Math.PI / 2) x += Math.PI;
  return x;
}

export class BlobExtractor {
  private visited = new Uint8Array(0);
  private stackX = new Int32Array(0);
  private stackY = new Int32Array(0);
  private blobIdxX = new Int32Array(0);
  private blobIdxY = new Int32Array(0);
  private width = 0;
  private height = 0;

  private ensure(width: number, height: number): void {
    if (this.width === width && this.height === height && this.visited.length > 0) return;
    this.width = width;
    this.height = height;
    const n = width * height;
    this.visited = new Uint8Array(n);
    this.stackX = new Int32Array(n);
    this.stackY = new Int32Array(n);
    this.blobIdxX = new Int32Array(n);
    this.blobIdxY = new Int32Array(n);
  }

  extract(mask: Uint8Array, hue: Uint8Array, width: number, height: number): RawBlob[] {
    this.ensure(width, height);
    this.visited.fill(0);
    const blobs: RawBlob[] = [];

    for (let start = 0; start < width * height; start++) {
      if (mask[start] !== 1 || this.visited[start] === 1) continue;

      let sp = 0;
      this.stackX[sp] = start % width;
      this.stackY[sp] = (start / width) | 0;
      sp++;
      this.visited[start] = 1;
      let count = 0;

      while (sp > 0) {
        sp--;
        const cx = this.stackX[sp];
        const cy = this.stackY[sp];
        this.blobIdxX[count] = cx;
        this.blobIdxY[count] = cy;
        count++;

        for (let dy = -1; dy <= 1; dy++) {
          const ny = cy + dy;
          if (ny < 0 || ny >= height) continue;
          for (let dx = -1; dx <= 1; dx++) {
            if (dx === 0 && dy === 0) continue;
            const nx = cx + dx;
            if (nx < 0 || nx >= width) continue;
            const nIdx = ny * width + nx;
            if (mask[nIdx] !== 1 || this.visited[nIdx] === 1) continue;
            this.visited[nIdx] = 1;
            this.stackX[sp] = nx;
            this.stackY[sp] = ny;
            sp++;
          }
        }
      }

      blobs.push(this.buildBlob(count, hue, width));
    }

    return blobs;
  }

  private buildBlob(count: number, hue: Uint8Array, width: number): RawBlob {
    let sumX = 0;
    let sumY = 0;
    let sumHue = 0;
    const hues = new Array<number>(count);
    for (let i = 0; i < count; i++) {
      sumX += this.blobIdxX[i];
      sumY += this.blobIdxY[i];
      const h = hue[this.blobIdxY[i] * width + this.blobIdxX[i]];
      hues[i] = h;
      sumHue += h;
    }
    const centroidX = sumX / count + 0.5;
    const centroidY = sumY / count + 0.5;
    const meanHue = sumHue / count;
    let hueVarSum = 0;
    for (let i = 0; i < count; i++) {
      const d = hues[i] - meanHue;
      hueVarSum += d * d;
    }
    const hueVariance = hueVarSum / count;

    const pts: Point[] = new Array(count);
    for (let i = 0; i < count; i++) pts[i] = { x: this.blobIdxX[i], y: this.blobIdxY[i] };
    const { majorAxisPx, minorAxisPx, angleRad } = fitRotatedRect(pts);
    const fillRatio = count / (majorAxisPx * minorAxisPx);

    return { areaPx: count, centroidX, centroidY, minorAxisPx, majorAxisPx, angleRad, meanHue, hueVariance, fillRatio };
  }
}

/**
 * Min-area rotated rect over a point set, reduced to (major, minor, angle). Exposed
 * so pipeline.ts can re-run the same fit at full resolution on the tiny pixel set
 * around an already-gated candidate -- the half-resolution mask that `extract`
 * itself runs on is coarse enough to quantize the minor axis (hence depth) into
 * visible steps at typical plate-cam ranges; a full-res refinement of just the
 * handful of candidates that survived gating fixes that without paying full-frame
 * cost twice.
 */
export function fitRotatedRect(points: readonly Point[]): { majorAxisPx: number; minorAxisPx: number; angleRad: number } {
  const hull = convexHull(points);
  const rect = minAreaRect(hull);
  const majorAxisPx = Math.max(rect.width, rect.height, 1);
  const minorAxisPx = Math.max(Math.min(rect.width, rect.height), 1);
  const angleRad = normalizeAngle(rect.width >= rect.height ? rect.angleRad : rect.angleRad + Math.PI / 2);
  return { majorAxisPx, minorAxisPx, angleRad };
}

export interface BlobGateOptions {
  minAreaPx: number;
  maxAreaPx: number;
  maxAspectRatio: number;
  maxHueVariance: number;
  minFillRatio: number;
  /** Mask-space minor-axis window implied by the current tracked depth, when known. */
  expectedMinorAxisPxRange?: [number, number];
}

export const DEFAULT_BLOB_GATE: BlobGateOptions = {
  minAreaPx: TRACKING.MIN_BLOB_AREA_PX,
  maxAreaPx: TRACKING.MAX_BLOB_AREA_PX,
  maxAspectRatio: TRACKING.MAX_BLOB_ASPECT_RATIO,
  maxHueVariance: TRACKING.MAX_HUE_VARIANCE,
  minFillRatio: 0.22,
};

/** Never filters on circularity -- see the module header. */
export function gateBlobs(blobs: RawBlob[], opts: BlobGateOptions = DEFAULT_BLOB_GATE): RawBlob[] {
  return blobs.filter((b) => {
    if (b.areaPx < opts.minAreaPx || b.areaPx > opts.maxAreaPx) return false;
    const aspect = b.majorAxisPx / Math.max(b.minorAxisPx, 1e-6);
    if (aspect > opts.maxAspectRatio) return false;
    if (b.hueVariance > opts.maxHueVariance) return false;
    if (b.fillRatio < opts.minFillRatio) return false;
    if (opts.expectedMinorAxisPxRange) {
      const [lo, hi] = opts.expectedMinorAxisPxRange;
      if (b.minorAxisPx < lo || b.minorAxisPx > hi) return false;
    }
    return true;
  });
}
