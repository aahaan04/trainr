/**
 * Internal canonical units are SI: metres, seconds, metres/second, radians, kilograms.
 * Imperial appears only at the display boundary and in the rulebook literals below.
 */

export const INCH_M = 0.0254;
export const FOOT_M = 0.3048;
export const MPH_MPS = 0.44704;

export const inches = (n: number): number => n * INCH_M;
export const feet = (n: number): number => n * FOOT_M;
export const mph = (n: number): number => n * MPH_MPS;

export const toInches = (m: number): number => m / INCH_M;
export const toFeet = (m: number): number => m / FOOT_M;
export const toMph = (mps: number): number => mps / MPH_MPS;
export const toCm = (m: number): number => m * 100;

export type UnitSystem = 'imperial' | 'metric';

/** Formats a distance for display. `imperial` uses inches under 3 ft, feet above. */
export function formatDistance(m: number, system: UnitSystem, digits = 1): string {
  if (system === 'metric') {
    return Math.abs(m) < 1 ? `${(m * 100).toFixed(digits)} cm` : `${m.toFixed(2)} m`;
  }
  const inch = toInches(m);
  return Math.abs(inch) < 36 ? `${inch.toFixed(digits)} in` : `${toFeet(m).toFixed(digits)} ft`;
}

/** Formats a speed for display. Velocity is always reported in mph in imperial mode. */
export function formatSpeed(mps: number, system: UnitSystem, digits = 1): string {
  return system === 'metric'
    ? `${(mps * 3.6).toFixed(digits)} km/h`
    : `${toMph(mps).toFixed(digits)} mph`;
}

/** Short break/offset display — always the smaller unit, since breaks are inches-scale. */
export function formatBreak(m: number, system: UnitSystem, digits = 1): string {
  return system === 'metric' ? `${(m * 100).toFixed(digits)} cm` : `${toInches(m).toFixed(digits)} in`;
}

export const degToRad = (d: number): number => (d * Math.PI) / 180;
export const radToDeg = (r: number): number => (r * 180) / Math.PI;
