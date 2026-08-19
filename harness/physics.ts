/**
 * Physically accurate pitch trajectories with known ground truth.
 *
 * The app's own fit uses a constant-acceleration model, which is a deliberate
 * approximation. The harness does NOT: it integrates drag and Magnus properly, so
 * the regression suite measures the real error of that approximation rather than
 * grading the app against its own assumptions.
 */

import { BALL, PHYSICS } from '@/domain/constants';
import { feet, mph } from '@/domain/units';
import type { Vec3 } from '@/domain/types';

export interface PitchSpec {
  name: string;
  /** Release speed in m/s. */
  speedMps: number;
  /** Release point in world metres. */
  release: Vec3;
  /**
   * The point the ball actually CROSSES the plate's back-point plane at, in world
   * metres. `simulate` solves the release direction to hit it. Not a launch heading.
   */
  aim: Vec3;
  /**
   * Spin vector in rad/s, world frame. Drives the Magnus force, which is what
   * actually separates a rise ball from a drop ball.
   */
  spin: Vec3;
}

const DT = 0.0005;

/** Lift coefficient from the spin parameter S = omega*r/v. Linear fit valid for S < 0.3. */
function liftCoefficient(spinParam: number): number {
  return Math.min(0.35, 1.5 * spinParam);
}

export interface GroundTruthSample {
  tS: number;
  position: Vec3;
  velocity: Vec3;
}

export interface GroundTruth {
  spec: PitchSpec;
  samples: GroundTruthSample[];
  /** Exact crossing state at the plate's front edge and back point. */
  crossings: Record<'front' | 'back', { tS: number; position: Vec3; speedMps: number } | null>;
  releaseSpeedMps: number;
  flightTimeS: number;
}

function accel(v: Vec3, spin: Vec3): Vec3 {
  const speed = Math.hypot(v.x, v.y, v.z);
  if (speed < 1e-6) return { x: 0, y: -PHYSICS.GRAVITY_MPS2, z: 0 };

  // Dynamic pressure term. Both forces scale as v^2, so this carries one factor of
  // v and each force below supplies the other.
  const q = 0.5 * PHYSICS.AIR_DENSITY_KGM3 * BALL.CROSS_SECTION_M2 * speed;

  // Drag, opposing the velocity. Multiplying by the velocity VECTOR supplies the
  // second factor of v, so the magnitude is 0.5*rho*A*Cd*v^2 as it should be.
  const kDrag = (-q * BALL.DRAG_COEFFICIENT) / BALL.MASS_KG;

  // Magnus, along omega x v.
  const cross: Vec3 = {
    x: spin.y * v.z - spin.z * v.y,
    y: spin.z * v.x - spin.x * v.z,
    z: spin.x * v.y - spin.y * v.x,
  };
  const crossMag = Math.hypot(cross.x, cross.y, cross.z);
  const spinMag = Math.hypot(spin.x, spin.y, spin.z);
  const spinParam = (spinMag * BALL.RADIUS_M) / speed;
  const cl = liftCoefficient(spinParam);
  // `cross / crossMag` is a unit vector, so the explicit `speed` here is the second
  // factor of v. Omitting it silently halves the break at pitch speeds.
  const kMagnus = crossMag > 1e-9 ? (q * cl * speed) / (BALL.MASS_KG * crossMag) : 0;

  return {
    x: kDrag * v.x + kMagnus * cross.x,
    y: kDrag * v.y + kMagnus * cross.y - PHYSICS.GRAVITY_MPS2,
    z: kDrag * v.z + kMagnus * cross.z,
  };
}

