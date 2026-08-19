/**
 * Test-only helpers: turns harness/physics.ts ground truth into PitchMeasurements
 * and full PitchRecord[] with per-pitch jitter, so classifier tests exercise
 * realistic variance instead of the exact same delivery over and over.
 *
 * Not a *.test.ts file, so vitest's include glob skips it; other test files import
 * it directly.
 */

import { PHYSICS, rubberZ } from '@/domain/constants';
import { inches, mph } from '@/domain/units';
import type { PitchMeasurements, PitchRecord, PitchTypeId, Vec3 } from '@/domain/types';
import {
  crossingAt,
  presetByName,
  simulate,
  stateAt,
  type GroundTruth,
  type PitchSpec,
} from '../../../harness/physics';

export function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gaussian(rng: () => number): number {
  const u1 = Math.max(rng(), 1e-9);
  const u2 = rng();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

export function jitterSpec(base: PitchSpec, rng: () => number, name = base.name): PitchSpec {
  return {
    ...base,
    name,
    speedMps: base.speedMps + gaussian(rng) * mph(1.2),
    aim: {
      x: base.aim.x + gaussian(rng) * inches(1.2),
      y: base.aim.y + gaussian(rng) * inches(1.2),
      z: base.aim.z,
    },
    release: {
      x: base.release.x + gaussian(rng) * inches(0.4),
      y: base.release.y + gaussian(rng) * inches(0.4),
      z: base.release.z + gaussian(rng) * inches(0.4),
    },
  };
}

/**
 * Mirrors src/geometry/measurements.ts's definitions exactly, but reads them off
 * the ground-truth RK4 integration directly instead of a fitted constant-
 * acceleration trajectory — appropriate here because trajectory-fit error is
 * WS4's concern (already covered by harness/foundation.test.ts), and this file
 * wants ground truth for the classifier's own separability, not fit noise on
 * top of it.
 */
export function measurementsFromGroundTruth(gt: GroundTruth, pitchingDistanceFt = 43): PitchMeasurements {
  const releasePos = gt.spec.release;
  const releaseVel = gt.samples[0].velocity;
  const releaseSpeedMps = Math.hypot(releaseVel.x, releaseVel.y, releaseVel.z);

  const hit = gt.crossings.back ?? crossingAt(gt.samples, 0);
  if (!hit) throw new Error('synthetic pitch never reaches the plate');

  const plateSpeedMps = hit.speedMps;
  const timeToPlateS = hit.tS;

  const straightX = releasePos.x + releaseVel.x * timeToPlateS;
  const horizontalBreakM = hit.position.x - straightX;

  const gravityOnlyY =
    releasePos.y + releaseVel.y * timeToPlateS - 0.5 * PHYSICS.GRAVITY_MPS2 * timeToPlateS * timeToPlateS;
  const verticalBreakM = hit.position.y - gravityOnlyY;

  const totalBreakM = Math.hypot(horizontalBreakM, verticalBreakM);
  const breakAngleRad = Math.atan2(verticalBreakM, horizontalBreakM);
  const extensionM = releasePos.z - rubberZ(pitchingDistanceFt);

  const plateVel = (stateAt(gt, hit.tS) ?? gt.samples[gt.samples.length - 1]).velocity;
  const verticalApproachAngleRad = Math.atan2(-plateVel.y, Math.hypot(plateVel.x, plateVel.z));
  const horizontalApproachAngleRad = Math.atan2(plateVel.x, plateVel.z);

  return {
    releasePoint: releasePos,
    releaseSpeedMps,
    plateSpeedMps,
    timeToPlateS,
    horizontalBreakM,
    verticalBreakM,
    totalBreakM,
    breakAngleRad,
    extensionM,
    releaseHeightM: releasePos.y,
    releaseSideM: releasePos.x,
    verticalApproachAngleRad,
    horizontalApproachAngleRad,
    breakIsApproximate: false,
  };
}

export function measurementsForType(type: string, rng: () => number): PitchMeasurements {
  const spec = jitterSpec(presetByName(type), rng);
  return measurementsFromGroundTruth(simulate(spec));
}

const dummyVec3: Vec3 = { x: 0, y: 0, z: 0 };

/** A minimal, internally-consistent PitchRecord for a labelled synthetic pitch. */
export function syntheticPitchRecord(
  sessionId: string,
  sequence: number,
  type: PitchTypeId,
  measurements: PitchMeasurements,
): PitchRecord {
  return {
    id: `${sessionId}-${sequence}`,
    sessionId,
    sequence,
    timestampMs: sequence * 15_000,
    labeledType: type,
    predictedType: null,
    predictionConfidence: null,
    call: {
      result: 'strike',
      strikePlane: 'back',
      front: {
        plane: 'front',
        position: dummyVec3,
        timestampMs: 0,
        speedMps: measurements.plateSpeedMps,
        isStrike: true,
        marginM: -0.02,
      },
      back: {
        plane: 'back',
        position: { x: 0, y: measurements.releaseHeightM, z: 0 },
        timestampMs: 0,
        speedMps: measurements.plateSpeedMps,
        isStrike: true,
        marginM: -0.02,
      },
      confidence: 0.9,
      band: 'confident',
      caveats: [],
    },
    measurements,
    trajectory: {
      p0: measurements.releasePoint,
      v0: dummyVec3,
      a: dummyVec3,
      t0Ms: 0,
      tStartS: 0,
      tEndS: measurements.timeToPlateS,
      residualM: 0.01,
      sampleCount: 20,
      inlierCount: 20,
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
    trackingConfidence: 0.9,
    cameraCount: 2,
  };
}

export function generateLabeledPitches(
  types: readonly string[],
  countPerType: number,
  seed: number,
  sessionId = `synthetic-${seed}`,
): PitchRecord[] {
  const rng = mulberry32(seed);
  const records: PitchRecord[] = [];
  let sequence = 1;
  for (const type of types) {
    for (let i = 0; i < countPerType; i++) {
      const measurements = measurementsForType(type, rng);
      records.push(syntheticPitchRecord(sessionId, sequence++, type as PitchTypeId, measurements));
    }
  }
  return records;
}
