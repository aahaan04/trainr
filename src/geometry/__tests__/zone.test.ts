import { describe, expect, it } from 'vitest';
import { BALL } from '@/domain/constants';
import type { StrikeZone } from '@/domain/types';
import { evaluateZone } from '../plateCrossing';
import { evaluateZone as harnessEvaluateZone, defaultTestZone } from '../../../harness/metrics';

function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('evaluateZone agrees with the harness reference', () => {
  const zone: StrikeZone = defaultTestZone();
  const rand = mulberry32(1337);

  it('matches over a randomised sweep of ball centres', () => {
    for (let i = 0; i < 5000; i++) {
      const centre = {
        x: (rand() - 0.5) * 1.2,
        y: rand() * 2.2,
        z: 0,
      };
      const mine = evaluateZone(centre, zone);
      const ref = harnessEvaluateZone(centre, zone);
      expect(mine.inside).toBe(ref.inside);
      expect(mine.marginM).toBeCloseTo(ref.marginM, 9);
    }
  });

  it('matches across several rule-set-shaped zones, not just the default', () => {
    const zones: StrikeZone[] = [
      { ...zone, bottomM: 0.3, topM: 1.3 },
      { ...zone, halfWidthM: zone.halfWidthM * 1.1 },
      { ...zone, bottomM: 0.5, topM: 1.0, halfWidthM: zone.halfWidthM * 0.9 },
    ];
    for (const z of zones) {
      for (let i = 0; i < 500; i++) {
        const centre = { x: (rand() - 0.5) * 1.2, y: rand() * 2.2, z: 0 };
        expect(evaluateZone(centre, z)).toEqual(harnessEvaluateZone(centre, z));
      }
    }
  });

  it('calls a clip inside by less than a radius a strike, and clear-by-a-diameter a ball', () => {
    const clipping = { x: 0, y: zone.topM + BALL.RADIUS_M * 0.5, z: 0 };
    expect(evaluateZone(clipping, zone).inside).toBe(true);

    const clear = { x: 0, y: zone.topM + BALL.DIAMETER_M * 1.5, z: 0 };
    expect(evaluateZone(clear, zone).inside).toBe(false);
  });
});
