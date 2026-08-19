import { describe, expect, it } from 'vitest';
import { mph } from '@/domain/units';
import type { PitchCall, PitchRecord, PitchTypeId, Vec3 } from '@/domain/types';
import {
  commandStats,
  computeHeatMap,
  detectFatigue,
  firstPitchStrikeRate,
  releaseConsistency,
  summarizeSession,
  velocityTrend,
} from '../aggregate';

const zeroVec: Vec3 = { x: 0, y: 0, z: 0 };

function call(result: 'strike' | 'ball'): PitchCall {
  return {
    result,
    strikePlane: result === 'strike' ? 'back' : null,
    front: { plane: 'front', position: zeroVec, timestampMs: 0, speedMps: 20, isStrike: result === 'strike', marginM: 0 },
    back: { plane: 'back', position: zeroVec, timestampMs: 0, speedMps: 20, isStrike: result === 'strike', marginM: 0 },
    confidence: 0.9,
    band: 'confident',
    caveats: [],
  };
}

function pitch(overrides: {
  sequence: number;
  speedMps: number;
  result: 'strike' | 'ball';
  type?: PitchTypeId | null;
  releaseSideM?: number;
  releaseHeightM?: number;
  intendedTarget?: { x: number; y: number };
  commandMissM?: number;
  breakIsApproximate?: boolean;
}): PitchRecord {
  return {
    id: `p${overrides.sequence}`,
    sessionId: 's1',
    sequence: overrides.sequence,
    timestampMs: overrides.sequence * 10_000,
    labeledType: overrides.type ?? null,
    predictedType: null,
    predictionConfidence: null,
    call: call(overrides.result),
    measurements: {
      releasePoint: zeroVec,
      releaseSpeedMps: overrides.speedMps,
      plateSpeedMps: overrides.speedMps,
      timeToPlateS: 0.4,
      horizontalBreakM: 0.05,
      verticalBreakM: -0.05,
      totalBreakM: 0.07,
      breakAngleRad: 0,
      extensionM: 1.8,
      releaseHeightM: overrides.releaseHeightM ?? 0.6,
      releaseSideM: overrides.releaseSideM ?? -0.15,
      verticalApproachAngleRad: 0.3,
      horizontalApproachAngleRad: 0,
      breakIsApproximate: overrides.breakIsApproximate ?? false,
    },
    trajectory: {
      p0: zeroVec,
      v0: zeroVec,
      a: zeroVec,
      t0Ms: 0,
      tStartS: 0,
      tEndS: 0.4,
      residualM: 0,
      sampleCount: 10,
      inlierCount: 10,
      cameraCount: 2,
    },
    zone: {
      ruleSet: 'ncaa',
      bottomM: 0.4,
      topM: 1.1,
      halfWidthM: 0.2159,
      source: 'default',
      frozenAtMs: 0,
      approximate: true,
    },
    intended: overrides.intendedTarget ? { type: 'fastball', target: overrides.intendedTarget } : undefined,
    commandMissM: overrides.commandMissM,
    trackingConfidence: 0.9,
    cameraCount: 2,
  };
}

describe('summarizeSession', () => {
  it('computes strike percentage', () => {
    const pitches = [
      pitch({ sequence: 1, speedMps: mph(60), result: 'strike' }),
      pitch({ sequence: 2, speedMps: mph(60), result: 'ball' }),
      pitch({ sequence: 3, speedMps: mph(60), result: 'strike' }),
      pitch({ sequence: 4, speedMps: mph(60), result: 'strike' }),
    ];
    const summary = summarizeSession(pitches);
    expect(summary.pitchCount).toBe(4);
    expect(summary.strikeCount).toBe(3);
    expect(summary.strikePercentage).toBeCloseTo(0.75, 6);
  });

  it('flags approximate breaks when any contributing pitch used single-camera mode', () => {
    const pitches = [pitch({ sequence: 1, speedMps: mph(60), result: 'strike', breakIsApproximate: true })];
    expect(summarizeSession(pitches).hasApproximateBreaks).toBe(true);
    expect(summarizeSession([pitch({ sequence: 1, speedMps: mph(60), result: 'strike' })]).hasApproximateBreaks).toBe(
      false,
    );
  });

  it('reports average and peak velocity per type', () => {
    const pitches = [
      pitch({ sequence: 1, speedMps: mph(60), result: 'strike', type: 'fastball' }),
      pitch({ sequence: 2, speedMps: mph(64), result: 'strike', type: 'fastball' }),
      pitch({ sequence: 3, speedMps: mph(52), result: 'ball', type: 'changeup' }),
    ];
    const summary = summarizeSession(pitches);
    const fb = summary.velocityByType.find((v) => v.type === 'fastball')!;
    expect(fb.peakMps).toBeCloseTo(mph(64), 6);
    expect(fb.avgMps).toBeCloseTo(mph(62), 6);
  });
});

describe('first-pitch strike rate', () => {
  it('computes the rate over reconstructed at-bats using 3-strike / 4-ball boundaries', () => {
    // AB1: strike (first pitch strike), ball, ball, ball, ball -> walk (4 balls)
    // AB2: strike (first pitch strike), strike, strike -> strikeout
    // AB3: ball (first pitch NOT strike), strike, strike, strike -> strikeout
    const results: ('strike' | 'ball')[] = ['strike', 'ball', 'ball', 'ball', 'ball', 'strike', 'strike', 'strike', 'ball', 'strike', 'strike', 'strike'];
    const pitches = results.map((r, i) => pitch({ sequence: i + 1, speedMps: mph(60), result: r }));
    // 2 of 3 at-bats started with a strike.
    expect(firstPitchStrikeRate(pitches)).toBeCloseTo(2 / 3, 6);
  });

  it('returns 0 for an empty session', () => {
    expect(firstPitchStrikeRate([])).toBe(0);
  });
});

