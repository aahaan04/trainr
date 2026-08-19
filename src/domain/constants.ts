/**
 * Domain constants for fastpitch softball. Section 1 of the build spec.
 *
 * WORLD COORDINATE SYSTEM (right-handed, shared by every workstream):
 *
 *   origin  = the BACK POINT of home plate, at ground level
 *   +X      = toward first base (a batter's right when facing the pitcher)
 *   +Y      = up
 *   +Z      = away from the pitcher, toward the backstop
 *
 * Consequences worth internalising before writing geometry code:
 *   - The pitcher stands at NEGATIVE Z. The rubber at 43 ft is z = -13.106 m.
 *   - The ball therefore travels in the +Z direction as it approaches the plate.
 *   - The plate's front edge (the 17 in edge facing the pitcher) is at z = -0.4318 m.
 *   - The plate's back point is at z = 0, which is where the ball ends up.
 *   - For the plate camera (behind the plate, looking down +Z... i.e. looking toward
 *     -Z), world +X projects to image +x. No mirror flip is needed.
 */

import { inches, feet, mph } from './units';

// ---------------------------------------------------------------------------
// Ball
// ---------------------------------------------------------------------------

/**
 * The single most important number in the app. A known real-world object size is
 * what makes monocular depth estimation possible at all.
 */
export const BALL = {
  /** Regulation fastpitch: 12 in circumference. */
  CIRCUMFERENCE_M: inches(12),
  /** 12/pi in = 3.8197 in = 9.702 cm. */
  DIAMETER_M: inches(12) / Math.PI,
  RADIUS_M: inches(12) / (2 * Math.PI),
  /** Regulation mass is 6.25-7.0 oz; 6.6 oz is mid-range. Used by the physics model. */
  MASS_KG: 0.1871,
  /** Sphere drag coefficient in the Reynolds range of a pitched softball. */
  DRAG_COEFFICIENT: 0.4,
  CROSS_SECTION_M2: Math.PI * (inches(12) / (2 * Math.PI)) ** 2,
} as const;

/**
 * Regulation cover is optic yellow (NCAA, NFHS, USA Softball all mandate it).
 * Sits between yellow and yellow-green.
 */
export const BALL_COLOR = {
  SRGB_RANGE: ['#DFEE00', '#D1E231'] as const,
  REPRESENTATIVE_SRGB: '#D8E600',
} as const;

/**
 * Starting HSV gate in OpenCV convention: H 0-179, S 0-255, V 0-255.
 * H 22-45 maps to 44-90 degrees of true hue, i.e. yellow through yellow-green.
 *
 * THIS IS A SEED, NOT A SHIPPED CONSTANT. Section 3.3 requires per-session
 * calibration from the actual game ball under the actual light. Detection quality
 * falls off a cliff if this is used unrefined.
 */
export const HSV_GATE_SEED = {
  hMin: 22,
  hMax: 45,
  sMin: 60,
  sMax: 255,
  vMin: 110,
  vMax: 255,
} as const;

export interface HsvGate {
  hMin: number;
  hMax: number;
  sMin: number;
  sMax: number;
  vMin: number;
  vMax: number;
}

export const HSV_OPENCV_MAX = { h: 179, s: 255, v: 255 } as const;

/** OpenCV-convention gate -> normalised [0,1] triplets, for shader uniforms. */
export function hsvGateToNormalized(g: HsvGate): { lo: [number, number, number]; hi: [number, number, number] } {
  return {
    lo: [g.hMin / 180, g.sMin / 255, g.vMin / 255],
    hi: [g.hMax / 180, g.sMax / 255, g.vMax / 255],
  };
}

/** OpenCV hue (0-179) -> true hue in degrees (0-359). */
export const openCvHueToDegrees = (h: number): number => h * 2;

// ---------------------------------------------------------------------------
// Home plate
// ---------------------------------------------------------------------------

const PLATE_HALF_WIDTH_M = inches(8.5);
const PLATE_SIDE_LEN_M = inches(8.5);
const PLATE_DEPTH_M = inches(17);

/**
 * The calibration fiducial. Five corners, exact rulebook geometry.
 *
 * Sanity check on the model: the diagonal from a side point to the back point is
 * sqrt(8.5^2 + 8.5^2) = 12.02 in, which is the rulebook's 12 in diagonal side.
 * The model is self-consistent; do not "fix" it.
 *
 * Corner order is canonical and is the order the setup wizard asks the user to tap.
 */
export const PLATE_CORNER_ORDER = [
  'backPoint',
  'thirdBaseSide',
  'firstBaseSide',
  'thirdBaseFront',
  'firstBaseFront',
] as const;

