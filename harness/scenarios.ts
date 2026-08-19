/**
 * Named scenarios the regression suite runs against. Adding a scenario here is how
 * a newly discovered failure mode becomes a permanent guard.
 */

import { CAMERA_PLACEMENT, PLATE } from '@/domain/constants';
import { feet } from '@/domain/units';
import type { CameraExtrinsics, CameraIntrinsics, Vec3 } from '@/domain/types';
import { intrinsicsFromFov, lookAt } from '@/vision/camera';
import { presetByName, simulate, type GroundTruth, type PitchSpec } from './physics';
import { DEFAULT_SCENE, renderSequence, type SceneOptions, type SyntheticFrame } from './render';

/** Virtual plate cam at the spec's ideal placement: 16 ft behind, 4.5 ft up, on centre. */
export function plateCam(width = 1280, height = 720, fovDeg = 68): {
  intrinsics: CameraIntrinsics;
  extrinsics: CameraExtrinsics;
  position: Vec3;
} {
  const p = CAMERA_PLACEMENT.plate;
  const position: Vec3 = { x: 0, y: feet(p.heightFt.ideal), z: feet(p.distanceFt.ideal) };
  // Aim at a point over the plate at typical zone height, not at the ground.
  const target: Vec3 = { x: 0, y: 0.8, z: PLATE.FRONT_Z_M };
  return {
    intrinsics: intrinsicsFromFov(width, height, fovDeg, -0.06),
    extrinsics: lookAt(position, target),
    position,
  };
}

/** Virtual side cam: perpendicular to the pitch line on the first-base side. */
export function sideCam(width = 1280, height = 720, fovDeg = 72): {
  intrinsics: CameraIntrinsics;
  extrinsics: CameraExtrinsics;
  position: Vec3;
} {
  const s = CAMERA_PLACEMENT.side;
  const position: Vec3 = { x: feet(s.distanceFt.ideal), y: feet(s.heightFt.ideal), z: -feet(12) };
  const target: Vec3 = { x: 0, y: 0.9, z: -feet(14) };
  return {
    intrinsics: intrinsicsFromFov(width, height, fovDeg, -0.05),
    extrinsics: lookAt(position, target),
    position,
  };
}

export interface Scenario {
  id: string;
  description: string;
  /** What this scenario is meant to catch. Kept honest and specific. */
  guards: string;
  pitch: PitchSpec;
  scene: Omit<SceneOptions, 'intrinsics' | 'extrinsics'>;
  camera: 'plate' | 'side';
}