describe('fatigue detection', () => {
  it('fires on a constructed declining-velocity session', () => {
    const speedsMph = [64, 63, 64, 62, 63, 58, 57, 58, 57, 56];
    const pitches = speedsMph.map((s, i) => pitch({ sequence: i + 1, speedMps: mph(s), result: 'strike' }));
    const result = detectFatigue(pitches);
    expect(result.flagged).toBe(true);
    expect(result.dropMps).toBeGreaterThan(mph(3));
  });

  it('does not fire on a flat session', () => {
    const speedsMph = [61, 62, 61, 60, 62, 61, 60, 61, 62, 61];
    const pitches = speedsMph.map((s, i) => pitch({ sequence: i + 1, speedMps: mph(s), result: 'strike' }));
    const result = detectFatigue(pitches);
    expect(result.flagged).toBe(false);
  });
});

describe('velocity trend', () => {
  it('orders points by sequence regardless of input order', () => {
    const pitches = [
      pitch({ sequence: 3, speedMps: mph(60), result: 'strike' }),
      pitch({ sequence: 1, speedMps: mph(58), result: 'strike' }),
      pitch({ sequence: 2, speedMps: mph(59), result: 'strike' }),
    ];
    const trend = velocityTrend(pitches);
    expect(trend.map((p) => p.sequence)).toEqual([1, 2, 3]);
  });
});

describe('release point consistency', () => {
  it('says not tipping when release points cluster tightly across types', () => {
    const pitches = [
      pitch({ sequence: 1, speedMps: mph(62), result: 'strike', type: 'fastball', releaseSideM: -0.15, releaseHeightM: 0.58 }),
      pitch({ sequence: 2, speedMps: mph(62), result: 'strike', type: 'fastball', releaseSideM: -0.16, releaseHeightM: 0.59 }),
      pitch({ sequence: 3, speedMps: mph(57), result: 'strike', type: 'curve', releaseSideM: -0.14, releaseHeightM: 0.57 }),
      pitch({ sequence: 4, speedMps: mph(57), result: 'strike', type: 'curve', releaseSideM: -0.15, releaseHeightM: 0.58 }),
    ];
    expect(releaseConsistency(pitches).consistentAcrossTypes).toBe(true);
  });

  it('flags inconsistency when release points diverge sharply by type', () => {
    const pitches = [
      pitch({ sequence: 1, speedMps: mph(62), result: 'strike', type: 'fastball', releaseSideM: -0.15, releaseHeightM: 0.58 }),
      pitch({ sequence: 2, speedMps: mph(62), result: 'strike', type: 'fastball', releaseSideM: -0.15, releaseHeightM: 0.58 }),
      pitch({ sequence: 3, speedMps: mph(57), result: 'strike', type: 'curve', releaseSideM: 0.4, releaseHeightM: 1.1 }),
      pitch({ sequence: 4, speedMps: mph(57), result: 'strike', type: 'curve', releaseSideM: 0.4, releaseHeightM: 1.1 }),
    ];
    expect(releaseConsistency(pitches).consistentAcrossTypes).toBe(false);
  });
});

describe('command stats', () => {
  it('computes average miss and hit rate within radius', () => {
    const pitches = [
      pitch({ sequence: 1, speedMps: mph(60), result: 'strike', intendedTarget: { x: 0, y: 0.8 }, commandMissM: 0.05 }),
      pitch({ sequence: 2, speedMps: mph(60), result: 'ball', intendedTarget: { x: 0, y: 0.8 }, commandMissM: 0.2 }),
    ];
    const stats = commandStats(pitches, 0.15);
    expect(stats.count).toBe(2);
    expect(stats.avgMissM).toBeCloseTo(0.125, 6);
    expect(stats.hitRate).toBeCloseTo(0.5, 6);
  });

  it('returns nulls when no call-before pitches exist', () => {
    const pitches = [pitch({ sequence: 1, speedMps: mph(60), result: 'strike' })];
    const stats = commandStats(pitches, 0.15);
    expect(stats.avgMissM).toBeNull();
    expect(stats.hitRate).toBeNull();
  });
});

describe('zone heat map', () => {
  it('produces a HEATMAP_DIVISIONS x HEATMAP_DIVISIONS grid and buckets a centred strike', () => {
    const zone = {
      ruleSet: 'ncaa' as const,
      bottomM: 0.4,
      topM: 1.1,
      halfWidthM: 0.2159,
      source: 'default' as const,
      frozenAtMs: 0,
      approximate: true,
    };
    const centerPitch = pitch({ sequence: 1, speedMps: mph(60), result: 'strike' });
    centerPitch.call.back.position = { x: 0, y: (zone.bottomM + zone.topM) / 2, z: 0 };
    const cells = computeHeatMap([centerPitch], zone, { source: 'actual' });
    expect(cells.length).toBe(25);
    const hit = cells.find((c) => c.count > 0);
    expect(hit).toBeDefined();
    expect(hit!.strikes).toBe(1);
  });
});