export type PlateCornerName = (typeof PLATE_CORNER_ORDER)[number];

/** Human-readable prompts for the tap-the-corners calibration step. */
export const PLATE_CORNER_LABELS: Record<PlateCornerName, string> = {
  backPoint: 'Back point (nearest the catcher)',
  thirdBaseSide: 'Third-base side corner',
  firstBaseSide: 'First-base side corner',
  thirdBaseFront: 'Third-base front corner',
  firstBaseFront: 'First-base front corner',
};

/** Plate corners in world metres. y = 0 for all of them; the plate is flush with the ground. */
export const PLATE_MODEL_M: Record<PlateCornerName, readonly [number, number, number]> = {
  backPoint: [0, 0, 0],
  thirdBaseSide: [-PLATE_HALF_WIDTH_M, 0, -PLATE_SIDE_LEN_M],
  firstBaseSide: [+PLATE_HALF_WIDTH_M, 0, -PLATE_SIDE_LEN_M],
  thirdBaseFront: [-PLATE_HALF_WIDTH_M, 0, -PLATE_DEPTH_M],
  firstBaseFront: [+PLATE_HALF_WIDTH_M, 0, -PLATE_DEPTH_M],
};

/** Same points as a flat array in canonical order, ready for solvePnP. */
export const PLATE_MODEL_POINTS: readonly (readonly [number, number, number])[] =
  PLATE_CORNER_ORDER.map((k) => PLATE_MODEL_M[k]);

export const PLATE = {
  WIDTH_M: inches(17),
  HALF_WIDTH_M: PLATE_HALF_WIDTH_M,
  DEPTH_M: PLATE_DEPTH_M,
  SIDE_LEN_M: PLATE_SIDE_LEN_M,
  DIAGONAL_LEN_M: inches(12),
  /** z of the front edge, the plane the ball reaches first. */
  FRONT_Z_M: -PLATE_DEPTH_M,
  /** z of the back point, the plane the ball reaches last. */
  BACK_Z_M: 0,
} as const;

// ---------------------------------------------------------------------------
// Field
// ---------------------------------------------------------------------------

export const FIELD = {
  PITCHERS_CIRCLE_DIAMETER_M: feet(16),
  RUBBER_WIDTH_M: inches(24),
  RUBBER_DEPTH_M: inches(6),
  BATTERS_BOX_WIDTH_M: feet(3),
  BATTERS_BOX_LENGTH_M: feet(7),
  /**
   * Batter's box inside edge sits 6 in off the plate, and the box is centred
   * slightly ahead of the plate's back point.
   */
  BATTERS_BOX_INSIDE_GAP_M: inches(6),
  BASE_PATH_M: feet(60),
  /** Catcher's box / typical catcher glove position behind the back point. */
  CATCHER_SETUP_Z_M: feet(2.5),
} as const;

// ---------------------------------------------------------------------------
// Pitching distance
// ---------------------------------------------------------------------------

export const PITCHING_DISTANCE_PRESETS = [
  { id: 'd43', label: 'NCAA / NFHS / 14U+', feet: 43 },
  { id: 'd40', label: '12U', feet: 40 },
  { id: 'd35', label: '10U', feet: 35 },
] as const;

export type PitchingDistanceId = (typeof PITCHING_DISTANCE_PRESETS)[number]['id'];

export const DEFAULT_PITCHING_DISTANCE_FT = 43;

/** Rubber front edge is this far from the plate's back point, on the -Z side. */
export const rubberZ = (distanceFt: number): number => -feet(distanceFt);

/**
 * Fastpitch release happens well in front of the rubber because of the stride.
 * These bounds are used to seed the release-region gate; the actual release point
 * is MEASURED per pitch, never assumed.
 */
export const RELEASE = {
  MIN_STRIDE_M: feet(5),
  MAX_STRIDE_M: feet(7),
  TYPICAL_STRIDE_M: feet(6),
  /** Plausible release height above ground for a fastpitch windmill delivery. */
  MIN_HEIGHT_M: feet(0.4),
  MAX_HEIGHT_M: feet(3.5),
  /** Lateral half-window around the pitch line where a release can plausibly occur. */
  LATERAL_HALF_WINDOW_M: feet(3),
} as const;

/** Effective flight length: rubber-to-plate minus the stride. ~36-38 ft at 43 ft. */
export const effectiveFlightLengthM = (
  distanceFt: number,
  strideM: number = RELEASE.TYPICAL_STRIDE_M,
): number => feet(distanceFt) - strideM;

