import { describe, expect, it } from 'vitest';
import { mph } from '@/domain/units';
import type { PitchMeasurements } from '@/domain/types';
import { coldStartPredict } from '../rules';

function measurement(overrides: Partial<PitchMeasurements>): PitchMeasurements {
  return {
    releasePoint: { x: -0.15, y: 0.58, z: -11.28 },
    releaseSpeedMps: mph(60),
    plateSpeedMps: mph(60),
    timeToPlateS: 0.42,
    horizontalBreakM: 0.02,
    verticalBreakM: 0.02,
    totalBreakM: 0.03,
    breakAngleRad: 0.5,
    extensionM: 1.8,
    releaseHeightM: 0.58,
    releaseSideM: -0.15,
    verticalApproachAngleRad: 0.3,
    horizontalApproachAngleRad: 0,
    breakIsApproximate: false,
    ...overrides,
  };
}

describe('coldStartPredict', () => {
  it('labels the fastest cluster fastball and the ~10 mph slower similar-shape cluster changeup', () => {
    const fastballs = Array.from({ length: 6 }, () => measurement({ plateSpeedMps: mph(62 + (Math.random() - 0.5)) }));
    const changeups = Array.from({ length: 6 }, () => measurement({ plateSpeedMps: mph(52 + (Math.random() - 0.5)) }));
    const pool = [...fastballs, ...changeups];

    for (const p of fastballs) {
      expect(coldStartPredict(p, pool, 'right').type).toBe('fastball');
    }
    for (const p of changeups) {
      expect(coldStartPredict(p, pool, 'right').type).toBe('changeup');
    }
  });

  it('distinguishes curve from screw purely by the sign of horizontal break', () => {
    const fastballs = Array.from({ length: 4 }, () => measurement({ plateSpeedMps: mph(62), horizontalBreakM: 0.01, verticalBreakM: 0.01 }));
    const curve = measurement({ plateSpeedMps: mph(57), horizontalBreakM: 0.18, verticalBreakM: 0.03 });
    const screw = measurement({ plateSpeedMps: mph(57), horizontalBreakM: -0.18, verticalBreakM: 0.03 });
    const pool = [...fastballs, curve, screw];

    expect(coldStartPredict(curve, pool, 'right').type).toBe('curve');
    expect(coldStartPredict(screw, pool, 'right').type).toBe('screw');
  });

  it('flips curve/screw sign mapping with handedness, since arm side flips', () => {
    const fastballs = Array.from({ length: 4 }, () => measurement({ plateSpeedMps: mph(62), horizontalBreakM: 0.01, verticalBreakM: 0.01 }));
    // Same world-frame break as the RH curve above, but thrown by a lefty.
    const sameSignPitch = measurement({ plateSpeedMps: mph(57), horizontalBreakM: 0.18, verticalBreakM: 0.03 });
    const pool = [...fastballs, sameSignPitch];

    expect(coldStartPredict(sameSignPitch, pool, 'right').type).toBe('curve');
    expect(coldStartPredict(sameSignPitch, pool, 'left').type).toBe('screw');
  });

  it('labels the largest late vertical drop as a drop ball', () => {
    const fastballs = Array.from({ length: 4 }, () => measurement({ plateSpeedMps: mph(61), verticalBreakM: 0.01, horizontalBreakM: 0.01 }));
    const drop = measurement({ plateSpeedMps: mph(59), verticalBreakM: -0.22, horizontalBreakM: 0.01 });
    const pool = [...fastballs, drop];

    expect(coldStartPredict(drop, pool, 'right').type).toBe('drop');
  });

  it('labels the largest positive vertical break as a rise ball', () => {
    const fastballs = Array.from({ length: 4 }, () => measurement({ plateSpeedMps: mph(61), verticalBreakM: 0.01, horizontalBreakM: 0.01 }));
    const rise = measurement({ plateSpeedMps: mph(61), verticalBreakM: 0.2, horizontalBreakM: 0.01 });
    const pool = [...fastballs, rise];

    expect(coldStartPredict(rise, pool, 'right').type).toBe('rise');
  });

  it('always returns a confidence score alongside the suggestion', () => {
    const pool = [measurement({}), measurement({ plateSpeedMps: mph(50) })];
    for (const p of pool) {
      const prediction = coldStartPredict(p, pool, 'right');
      expect(prediction.confidence).toBeGreaterThanOrEqual(0);
      expect(prediction.confidence).toBeLessThanOrEqual(1);
      expect(prediction.reason.length).toBeGreaterThan(0);
      expect(prediction.source).toBe('rules');
    }
  });
});
