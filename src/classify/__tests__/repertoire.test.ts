import { describe, expect, it } from 'vitest';
import { toFeatureVector } from '../features';
import { analyzeRepertoire, type RepertoireExample } from '../repertoire';
import { measurementsForType, mulberry32 } from './syntheticData';

function examplesFor(type: string, count: number, rng: () => number): RepertoireExample[] {
  return Array.from({ length: count }, () => ({
    type: type as RepertoireExample['type'],
    features: toFeatureVector(measurementsForType(type, rng)),
  }));
}

describe('analyzeRepertoire', () => {
  it('warns when two types are generated from nearly identical distributions', () => {
    const rng = mulberry32(7);
    // "curve2" is not a real preset, so approximate near-identical overlap by
    // reusing curve's own distribution twice with independent draws.
    const a = examplesFor('curve', 25, rng);
    const b: RepertoireExample[] = Array.from({ length: 25 }, () => ({
      type: 'screw',
      features: toFeatureVector(measurementsForType('curve', rng)),
    }));

    const pairs = analyzeRepertoire([...a, ...b]);
    const pair = pairs.find((p) => (p.a === 'curve' && p.b === 'screw') || (p.a === 'screw' && p.b === 'curve'));
    expect(pair).toBeDefined();
    expect(pair!.warn).toBe(true);
    expect(pair!.overlapRate).toBeGreaterThan(0.3);
  });

  it('stays quiet when two types are well separated', () => {
    const rng = mulberry32(8);
    const fastball = examplesFor('fastball', 12, rng);
    const drop = examplesFor('drop', 12, rng);

    const pairs = analyzeRepertoire([...fastball, ...drop]);
    const pair = pairs.find((p) => (p.a === 'fastball' && p.b === 'drop') || (p.a === 'drop' && p.b === 'fastball'));
    expect(pair).toBeDefined();
    expect(pair!.warn).toBe(false);
    expect(pair!.overlapRate).toBeLessThan(0.3);
  });

  it('skips pairs without enough examples of both types', () => {
    const rng = mulberry32(9);
    const fastball = examplesFor('fastball', 12, rng);
    const rareCurve = examplesFor('curve', 2, rng);
    const pairs = analyzeRepertoire([...fastball, ...rareCurve]);
    expect(pairs.find((p) => p.a === 'curve' || p.b === 'curve')).toBeUndefined();
  });
});