// ---------------------------------------------------------------------------
// Strike zone
// ---------------------------------------------------------------------------

export const RULE_SETS = [
  {
    id: 'ncaa',
    label: 'NCAA / NFHS',
    topLandmark: 'forwardArmpit',
    bottomLandmark: 'kneeTop',
    description: 'Over the plate between the forward armpit and the top of the knees.',
  },
  {
    id: 'usaSoftball',
    label: 'USA Softball',
    topLandmark: 'backShoulder',
    bottomLandmark: 'kneeTop',
    description: 'Over the plate between the back shoulder and the top of the knees.',
  },
] as const;

export type RuleSetId = (typeof RULE_SETS)[number]['id'];
export type ZoneLandmark = (typeof RULE_SETS)[number]['topLandmark' | 'bottomLandmark'];

export const DEFAULT_RULE_SET: RuleSetId = 'ncaa';

/**
 * Anthropometric ratios of standing height, used for the manual "enter a batter
 * height" path and for no-batter bullpen mode. These are ESTIMATES, and the app
 * must present zones derived from them as approximate. Pose-derived zones are
 * always preferred when a batter is in frame.
 */
export const BATTER_PROPORTIONS = {
  STANDING_ARMPIT_RATIO: 0.735,
  STANDING_SHOULDER_RATIO: 0.805,
  STANDING_KNEE_TOP_RATIO: 0.285,
  /** Batters crouch. Applied to all three landmarks to approximate a stance. */
  STANCE_CROUCH_FACTOR: 0.93,
} as const;

export const DEFAULT_BATTER_HEIGHT_M = inches(66);

/** Vertical zone bounds from a standing height, per rule set. */
export function zoneFromHeight(heightM: number, ruleSet: RuleSetId): { bottomM: number; topM: number } {
  const c = BATTER_PROPORTIONS.STANCE_CROUCH_FACTOR;
  const topRatio =
    ruleSet === 'usaSoftball'
      ? BATTER_PROPORTIONS.STANDING_SHOULDER_RATIO
      : BATTER_PROPORTIONS.STANDING_ARMPIT_RATIO;
  return {
    bottomM: heightM * BATTER_PROPORTIONS.STANDING_KNEE_TOP_RATIO * c,
    topM: heightM * topRatio * c,
  };
}

export const ZONE_RULES = {
  /**
   * A pitch is a strike if ANY PART of the ball touches ANY PART of the zone over
   * ANY PART of the plate. Implemented by inflating the zone by one ball radius on
   * all sides and testing the ball CENTRE against the inflated zone.
   */
  INFLATION_M: BALL.RADIUS_M,
  /**
   * Both plate planes must be evaluated. A curve can miss at the front and clip at
   * the back; either qualifying makes it a strike.
   */
  EVALUATION_PLANES_Z: [PLATE.FRONT_Z_M, PLATE.BACK_Z_M] as const,
  /** The 3x3 display grid, plus a shadow ring one ball-width outside. */
  GRID_DIVISIONS: 3,
  /** Heat map resolution from Section 7: zone plus surrounding shadow zone. */
  HEATMAP_DIVISIONS: 5,
  SHADOW_ZONE_M: BALL.DIAMETER_M,
} as const;

export type PlatePlane = 'front' | 'back';

// ---------------------------------------------------------------------------
// Physics sanity bounds — used to reject impossible tracks
// ---------------------------------------------------------------------------

export const PHYSICS = {
  GRAVITY_MPS2: 9.81,
  AIR_DENSITY_KGM3: 1.225,
  MIN_SPEED_MPS: mph(30),
  MAX_SPEED_MPS: mph(80),
  /** Elite college fastpitch tops out near here; above it, suspect the track. */
  ELITE_SPEED_MPS: mph(70),
  /** At 60 mph over 37 ft the flight lasts ~0.42 s. Anything outside this is not a pitch. */
  MIN_FLIGHT_TIME_S: 0.25,
  MAX_FLIGHT_TIME_S: 1.2,
  /** Max plausible non-gravitational acceleration (drag + Magnus), as a fit bound. */
  MAX_AERO_ACCEL_MPS2: 25,
} as const;

// ---------------------------------------------------------------------------
// Capture
// ---------------------------------------------------------------------------

/**
 * Temporal resolution beats spatial resolution here. At 30 fps there are ~13
 * samples across the whole flight, which is marginal; at 60 fps there are ~26,
 * which is workable. Always prefer 720p60 over 1080p30.
 */