export const SCENARIOS: Scenario[] = [
  {
    id: 'daylight-fastball-60fps',
    description: 'Bright daylight, 720p60, plate cam, 62 mph fastball.',
    guards: 'The baseline. If this regresses, everything has regressed.',
    pitch: presetByName('fastball'),
    scene: { ...DEFAULT_SCENE },
    camera: 'plate',
  },
  {
    id: 'daylight-drop-60fps',
    description: 'Bright daylight drop ball, heavy topspin.',
    guards: 'Vertical break sign and magnitude; the trajectory fit must not flatten it.',
    pitch: presetByName('drop'),
    scene: { ...DEFAULT_SCENE },
    camera: 'plate',
  },
  {
    id: 'daylight-rise-60fps',
    description: 'Bright daylight rise ball, heavy backspin.',
    guards: 'Positive vertical break, i.e. dropping less than gravity alone.',
    pitch: presetByName('rise'),
    scene: { ...DEFAULT_SCENE },
    camera: 'plate',
  },
  {
    id: 'daylight-curve-side',
    description: 'Curve ball viewed from the side cam.',
    guards: 'Horizontal break measured laterally, which is the side cam’s whole job.',
    pitch: presetByName('curve'),
    scene: { ...DEFAULT_SCENE },
    camera: 'side',
  },
  {
    id: 'heavy-blur-30fps',
    description: '30 fps with a full 1/30 s exposure. Roughly 13 samples across the flight.',
    guards:
      'The motion-blur failure mode from Section 2. The ball is a long semi-transparent ' +
      'streak here; any circularity gate drops to near-zero detection on this scenario.',
    pitch: presetByName('fastball'),
    scene: { ...DEFAULT_SCENE, fps: 30, exposureS: 1 / 30 },
    camera: 'plate',
  },
  {
    id: 'short-exposure-120fps',
    description: '120 fps with a 1 ms manual exposure, where the platform grants it.',
    guards: 'The best case. Detection and velocity error should both be at their floor.',
    pitch: presetByName('fastball'),
    scene: { ...DEFAULT_SCENE, fps: 120, exposureS: 0.001 },
    camera: 'plate',
  },
  {
    id: 'poor-light',
    description: 'Dusk. Low light level, high sensor noise, long exposure.',
    guards:
      'Must DEGRADE HONESTLY rather than fabricate. Low confidence and low detection ' +
      'are the correct outcomes here; a confident call is a failure.',
    pitch: presetByName('fastball'),
    scene: { ...DEFAULT_SCENE, lightLevel: 0.35, noiseSigma: 9, exposureS: 1 / 30, fps: 30 },
    camera: 'plate',
  },
  {
    id: 'chain-link',
    description: 'Shooting through an in-focus chain-link backstop.',
    guards: 'The foreground-mesh case the setup wizard warns about.',
    pitch: presetByName('fastball'),
    scene: { ...DEFAULT_SCENE, chainLink: true },
    camera: 'plate',
  },
  {
    id: 'yellow-clutter',
    description: 'Static yellow uniform and equipment in frame.',
    guards:
      'False positives. Colour alone identifies these as balls; only background ' +
      'subtraction plus the arc/velocity gate rejects them.',
    pitch: presetByName('fastball'),
    scene: { ...DEFAULT_SCENE, yellowClutter: true },
    camera: 'plate',
  },
  {
    id: 'moving-clutter',
    description: 'A yellow ball rolling slowly across the dirt during the pitch.',
    guards:
      'The hardest false positive: right colour, right size, moving. Rejected only by ' +
      'the plausible-velocity and release-region gates.',
    pitch: presetByName('fastball'),
    scene: { ...DEFAULT_SCENE, yellowClutter: true, movingClutter: true },
    camera: 'plate',
  },
  {
    id: 'no-pitch-clutter-only',
    description: 'Clutter with no pitch at all. Used for the false-positive rate metric.',
    guards: 'Any promoted track in this scenario is a false positive by definition.',
    // Speed far below the plausible floor and no real flight: nothing here is a pitch.
    pitch: { ...presetByName('fastball'), speedMps: 2, name: 'none' },
    scene: { ...DEFAULT_SCENE, yellowClutter: true, movingClutter: true },
    camera: 'plate',
  },
];

export interface BuiltScenario {
  scenario: Scenario;
  groundTruth: GroundTruth;
  frames: SyntheticFrame[];
  intrinsics: CameraIntrinsics;
  extrinsics: CameraExtrinsics;
  cameraPosition: Vec3;
}

export function buildScenario(scenario: Scenario, width = 1280, height = 720): BuiltScenario {
  const cam = scenario.camera === 'side' ? sideCam(width, height) : plateCam(width, height);
  const groundTruth = simulate(scenario.pitch);
  const frames = renderSequence(groundTruth, {
    ...scenario.scene,
    intrinsics: cam.intrinsics,
    extrinsics: cam.extrinsics,
  });
  return {
    scenario,
    groundTruth,
    frames,
    intrinsics: cam.intrinsics,
    extrinsics: cam.extrinsics,
    cameraPosition: cam.position,
  };
}

export function scenarioById(id: string): Scenario {
  const s = SCENARIOS.find((x) => x.id === id);
  if (!s) throw new Error(`Unknown scenario: ${id}`);
  return s;
}
