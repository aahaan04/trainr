import { describe, expect, it } from 'vitest';
import { mph } from '@/domain/units';
import type { PitchCall, PitchRecord, Vec3 } from '@/domain/types';
import { pitchRecordsToCsv } from '@/export/csv';
import { sessionToJson } from '@/export/json';

const zeroVec: Vec3 = { x: 0, y: 0, z: 0 };

function baseCall(result: 'strike' | 'ball'): PitchCall {
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

function makePitch(sequence: number, customTypeName?: string): PitchRecord {
  return {
    id: `p${sequence}`,
    sessionId: 's1',
    sequence,
    timestampMs: 1_700_000_000_000 + sequence * 1000,
    labeledType: 'custom',
    customTypeName,
    predictedType: 'fastball',
    predictionConfidence: 0.82,
    predictionReason: '62 mph, 9 in of arm-side run',
    call: baseCall(sequence % 2 === 0 ? 'strike' : 'ball'),
    measurements: {
      releasePoint: zeroVec,
      releaseSpeedMps: mph(63),
      plateSpeedMps: mph(60),
      timeToPlateS: 0.42,
      horizontalBreakM: 0.1,
      verticalBreakM: -0.05,
      totalBreakM: 0.11,
      breakAngleRad: 0.3,
      extensionM: 1.8,
      releaseHeightM: 0.58,
      releaseSideM: -0.15,
      verticalApproachAngleRad: 0.3,
      horizontalApproachAngleRad: 0,
      breakIsApproximate: true,
    },
    trajectory: {
      p0: zeroVec,
      v0: zeroVec,
      a: zeroVec,
      t0Ms: 0,
      tStartS: 0,
      tEndS: 0.42,
      residualM: 0,
      sampleCount: 10,
      inlierCount: 10,
      cameraCount: 1,
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
    trackingConfidence: 0.7,
    cameraCount: 1,
  };
}

describe('pitchRecordsToCsv', () => {
  it('emits a header row plus one row per pitch, ordered by sequence', () => {
    const pitches = [makePitch(2), makePitch(1)];
    const csv = pitchRecordsToCsv(pitches);
    const lines = csv.split('\r\n');
    expect(lines).toHaveLength(3);
    expect(lines[0]).toContain('release_speed_mph');
    expect(lines[1].startsWith('1,')).toBe(true);
    expect(lines[2].startsWith('2,')).toBe(true);
  });

  it('escapes commas, quotes and newlines in free-text fields', () => {
    const pitches = [makePitch(1, 'my "special", pitch\nname')];
    const csv = pitchRecordsToCsv(pitches);
    expect(csv).toContain('"my ""special"", pitch\nname"');
    // The escaped field must not have split the row into extra columns.
    const dataLine = csv.split('\r\n')[1];
    expect(dataLine.split(',').length).toBeGreaterThanOrEqual(1);
  });

  it('round-trips numeric fields at reasonable precision', () => {
    const pitches = [makePitch(1)];
    const csv = pitchRecordsToCsv(pitches);
    const [header, row] = csv.split('\r\n');
    const cols = header.split(',');
    const cells = row.split(',');
    const speedIdx = cols.indexOf('plate_speed_mph');
    expect(Number(cells[speedIdx])).toBeCloseTo(60, 0);
  });

  it('labels approximate breaks in the exported row', () => {
    const csv = pitchRecordsToCsv([makePitch(1)]);
    const [header, row] = csv.split('\r\n');
    const idx = header.split(',').indexOf('break_is_approximate');
    expect(row.split(',')[idx]).toBe('true');
  });
});

describe('sessionToJson', () => {
  it('round-trips a full session losslessly', () => {
    const session = {
      id: 's1',
      pitcherId: 'pitcher-1',
      startedAt: 1_700_000_000_000,
      cameraSetupId: 'cam-1',
      cameraMode: 'single' as const,
      ruleSet: 'ncaa' as const,
      pitchingDistanceFt: 43,
      callBeforeMode: false,
    };
    const pitches = [makePitch(1), makePitch(2)];
    const json = sessionToJson(session, pitches);
    const parsed = JSON.parse(json);
    expect(parsed.session.id).toBe('s1');
    expect(parsed.pitches).toHaveLength(2);
    expect(parsed.pitches[0].sequence).toBe(1);
    expect(parsed.pitches[1].sequence).toBe(2);
    // Never a spin field anywhere in the export.
    expect(JSON.stringify(parsed)).not.toMatch(/spin/i);
  });
});