export const CAPTURE = {
  PREFERRED_WIDTH: 1280,
  PREFERRED_HEIGHT: 720,
  IDEAL_FPS: 120,
  MIN_FPS: 60,
  ACCEPTABLE_FPS: 30,
  /** Target manual exposure, where the platform grants it. 1/1000 s. */
  TARGET_EXPOSURE_S: 0.001,
  /** Segmentation runs at half resolution. */
  MASK_DOWNSCALE: 2,
  /** Per-frame pipeline budget at 720p60. */
  FRAME_BUDGET_MS: 8,
  /** Plate crossing to on-screen call. */
  LATENCY_BUDGET_MS: 500,
  /** Rolling clip buffer around each detected pitch. */
  CLIP_SECONDS: 3,
} as const;

/** Scene brightness below this makes motion blur unusable; warn during setup. */
export const LIGHTING = {
  MIN_MEAN_LUMA: 70,
  GOOD_MEAN_LUMA: 120,
} as const;

// ---------------------------------------------------------------------------
// Tracking
// ---------------------------------------------------------------------------

export const TRACKING = {
  /**
   * A track needs this many detections along a plausible arc before it is promoted
   * to a pitch. This is the primary defence against a fielder's yellow glove being
   * reported as a 62 mph fastball.
   */
  MIN_DETECTIONS_FOR_PITCH: 5,
  MAX_ACTIVE_HYPOTHESES: 6,
  /** Frames a hypothesis may coast with no detection before it is dropped. */
  MAX_COAST_FRAMES: 3,
  /** Mahalanobis gate on candidate-to-prediction association. */
  ASSOCIATION_GATE_SIGMA: 3.5,
  /**
   * Motion blur means the ball is a streak, not a circle. NEVER gate on circularity;
   * it rejects nearly every real detection. Gate on area, aspect ratio, hue
   * consistency and streak coherence instead.
   */
  MAX_BLOB_ASPECT_RATIO: 12,
  MIN_BLOB_AREA_PX: 6,
  MAX_BLOB_AREA_PX: 20000,
  MAX_HUE_VARIANCE: 220,
  /** Streak-derived and displacement-derived speed must agree within this factor. */
  SPEED_CROSSCHECK_TOLERANCE: 0.6,
  /** Running-median background window, in frames. */
  BACKGROUND_WINDOW: 45,
} as const;

/** Confidence bands driving the three-bar meter and the honesty rules in Section 16. */
export const CONFIDENCE = {
  CONFIDENT: 0.75,
  TENTATIVE: 0.45,
} as const;

export type ConfidenceBand = 'confident' | 'tentative' | 'flagged';

export function confidenceBand(v: number): ConfidenceBand {
  if (v >= CONFIDENCE.CONFIDENT) return 'confident';
  if (v >= CONFIDENCE.TENTATIVE) return 'tentative';
  return 'flagged';
}

// ---------------------------------------------------------------------------
// Multi-camera
// ---------------------------------------------------------------------------

export const SYNC = {
  /** Cristian's algorithm sample count per sync round. */
  PING_SAMPLES: 50,
  RESYNC_INTERVAL_MS: 30_000,
  TARGET_OFFSET_MS: 10,
  /** At 60 mph the ball moves ~2.7 cm per millisecond, so warn past this. */
  WARN_OFFSET_MS: 20,
  PAIRING_CODE_LENGTH: 6,
  /** Characters chosen to avoid 0/O and 1/I/L confusion when read aloud on a field. */
  PAIRING_ALPHABET: 'ABCDEFGHJKMNPQRSTUVWXYZ23456789',
} as const;

/** cm of ball travel per ms of clock error, at the given speed. Used in UI copy. */
export const cmPerMsAt = (speedMps: number): number => speedMps * 0.1;

// ---------------------------------------------------------------------------
// Camera placement guidance (Section 3.1, drives the setup wizard and the diagram)
// ---------------------------------------------------------------------------

