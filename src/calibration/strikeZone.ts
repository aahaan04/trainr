/**
 * Section 3.4 — the manual, height-derived, and no-batter strike-zone paths. The
 * pose-derived AUTO path lives in poseZone.ts; everything here is pure and
 * synchronous, so it stays fully unit-testable.
 */

import type { RuleSetId, StrikeZone } from '@/domain/types';
import { DEFAULT_BATTER_HEIGHT_M, DEFAULT_RULE_SET, PLATE, zoneFromHeight } from '@/domain/constants';

interface ZoneBase {
  ruleSet?: RuleSetId;
  frozenAtMs: number;
  batterId?: string;
}

/** Drag-handle manual entry: the user sets top/bottom directly, previewed in 3D over the plate. */
export function manualZone(bottomM: number, topM: number, opts: ZoneBase): StrikeZone {
  return {
    ruleSet: opts.ruleSet ?? DEFAULT_RULE_SET,
    bottomM: Math.min(bottomM, topM),
    topM: Math.max(bottomM, topM),
    halfWidthM: PLATE.HALF_WIDTH_M,
    source: 'manual',
    frozenAtMs: opts.frozenAtMs,
    batterId: opts.batterId,
    approximate: false,
  };
}

/** A saved or entered batter height, run through the anthropometric ratios. Honestly marked approximate. */
export function heightZone(heightM: number, opts: ZoneBase): StrikeZone {
  const ruleSet = opts.ruleSet ?? DEFAULT_RULE_SET;
  const { bottomM, topM } = zoneFromHeight(heightM, ruleSet);
  return {
    ruleSet,
    bottomM,
    topM,
    halfWidthM: PLATE.HALF_WIDTH_M,
    source: 'height',
    frozenAtMs: opts.frozenAtMs,
    batterId: opts.batterId,
    batterHeightM: heightM,
    approximate: true,
  };
}

/** No-batter bullpen mode: the default height, clearly flagged as approximate, no batter identity. */
export function defaultBullpenZone(opts: Omit<ZoneBase, 'batterId'>): StrikeZone {
  const ruleSet = opts.ruleSet ?? DEFAULT_RULE_SET;
  const { bottomM, topM } = zoneFromHeight(DEFAULT_BATTER_HEIGHT_M, ruleSet);
  return {
    ruleSet,
    bottomM,
    topM,
    halfWidthM: PLATE.HALF_WIDTH_M,
    source: 'default',
    frozenAtMs: opts.frozenAtMs,
    batterHeightM: DEFAULT_BATTER_HEIGHT_M,
    approximate: true,
  };
}

/**
 * Re-freezes an existing zone at a new release timestamp without altering its
 * bounds. Section 3.4: the zone must freeze at RELEASE, not at crossing, so a
 * batter's own crouch during the pitch cannot shrink their zone. Auto/pose mode
 * calls this every pitch; manual/height zones are static but still get a fresh
 * `frozenAtMs` so a PitchRecord's zone always reflects the zone AS OF that pitch.
 */
export function freezeZoneAt(zone: StrikeZone, releaseMs: number): StrikeZone {
  return { ...zone, frozenAtMs: releaseMs };
}