/** RK4 integration from release until the ball passes the plate's back point (z >= 0). */
function integrate(release: Vec3, v0: Vec3, spin: Vec3): { samples: GroundTruthSample[]; flightTimeS: number } {
  let v: Vec3 = { ...v0 };
  let p: Vec3 = { ...release };
  let t = 0;

  const samples: GroundTruthSample[] = [{ tS: 0, position: { ...p }, velocity: { ...v } }];

  const add = (a: Vec3, b: Vec3, s: number): Vec3 => ({
    x: a.x + b.x * s,
    y: a.y + b.y * s,
    z: a.z + b.z * s,
  });

  // Two metres past the back point is enough to bracket the crossing cleanly.
  while (p.z < 2 && t < PHYSICS.MAX_FLIGHT_TIME_S * 2) {
    const k1v = accel(v, spin);
    const k2p = add(v, k1v, DT / 2);
    const k2v = accel(k2p, spin);
    const k3p = add(v, k2v, DT / 2);
    const k3v = accel(k3p, spin);
    const k4p = add(v, k3v, DT);
    const k4v = accel(k4p, spin);

    p = {
      x: p.x + (DT / 6) * (v.x + 2 * k2p.x + 2 * k3p.x + k4p.x),
      y: p.y + (DT / 6) * (v.y + 2 * k2p.y + 2 * k3p.y + k4p.y),
      z: p.z + (DT / 6) * (v.z + 2 * k2p.z + 2 * k3p.z + k4p.z),
    };
    v = {
      x: v.x + (DT / 6) * (k1v.x + 2 * k2v.x + 2 * k3v.x + k4v.x),
      y: v.y + (DT / 6) * (k1v.y + 2 * k2v.y + 2 * k3v.y + k4v.y),
      z: v.z + (DT / 6) * (k1v.z + 2 * k2v.z + 2 * k3v.z + k4v.z),
    };
    t += DT;
    samples.push({ tS: t, position: { ...p }, velocity: { ...v } });
  }

  return { samples, flightTimeS: t };
}

/**
 * Solves for the release direction that makes the ball actually CROSS the plate's
 * back point at `spec.aim`, rather than merely start out pointed at it. Gravity and
 * Magnus both bend the path substantially over 37 ft, so the two are far apart.
 *
 * This matters for more than realism: the regression suite needs to place pitches
 * within a couple of inches of a zone edge on purpose, to measure the borderline
 * call-agreement criterion. That is only possible if aim means the crossing point.
 *
 * Simple damped fixed-point iteration on the aim offset; converges in ~6 steps
 * because the crossing responds almost linearly to the launch direction.
 */
export function simulate(spec: PitchSpec): GroundTruth {
  const target = spec.aim;
  // Start by pointing straight at the target, then correct for where it lands.
  let guess: Vec3 = { ...target };
  let result = integrate(spec.release, directionTo(spec.release, guess, spec.speedMps), spec.spin);

  for (let i = 0; i < 30; i++) {
    const back = crossingAt(result.samples, 0);
    if (!back) break;
    const errX = back.position.x - target.x;
    const errY = back.position.y - target.y;
    if (Math.hypot(errX, errY) < 1e-4) break;
    guess = { x: guess.x - errX, y: guess.y - errY, z: guess.z };
    result = integrate(spec.release, directionTo(spec.release, guess, spec.speedMps), spec.spin);
  }

  return {
    spec,
    samples: result.samples,
    crossings: {
      front: crossingAt(result.samples, -0.4318),
      back: crossingAt(result.samples, 0),
    },
    releaseSpeedMps: spec.speedMps,
    flightTimeS: result.flightTimeS,
  };
}

function directionTo(from: Vec3, to: Vec3, speed: number): Vec3 {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const dz = to.z - from.z;
  const n = Math.hypot(dx, dy, dz) || 1;
  return { x: (dx / n) * speed, y: (dy / n) * speed, z: (dz / n) * speed };
}

/** Exact crossing state at a z plane, by linear interpolation between integrator steps. */
export function crossingAt(
  samples: GroundTruthSample[],
  planeZ: number,
): { tS: number; position: Vec3; speedMps: number } | null {
  for (let i = 1; i < samples.length; i++) {
    const a = samples[i - 1];
    const b = samples[i];
    if (a.position.z <= planeZ && b.position.z >= planeZ) {
      const f = (planeZ - a.position.z) / (b.position.z - a.position.z || 1);
      const lerp = (u: number, w: number) => u + (w - u) * f;
      const vel = {
        x: lerp(a.velocity.x, b.velocity.x),
        y: lerp(a.velocity.y, b.velocity.y),
        z: lerp(a.velocity.z, b.velocity.z),
      };
      return {
        tS: lerp(a.tS, b.tS),
        position: {
          x: lerp(a.position.x, b.position.x),
          y: lerp(a.position.y, b.position.y),
          z: planeZ,
        },
        speedMps: Math.hypot(vel.x, vel.y, vel.z),
      };
    }
  }
  return null;
}