export const CAMERA_PLACEMENT = {
  plate: {
    id: 'plate',
    label: 'Plate cam',
    required: true,
    distanceFt: { min: 12, ideal: 16, max: 20 },
    heightFt: { min: 4, ideal: 4.5, max: 5 },
    /** Behind the plate, on the pitcher-catcher centre line. */
    azimuthDeg: 0,
    why: 'From here the strike zone is nearly a frontal rectangle, which makes the strike/ball call geometrically simple and robust. The ball also grows as it approaches, giving a clean depth signal.',
    notes: [
      'Mount behind the backstop. Never put a device where a pitch can reach it.',
      'Shooting through chain-link: put the lens as close to the mesh as possible so the fence falls out of focus, or shoot through an opening.',
      'A mesh pattern that is in focus will noticeably degrade detection.',
    ],
  },
  side: {
    id: 'side',
    label: 'Side cam',
    required: false,
    distanceFt: { min: 15, ideal: 20, max: 25 },
    heightFt: { min: 3, ideal: 3.5, max: 4 },
    /** Perpendicular to the pitch line, first-base side by preference. */
    azimuthDeg: 90,
    why: 'Horizontal break, true vertical drop, release height and stride extension are all measured far more accurately from the side. Velocity from lateral displacement beats velocity from apparent-size change.',
    notes: [
      'Frame from the release point through the plate, not just the plate.',
      'First-base side is preferred but either side works.',
    ],
  },
} as const;

export type CameraRole = keyof typeof CAMERA_PLACEMENT;

/** What the user actually gains by adding the second camera. Shown in the diagram panel. */
export const TWO_CAMERA_UPGRADES = [
  { metric: 'Horizontal break', single: 'Approximate', dual: 'Accurate' },
  { metric: 'Vertical break', single: 'Approximate', dual: 'Accurate' },
  { metric: 'Release point', single: 'Approximate', dual: 'Accurate' },
  { metric: 'Velocity', single: 'Good', dual: 'Accurate' },
  { metric: 'Strike / ball call', single: 'Reliable', dual: 'Reliable' },
  { metric: 'Plate crossing position', single: 'Within ~4 in', dual: 'Within ~2 in' },
] as const;

// ---------------------------------------------------------------------------
// Pitch types
// ---------------------------------------------------------------------------

export const PITCH_TYPES = [
  { id: 'fastball', label: 'Fastball', short: 'FB' },
  { id: 'changeup', label: 'Changeup', short: 'CH' },
  { id: 'drop', label: 'Drop', short: 'DR' },
  { id: 'rise', label: 'Rise', short: 'RI' },
  { id: 'curve', label: 'Curve', short: 'CU' },
  { id: 'screw', label: 'Screw', short: 'SC' },
  { id: 'dropCurve', label: 'Drop Curve', short: 'DC' },
  { id: 'custom', label: 'Custom', short: 'CX' },
] as const;

export type PitchTypeId = (typeof PITCH_TYPES)[number]['id'];

export const PITCH_TYPE_LABEL: Record<PitchTypeId, string> = Object.fromEntries(
  PITCH_TYPES.map((p) => [p.id, p.label]),
) as Record<PitchTypeId, string>;

export type Handedness = 'right' | 'left';

/** Labels needed per type before the learned classifier is fit. Below this, rules only. */
export const CLASSIFIER = {
  MIN_LABELS_PER_TYPE: 20,
  KNN_FALLBACK_MIN: 5,
  KNN_K: 5,
  /** Two types overlapping above this rate are not distinguishable to a batter either. */
  REPERTOIRE_OVERLAP_WARN: 0.3,
} as const;

/**
 * Cold-start rule-of-thumb offsets, used only until the per-pitcher model is fit.
 * A changeup runs 6-12 mph slower than the fastball with a similar shape.
 */
export const COLD_START = {
  CHANGEUP_MIN_DELTA_MPS: mph(6),
  CHANGEUP_MAX_DELTA_MPS: mph(12),
} as const;

// ---------------------------------------------------------------------------
// Stats
// ---------------------------------------------------------------------------

export const STATS = {
  /** Flag a sustained drop of more than this from the session's peak velocity. */
  FATIGUE_DROP_MPS: mph(3),
  FATIGUE_WINDOW_PITCHES: 5,
  /** Default radius for "hit the target" in call-before mode. */
  DEFAULT_COMMAND_RADIUS_M: inches(6),
} as const;

// ---------------------------------------------------------------------------
// Acceptance thresholds (Section 15) — asserted by the regression suite
// ---------------------------------------------------------------------------

export const ACCEPTANCE = {
  MIN_DETECTION_RATE: 0.9,
  MAX_PLATE_CROSSING_ERROR_M: inches(2),
  MAX_VELOCITY_ERROR_MPS: mph(2),
  MIN_CALL_AGREEMENT_CLEAR: 0.95,
  MIN_CALL_AGREEMENT_BORDERLINE: 0.85,
  /** A pitch is "borderline" if it passes within this of a zone edge. */
  BORDERLINE_MARGIN_M: inches(2),
  MAX_FALSE_POSITIVES_PER_100: 1,
  MAX_LATENCY_MS: 500,
  MIN_CONTRAST_RATIO: 4.5,
} as const;
