import { describe, expect, it } from 'vitest';
import { HSV_GATE_SEED } from '@/domain/constants';
import {
  fitHsvGate,
  fitNegativeGate,
  largestYellowRegion,
  rgbToHsv,
  sampleAllPixels,
  updateGateMovingAverage,
  type RgbaImage,
} from '../ballColor';

function solidImage(width: number, height: number, [r, g, b]: [number, number, number]): RgbaImage {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    data[i * 4] = r;
    data[i * 4 + 1] = g;
    data[i * 4 + 2] = b;
    data[i * 4 + 3] = 255;
  }
  return { data, width, height };
}

function paintRect(
  image: RgbaImage,
  rect: { x: number; y: number; w: number; h: number },
  [r, g, b]: [number, number, number],
): void {
  for (let y = rect.y; y < rect.y + rect.h; y++) {
    for (let x = rect.x; x < rect.x + rect.w; x++) {
      const i = (y * image.width + x) * 4;
      image.data[i] = r;
      image.data[i + 1] = g;
      image.data[i + 2] = b;
      image.data[i + 3] = 255;
    }
  }
}

describe('rgbToHsv', () => {
  it('matches known reference hues in OpenCV convention (H 0-179)', () => {
    expect(rgbToHsv(255, 0, 0)).toMatchObject({ h: 0, s: 255, v: 255 });
    expect(rgbToHsv(255, 255, 0).h).toBeCloseTo(30, 0); // yellow
    expect(rgbToHsv(0, 255, 0).h).toBeCloseTo(60, 0); // green
    expect(rgbToHsv(0, 255, 255).h).toBeCloseTo(90, 0); // cyan
    expect(rgbToHsv(0, 0, 255).h).toBeCloseTo(120, 0); // blue
    expect(rgbToHsv(255, 0, 255).h).toBeCloseTo(150, 0); // magenta
  });

  it('is achromatic (S=0) for gray', () => {
    const { s } = rgbToHsv(128, 128, 128);
    expect(s).toBe(0);
  });

  it('the regulation ball colour falls inside the HSV_GATE_SEED range', () => {
    const { h, s, v } = rgbToHsv(0xd8, 0xe6, 0x00);
    expect(h).toBeGreaterThanOrEqual(HSV_GATE_SEED.hMin);
    expect(h).toBeLessThanOrEqual(HSV_GATE_SEED.hMax);
    expect(s).toBeGreaterThanOrEqual(HSV_GATE_SEED.sMin);
    expect(v).toBeGreaterThanOrEqual(HSV_GATE_SEED.vMin);
  });
});

describe('largestYellowRegion', () => {
  it('finds the held ball against a neutral background and ignores a smaller yellow-ish speck', () => {
    const image = solidImage(40, 30, [60, 60, 60]); // gray background, S=0, outside the seed gate
    paintRect(image, { x: 10, y: 8, w: 12, h: 10 }, [0xd8, 0xe6, 0x00]); // the ball: 120 px
    paintRect(image, { x: 0, y: 0, w: 3, h: 3 }, [0xd8, 0xe6, 0x00]); // a small distractor: 9 px, disconnected

    const region = largestYellowRegion(image);
    expect(region).not.toBeNull();
    expect(region!.pixelIndices.length).toBe(120);
    expect(region!.bbox).toEqual({ x: 10, y: 8, width: 12, height: 10 });
  });

  it('returns null when nothing in frame matches the seed gate', () => {
    const image = solidImage(20, 20, [40, 40, 40]);
    expect(largestYellowRegion(image)).toBeNull();
  });
});

describe('fitHsvGate', () => {
  it('brackets a tight cluster with sensible padding', () => {
    const samples = Array.from({ length: 200 }, (_, i) => ({
      h: 28 + (i % 5),
      s: 200 + (i % 20),
      v: 210 + (i % 20),
    }));
    const gate = fitHsvGate(samples);
    expect(gate.hMin).toBeLessThanOrEqual(29);
    expect(gate.hMax).toBeGreaterThanOrEqual(31);
    expect(gate.hMax - gate.hMin).toBeLessThan(20); // padded, but not blown wide open
    expect(gate.sMin).toBeLessThanOrEqual(205);
    expect(gate.vMin).toBeLessThanOrEqual(215);
  });

  it('is robust to a handful of outliers via percentile clipping', () => {
    const clean = Array.from({ length: 95 }, () => ({ h: 30, s: 220, v: 220 }));
    const outliers = Array.from({ length: 5 }, () => ({ h: 170, s: 10, v: 10 }));
    const gate = fitHsvGate([...clean, ...outliers]);
    // The 5th/95th percentile should mostly exclude the 5% of outliers.
    expect(gate.hMax).toBeLessThan(100);
  });

  it('falls back to the seed gate for an empty sample', () => {
    expect(fitHsvGate([])).toEqual(HSV_GATE_SEED);
  });
});

describe('updateGateMovingAverage', () => {
  it('moves the gate toward a fresh sample slowly, proportional to alpha', () => {
    const current = { hMin: 20, hMax: 40, sMin: 60, sMax: 255, vMin: 100, vMax: 255 };
    const fresh = { hMin: 30, hMax: 50, sMin: 80, sMax: 255, vMin: 120, vMax: 255 };
    const next = updateGateMovingAverage(current, fresh, 0.1);
    expect(next.hMin).toBeCloseTo(21, 5); // 20 + (30-20)*0.1
    expect(next.hMax).toBeCloseTo(41, 5);
    expect(next.sMin).toBeCloseTo(62, 5);
  });

  it('does nothing at alpha=0 and fully adopts the fresh gate at alpha=1', () => {
    const current = { hMin: 20, hMax: 40, sMin: 60, sMax: 255, vMin: 100, vMax: 255 };
    const fresh = { hMin: 30, hMax: 50, sMin: 80, sMax: 200, vMin: 120, vMax: 230 };
    expect(updateGateMovingAverage(current, fresh, 0)).toEqual(current);
    expect(updateGateMovingAverage(current, fresh, 1)).toEqual(fresh);
  });
});

describe('negative colour model', () => {
  it('fits a tight gate around a sampled background patch, distinct from the ball', () => {
    const grayPatch = solidImage(10, 10, [90, 90, 95]);
    const samples = sampleAllPixels(grayPatch);
    const negGate = fitNegativeGate(samples);
    // Low, tight saturation band — nothing like the ball's high-saturation yellow.
    expect(negGate.sMax).toBeLessThan(HSV_GATE_SEED.sMin);
  });

  it('a yellow uniform patch is flagged distinctly from a neutral background', () => {
    const yellowUniform = solidImage(10, 10, [0xe0, 0xd0, 0x40]); // mustard, not optic yellow
    const samples = sampleAllPixels(yellowUniform);
    const negGate = fitNegativeGate(samples);
    expect(negGate.sMin).toBeGreaterThan(0);
    expect(negGate.hMax - negGate.hMin).toBeLessThan(10);
  });
});
