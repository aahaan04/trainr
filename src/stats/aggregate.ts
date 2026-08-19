/**
 * Section 7 stat aggregates. Everything here is a pure function over PitchRecord[]
 * (plus a Session[] for cross-session trends) — no DB or React import, so the chart
 * and view components can be tested against the same data they render.
 *
 * "Effective type" throughout means labeledType when present, else predictedType.
 * A manual label always wins; nothing here ever writes back to a record.
 */

import { PLATE, STATS, ZONE_RULES } from '@/domain/constants';
import type { PitchRecord, PitchTypeId, Session, StrikeZone } from '@/domain/types';

export function effectiveType(pitch: PitchRecord): PitchTypeId | null {
  return pitch.labeledType ?? pitch.predictedType;
}

/** True when the type shown for this pitch is a prediction, not a confirmed label. */
export function isPredictedOnly(pitch: PitchRecord): boolean {
  return pitch.labeledType === null && pitch.predictedType !== null;
}

// ---------------------------------------------------------------------------
// Session summary
// ---------------------------------------------------------------------------

export interface TypeVelocity {
  type: PitchTypeId;
  count: number;
  avgMps: number;
  peakMps: number;
}

export interface TypeStrikeRate {
  type: PitchTypeId;
  count: number;
  strikes: number;
  strikeRate: number;
}

export interface SessionSummary {
  pitchCount: number;
  strikeCount: number;
  strikePercentage: number;
  /** Reconstructed via standard 3-strike / 4-ball at-bat boundaries; see firstPitchStrikeRate below. */
  firstPitchStrikePercentage: number;
  strikeRateByType: TypeStrikeRate[];
  velocityByType: TypeVelocity[];
  /** True if any contributing measurement used single-camera break estimates. */
  hasApproximateBreaks: boolean;
}

/**
 * At-bat boundaries are not a field on PitchRecord, so they are reconstructed from
 * the pitch sequence using the standard count rules (3 strikes / 4 balls ends an
 * at-bat). This can't distinguish a 2-strike foul from a swinging miss — both are
 * just "strike" in PitchCall — so a foul-heavy at-bat may end one pitch early. It is
 * the best approximation available from the data this app actually records.
 */
export function firstPitchStrikeRate(pitchesInOrder: readonly PitchRecord[]): number {
  let strikes = 0;
  let balls = 0;
  let atBatStarts = 0;
  let atBatFirstPitchStrikes = 0;
  let atStart = true;

  for (const p of pitchesInOrder) {
    if (atStart) {
      atBatStarts++;
      if (p.call.result === 'strike') atBatFirstPitchStrikes++;
      atStart = false;
    }
    if (p.call.result === 'strike') strikes++;
    else balls++;

    if (strikes >= 3 || balls >= 4) {
      strikes = 0;
      balls = 0;
      atStart = true;
    }
  }

  return atBatStarts > 0 ? atBatFirstPitchStrikes / atBatStarts : 0;
}

export function summarizeSession(pitches: readonly PitchRecord[]): SessionSummary {
  const ordered = [...pitches].sort((a, b) => a.sequence - b.sequence);
  const strikeCount = ordered.filter((p) => p.call.result === 'strike').length;

  const byType = new Map<PitchTypeId, PitchRecord[]>();
  for (const p of ordered) {
    const type = effectiveType(p);
    if (!type) continue;
    const list = byType.get(type) ?? [];
    list.push(p);
    byType.set(type, list);
  }

  const strikeRateByType: TypeStrikeRate[] = [...byType.entries()]
    .map(([type, list]) => {
      const strikes = list.filter((p) => p.call.result === 'strike').length;
      return { type, count: list.length, strikes, strikeRate: strikes / list.length };
    })
    .sort((a, b) => b.count - a.count);

  const velocityByType: TypeVelocity[] = [...byType.entries()]
    .map(([type, list]) => {
      const speeds = list.map((p) => p.measurements.plateSpeedMps);
      return {
        type,
        count: list.length,
        avgMps: speeds.reduce((a, b) => a + b, 0) / speeds.length,
        peakMps: Math.max(...speeds),
      };
    })
    .sort((a, b) => b.count - a.count);

  return {
    pitchCount: ordered.length,
    strikeCount,
    strikePercentage: ordered.length > 0 ? strikeCount / ordered.length : 0,
    firstPitchStrikePercentage: firstPitchStrikeRate(ordered),
    strikeRateByType,
    velocityByType,
    hasApproximateBreaks: ordered.some((p) => p.measurements.breakIsApproximate),
  };
}

// ---------------------------------------------------------------------------
// Zone heat map
// ---------------------------------------------------------------------------

export interface HeatMapCell {
  row: number;
  col: number;
  xMinM: number;
  xMaxM: number;
  yMinM: number;
  yMaxM: number;
  count: number;
  strikes: number;
  strikeRate: number;
}

export interface HeatMapOptions {
  pitchType?: PitchTypeId;
  /** 'called' plots the pre-pitch intended target (call-before mode only); 'actual' plots the measured crossing. */
  source: 'called' | 'actual';
}

