import { describe, expect, it } from 'vitest';
import { DEFAULT_BATTER_HEIGHT_M, PLATE, zoneFromHeight } from '@/domain/constants';
import { defaultBullpenZone, freezeZoneAt, heightZone, manualZone } from '../strikeZone';

describe('manualZone', () => {
  it('sorts inverted bounds and is marked not approximate', () => {
    const zone = manualZone(1.0, 0.4, { frozenAtMs: 100 });
    expect(zone.bottomM).toBe(0.4);
    expect(zone.topM).toBe(1.0);
    expect(zone.source).toBe('manual');
    expect(zone.approximate).toBe(false);
    expect(zone.halfWidthM).toBe(PLATE.HALF_WIDTH_M);
  });
});

describe('heightZone', () => {
  it('matches zoneFromHeight and is honestly marked approximate', () => {
    const heightM = 1.6;
    const zone = heightZone(heightM, { ruleSet: 'ncaa', frozenAtMs: 5, batterId: 'b1' });
    const expected = zoneFromHeight(heightM, 'ncaa');
    expect(zone.bottomM).toBeCloseTo(expected.bottomM);
    expect(zone.topM).toBeCloseTo(expected.topM);
    expect(zone.approximate).toBe(true);
    expect(zone.source).toBe('height');
    expect(zone.batterId).toBe('b1');
    expect(zone.batterHeightM).toBe(heightM);
  });
});

describe('defaultBullpenZone', () => {
  it('uses the default batter height and has no batter identity', () => {
    const zone = defaultBullpenZone({ frozenAtMs: 9 });
    expect(zone.batterHeightM).toBe(DEFAULT_BATTER_HEIGHT_M);
    expect(zone.batterId).toBeUndefined();
    expect(zone.source).toBe('default');
    expect(zone.approximate).toBe(true);
  });
});

describe('freezeZoneAt', () => {
  it('updates only frozenAtMs', () => {
    const zone = manualZone(0.4, 1.0, { frozenAtMs: 1 });
    const refrozen = freezeZoneAt(zone, 999);
    expect(refrozen.frozenAtMs).toBe(999);
    expect(refrozen.bottomM).toBe(zone.bottomM);
    expect(refrozen.topM).toBe(zone.topM);
  });
});