/** State at an arbitrary time, interpolated. Used to place the ball for a render frame. */
export function stateAt(gt: GroundTruth, tS: number): GroundTruthSample | null {
  if (tS < 0 || tS > gt.samples[gt.samples.length - 1].tS) return null;
  const idx = Math.min(gt.samples.length - 2, Math.max(0, Math.floor(tS / DT)));
  const a = gt.samples[idx];
  const b = gt.samples[idx + 1];
  const f = (tS - a.tS) / (b.tS - a.tS || 1);
  const lerp = (u: number, w: number) => u + (w - u) * f;
  return {
    tS,
    position: { x: lerp(a.position.x, b.position.x), y: lerp(a.position.y, b.position.y), z: lerp(a.position.z, b.position.z) },
    velocity: { x: lerp(a.velocity.x, b.velocity.x), y: lerp(a.velocity.y, b.velocity.y), z: lerp(a.velocity.z, b.velocity.z) },
  };
}

// ---------------------------------------------------------------------------
// Preset repertoire for a right-handed pitcher at 43 ft
// ---------------------------------------------------------------------------

/**
 * Right-handed pitcher, 43 ft, with a 6 ft stride. Release is low and slightly to
 * the arm side, which is where a windmill delivery actually lets go.
 *
 * Sign conventions for spin, worked out once so the presets below read cleanly.
 * With the ball travelling in +Z, the Magnus force is along omega x v:
 *   omega.x negative (backspin)  -> force +Y, rises / drops less than gravity
 *   omega.x positive (topspin)   -> force -Y, drops faster than gravity
 *   omega.y positive             -> force +X, breaks to the GLOVE side of a RH pitcher
 *   omega.y negative             -> force -X, breaks to the ARM side of a RH pitcher
 *
 * A RH pitcher faces +Z, so their right hand (arm side) is world -X and their glove
 * side is world +X. This is the mirror of what a batter sees, which is the usual
 * way to get these backwards.
 */
const RELEASE_RH: Vec3 = { x: -0.15, y: 0.58, z: -feet(37) };

/** Where the ball actually crosses the plate's back-point plane. */
const aimAt = (x: number, y: number): Vec3 => ({ x, y, z: 0 });

export const PRESET_PITCHES: PitchSpec[] = [
  {
    name: 'fastball',
    speedMps: mph(62),
    release: RELEASE_RH,
    aim: aimAt(0, 0.79),
    // Backspin with a touch of arm-side run.
    spin: { x: -110, y: -30, z: 20 },
  },
  {
    name: 'changeup',
    speedMps: mph(52),
    release: RELEASE_RH,
    aim: aimAt(0, 0.72),
    // Same shape, much less spin, 10 mph slower. The separation is speed, not break.
    spin: { x: -40, y: -10, z: 5 },
  },
  {
    name: 'drop',
    speedMps: mph(59),
    release: RELEASE_RH,
    aim: aimAt(0, 0.56),
    // Topspin: Magnus points down, so it falls faster than gravity alone.
    spin: { x: 190, y: 0, z: 0 },
  },
  {
    name: 'rise',
    speedMps: mph(61),
    release: RELEASE_RH,
    aim: aimAt(0, 1.02),
    // Heavy backspin: drops markedly less than gravity alone.
    spin: { x: -230, y: 0, z: 0 },
  },
  {
    name: 'curve',
    speedMps: mph(57),
    release: RELEASE_RH,
    aim: aimAt(0.14, 0.82),
    // Spin about the vertical axis: glove-side lateral break.
    spin: { x: 0, y: 210, z: 0 },
  },
  {
    name: 'screw',
    speedMps: mph(57),
    release: RELEASE_RH,
    aim: aimAt(-0.14, 0.82),
    spin: { x: 0, y: -210, z: 0 },
  },
  {
    name: 'dropCurve',
    speedMps: mph(56),
    release: RELEASE_RH,
    aim: aimAt(0.1, 0.62),
    spin: { x: 150, y: 150, z: 0 },
  },
];

/** Builds a variant that crosses the back point at an exact spot. Used for edge cases. */
export function aimedAt(base: PitchSpec, x: number, y: number, name = base.name): PitchSpec {
  return { ...base, name, aim: { x, y, z: 0 } };
}

export function presetByName(name: string): PitchSpec {
  const found = PRESET_PITCHES.find((p) => p.name === name);
  if (!found) throw new Error(`Unknown preset pitch: ${name}`);
  return found;
}