export function computeHeatMap(
  pitches: readonly PitchRecord[],
  zone: StrikeZone,
  options: HeatMapOptions,
): HeatMapCell[] {
  const shadow = ZONE_RULES.SHADOW_ZONE_M;
  const xMin = -(zone.halfWidthM + shadow);
  const xMax = zone.halfWidthM + shadow;
  const yMin = zone.bottomM - shadow;
  const yMax = zone.topM + shadow;
  const divisions = ZONE_RULES.HEATMAP_DIVISIONS;
  const cellW = (xMax - xMin) / divisions;
  const cellH = (yMax - yMin) / divisions;

  const cells: HeatMapCell[] = [];
  for (let row = 0; row < divisions; row++) {
    for (let col = 0; col < divisions; col++) {
      cells.push({
        row,
        col,
        xMinM: xMin + col * cellW,
        xMaxM: xMin + (col + 1) * cellW,
        // Row 0 is the top of the zone, so y decreases as row increases.
        yMaxM: yMax - row * cellH,
        yMinM: yMax - (row + 1) * cellH,
        count: 0,
        strikes: 0,
        strikeRate: 0,
      });
    }
  }

  for (const p of pitches) {
    if (options.pitchType && effectiveType(p) !== options.pitchType) continue;

    let x: number;
    let y: number;
    if (options.source === 'called') {
      if (!p.intended) continue;
      x = p.intended.target.x;
      y = p.intended.target.y;
    } else {
      x = p.call.back.position.x;
      y = p.call.back.position.y;
    }
    if (x < xMin || x >= xMax || y < yMin || y >= yMax) continue;

    const col = Math.min(divisions - 1, Math.floor((x - xMin) / cellW));
    const rowFromTop = Math.min(divisions - 1, Math.floor((yMax - y) / cellH));
    const cell = cells[rowFromTop * divisions + col];
    cell.count++;
    if (p.call.result === 'strike') cell.strikes++;
  }

  for (const cell of cells) cell.strikeRate = cell.count > 0 ? cell.strikes / cell.count : 0;
  return cells;
}

// ---------------------------------------------------------------------------
// Movement profile — the most useful single visual in the app (Section 7)
// ---------------------------------------------------------------------------

export interface MovementPoint {
  pitchId: string;
  type: PitchTypeId | null;
  horizontalBreakM: number;
  verticalBreakM: number;
  breakIsApproximate: boolean;
}

export function movementProfile(pitches: readonly PitchRecord[]): MovementPoint[] {
  return pitches.map((p) => ({
    pitchId: p.id,
    type: effectiveType(p),
    horizontalBreakM: p.measurements.horizontalBreakM,
    verticalBreakM: p.measurements.verticalBreakM,
    breakIsApproximate: p.measurements.breakIsApproximate,
  }));
}

// ---------------------------------------------------------------------------
// Velocity trend + fatigue
// ---------------------------------------------------------------------------

export interface VelocityPoint {
  sequence: number;
  speedMps: number;
  type: PitchTypeId | null;
}

export function velocityTrend(pitches: readonly PitchRecord[]): VelocityPoint[] {
  return [...pitches]
    .sort((a, b) => a.sequence - b.sequence)
    .map((p) => ({ sequence: p.sequence, speedMps: p.measurements.plateSpeedMps, type: effectiveType(p) }));
}

export interface FatigueResult {
  flagged: boolean;
  peakMps: number;
  /** Sequence number of the first pitch in the flagged window, if any. */
  windowStartSequence: number | null;
  dropMps: number | null;
}

/**
 * Flags the earliest run of STATS.FATIGUE_WINDOW_PITCHES consecutive pitches that
 * all sit more than STATS.FATIGUE_DROP_MPS below the session's peak velocity.
 */
export function detectFatigue(pitches: readonly PitchRecord[]): FatigueResult {
  const ordered = velocityTrend(pitches);
  if (ordered.length === 0) return { flagged: false, peakMps: 0, windowStartSequence: null, dropMps: null };

  const peakMps = Math.max(...ordered.map((p) => p.speedMps));
  const threshold = peakMps - STATS.FATIGUE_DROP_MPS;
  const window = STATS.FATIGUE_WINDOW_PITCHES;

  for (let i = 0; i + window <= ordered.length; i++) {
    const slice = ordered.slice(i, i + window);
    if (slice.every((p) => p.speedMps <= threshold)) {
      const worst = Math.min(...slice.map((p) => p.speedMps));
      return { flagged: true, peakMps, windowStartSequence: slice[0].sequence, dropMps: peakMps - worst };
    }
  }

  return { flagged: false, peakMps, windowStartSequence: null, dropMps: null };
}

// ---------------------------------------------------------------------------
// Release point consistency
// ---------------------------------------------------------------------------

export interface ReleasePoint {
  pitchId: string;
  type: PitchTypeId | null;
  xM: number;
  yM: number;
}

export function releasePoints(pitches: readonly PitchRecord[]): ReleasePoint[] {
  return pitches.map((p) => ({
    pitchId: p.id,
    type: effectiveType(p),
    xM: p.measurements.releaseSideM,
    yM: p.measurements.releaseHeightM,
  }));
}

export interface ReleaseTypeCluster {
  type: PitchTypeId;
  count: number;
  meanXM: number;
  meanYM: number;
  stdM: number;
}

export interface ReleaseConsistency {
  byType: ReleaseTypeCluster[];
  /** Distance between per-type centroids and the grand centroid, averaged. */
  betweenTypeSpreadM: number;
  /** Average within-type standard deviation, across types. */
  withinTypeSpreadM: number;
  /** True when between-type spread is no larger than the pitcher's own natural noise. */
  consistentAcrossTypes: boolean;
}

export function releaseConsistency(pitches: readonly PitchRecord[]): ReleaseConsistency {
  const byType = new Map<PitchTypeId, { x: number; y: number }[]>();
  for (const p of pitches) {
    const type = effectiveType(p);
    if (!type) continue;
    const list = byType.get(type) ?? [];
    list.push({ x: p.measurements.releaseSideM, y: p.measurements.releaseHeightM });
    byType.set(type, list);
  }

  const clusters: ReleaseTypeCluster[] = [];
  const allPoints: { x: number; y: number }[] = [];
  for (const [type, points] of byType) {
    const meanXM = points.reduce((s, p) => s + p.x, 0) / points.length;
    const meanYM = points.reduce((s, p) => s + p.y, 0) / points.length;
    const stdM =
      Math.sqrt(points.reduce((s, p) => s + (p.x - meanXM) ** 2 + (p.y - meanYM) ** 2, 0) / points.length) || 0;
    clusters.push({ type, count: points.length, meanXM, meanYM, stdM });
    allPoints.push(...points);
  }

  if (clusters.length === 0) {
    return { byType: [], betweenTypeSpreadM: 0, withinTypeSpreadM: 0, consistentAcrossTypes: true };
  }

  const grandX = allPoints.reduce((s, p) => s + p.x, 0) / allPoints.length;
  const grandY = allPoints.reduce((s, p) => s + p.y, 0) / allPoints.length;
  const betweenTypeSpreadM =
    clusters.reduce((s, c) => s + Math.hypot(c.meanXM - grandX, c.meanYM - grandY), 0) / clusters.length;
  const withinTypeSpreadM = clusters.reduce((s, c) => s + c.stdM, 0) / clusters.length;

  return {
    byType: clusters.sort((a, b) => b.count - a.count),
    betweenTypeSpreadM,
    withinTypeSpreadM,
    consistentAcrossTypes: betweenTypeSpreadM <= Math.max(withinTypeSpreadM, 0.01),
  };
}

// ---------------------------------------------------------------------------
// Command (call-before mode)
// ---------------------------------------------------------------------------

export interface CommandStats {
  count: number;
  avgMissM: number | null;
  hitRate: number | null;
  radiusM: number;
}

export function commandStats(pitches: readonly PitchRecord[], radiusM: number): CommandStats {
  const withIntent = pitches.filter((p) => p.intended && p.commandMissM != null);
  if (withIntent.length === 0) return { count: 0, avgMissM: null, hitRate: null, radiusM };

  const misses = withIntent.map((p) => p.commandMissM as number);
  const avgMissM = misses.reduce((a, b) => a + b, 0) / misses.length;
  const hits = misses.filter((m) => m <= radiusM).length;

  return { count: withIntent.length, avgMissM, hitRate: hits / withIntent.length, radiusM };
}

// ---------------------------------------------------------------------------
// Cross-session trends
// ---------------------------------------------------------------------------

export interface SessionTrendPoint {
  sessionId: string;
  startedAt: number;
  pitchCount: number;
  avgVelocityMps: number;
  peakVelocityMps: number;
  strikePercentage: number;
  avgCommandMissM: number | null;
  commandHitRate: number | null;
}

export function crossSessionTrends(
  sessions: readonly { session: Session; pitches: readonly PitchRecord[] }[],
  commandRadiusM: number = STATS.DEFAULT_COMMAND_RADIUS_M,
): SessionTrendPoint[] {
  return sessions
    .filter(({ pitches }) => pitches.length > 0)
    .map(({ session, pitches }) => {
      const speeds = pitches.map((p) => p.measurements.plateSpeedMps);
      const strikes = pitches.filter((p) => p.call.result === 'strike').length;
      const cmd = commandStats(pitches, commandRadiusM);
      return {
        sessionId: session.id,
        startedAt: session.startedAt,
        pitchCount: pitches.length,
        avgVelocityMps: speeds.reduce((a, b) => a + b, 0) / speeds.length,
        peakVelocityMps: Math.max(...speeds),
        strikePercentage: strikes / pitches.length,
        avgCommandMissM: cmd.avgMissM,
        commandHitRate: cmd.hitRate,
      };
    })
    .sort((a, b) => a.startedAt - b.startedAt);
}

/** Re-exported so views that only import aggregate.ts still have the plate width for axis scaling. */
export const PLATE_HALF_WIDTH_M = PLATE.HALF_WIDTH_M;
