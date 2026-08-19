/**
 * Renders synthetic camera frames from a ground-truth trajectory, into raw RGBA
 * buffers. No canvas, no browser: the regression suite runs in plain Node.
 *
 * The single most important thing this does is MOTION BLUR. At 60 mph on a 1/60 s
 * exposure the ball travels ~4.6 diameters per frame, so it images as a semi-
 * transparent streak, not a circle. Frames are integrated over the exposure window
 * by compositing many sub-samples, which reproduces that honestly. Any detector
 * that only works on clean circles will visibly fail against these frames, which is
 * exactly the point.
 */

import { BALL, BALL_COLOR, CAPTURE } from '@/domain/constants';
import type { CameraExtrinsics, CameraIntrinsics, Vec3 } from '@/domain/types';
import { apparentDiameterPx, projectPoint } from '@/vision/camera';
import { stateAt, type GroundTruth } from './physics';

export interface SceneOptions {
  intrinsics: CameraIntrinsics;
  extrinsics: CameraExtrinsics;
  fps: number;
  /** Exposure in seconds. Governs streak length. Auto-exposure outdoors is ~1/60. */
  exposureS: number;
  /** 0 = pitch dark, 1 = bright daylight. Scales overall luma and the ball's V. */
  lightLevel: number;
  /** Gaussian sensor noise standard deviation, in 8-bit counts. */
  noiseSigma: number;
  /** Chain-link mesh in the foreground, in focus. Section 3.1's warned-about case. */
  chainLink: boolean;
  /** Static yellow distractors: a uniform, a bat grip, a bucket of balls. */
  yellowClutter: boolean;
  /** A slow-moving yellow object, e.g. a warm-up ball rolling. Harder false positive. */
  movingClutter: boolean;
  seed: number;
}

export const DEFAULT_SCENE: Omit<SceneOptions, 'intrinsics' | 'extrinsics'> = {
  fps: 60,
  exposureS: 1 / 60,
  lightLevel: 0.95,
  noiseSigma: 2.5,
  chainLink: false,
  yellowClutter: false,
  movingClutter: false,
  seed: 1,
};

export interface SyntheticFrame {
  index: number;
  /** Frame midpoint time in seconds since release. */
  tS: number;
  timestampMs: number;
  width: number;
  height: number;
  exposureS: number;
  data: Uint8ClampedArray;
  /**
   * Ground truth for this frame. `null` when the ball is not in frame, which is how
   * the detection-rate metric knows which frames it is allowed to miss.
   */
  truth: {
    /** Ball centre at the frame midpoint, image pixels. */
    pixel: { x: number; y: number };
    world: Vec3;
    /** True ball diameter in pixels. What a correct minor-axis estimate should recover. */
    diameterPx: number;
    /** Streak length in pixels over the exposure. What the major axis should recover. */
    streakPx: number;
    depthM: number;
    visible: boolean;
  } | null;
}

// Deterministic PRNG so failures reproduce exactly.
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const hexToRgb = (hex: string): [number, number, number] => {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};

const BALL_RGB = hexToRgb(BALL_COLOR.REPRESENTATIVE_SRGB);

/** Paints the static backdrop: dirt, grass, backstop, plus any configured clutter. */
function paintBackground(buf: Uint8ClampedArray, o: SceneOptions): void {
  const { width, height } = o.intrinsics;
  const rand = mulberry32(o.seed);
  const L = o.lightLevel;

  for (let y = 0; y < height; y++) {
    // A soft horizon: grass above, dirt below. Enough structure to be a real
    // background-subtraction problem without being a photo.
    const horizon = height * 0.45;
    const isGrass = y < horizon;
    const base: [number, number, number] = isGrass ? [72, 96, 58] : [126, 104, 82];
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const grain = (rand() - 0.5) * 14;
      buf[i] = (base[0] + grain) * L;
      buf[i + 1] = (base[1] + grain) * L;
      buf[i + 2] = (base[2] + grain) * L;
      buf[i + 3] = 255;
    }
  }

  if (o.yellowClutter) {
    // A yellow jersey torso and a bucket rim. Static, saturated, ball-coloured, and
    // large. Background subtraction should suppress these; colour alone will not.
    fillRect(buf, o, Math.round(width * 0.16), Math.round(height * 0.52), 90, 130, [210, 220, 40]);
    fillRect(buf, o, Math.round(width * 0.78), Math.round(height * 0.74), 60, 40, [200, 214, 30]);
  }

  if (o.chainLink) {
    // In-focus mesh across the whole frame. Spec 3.1 warns users about exactly this.
    const pitch = 14;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const onMesh = (x + y) % pitch < 2 || (x - y + height) % pitch < 2;
        if (!onMesh) continue;
        const i = (y * width + x) * 4;
        buf[i] = buf[i] * 0.45 + 40;
        buf[i + 1] = buf[i + 1] * 0.45 + 42;
        buf[i + 2] = buf[i + 2] * 0.45 + 44;
      }
    }
  }
}

function fillRect(
  buf: Uint8ClampedArray,
  o: SceneOptions,
  x0: number,
  y0: number,
  w: number,
  h: number,
  rgb: [number, number, number],
): void {
  const { width, height } = o.intrinsics;
  for (let y = y0; y < Math.min(y0 + h, height); y++) {
    for (let x = x0; x < Math.min(x0 + w, width); x++) {
      if (x < 0 || y < 0) continue;
      const i = (y * width + x) * 4;
      buf[i] = rgb[0] * o.lightLevel;
      buf[i + 1] = rgb[1] * o.lightLevel;
      buf[i + 2] = rgb[2] * o.lightLevel;
    }
  }
}

/** Alpha-composites an anti-aliased disc. Called many times per frame to build a streak. */
function splatDisc(
  buf: Uint8ClampedArray,
  width: number,
  height: number,
  cx: number,
  cy: number,
  radius: number,
  rgb: [number, number, number],
  alpha: number,
): void {
  const r = Math.max(radius, 0.5);
  const x0 = Math.max(0, Math.floor(cx - r - 1));
  const x1 = Math.min(width - 1, Math.ceil(cx + r + 1));
  const y0 = Math.max(0, Math.floor(cy - r - 1));
  const y1 = Math.min(height - 1, Math.ceil(cy + r + 1));

  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
      // One-pixel soft edge approximates the sensor's partial coverage.
      const cov = Math.min(1, Math.max(0, r + 0.5 - d));
      if (cov <= 0) continue;
      const a = alpha * cov;
      const i = (y * width + x) * 4;
      buf[i] = buf[i] * (1 - a) + rgb[0] * a;
      buf[i + 1] = buf[i + 1] * (1 - a) + rgb[1] * a;
      buf[i + 2] = buf[i + 2] * (1 - a) + rgb[2] * a;
    }
  }
}

function addNoise(buf: Uint8ClampedArray, sigma: number, rand: () => number): void {
  if (sigma <= 0) return;
  for (let i = 0; i < buf.length; i += 4) {
    // Box-Muller, one sample shared across channels plus a small per-channel term,
    // which is closer to real sensor noise than three independent draws.
    const u = Math.max(rand(), 1e-9);
    const n = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rand()) * sigma;
    buf[i] += n + (rand() - 0.5) * sigma;
    buf[i + 1] += n + (rand() - 0.5) * sigma;
    buf[i + 2] += n + (rand() - 0.5) * sigma;
  }
}

export function renderSequence(gt: GroundTruth, opts: SceneOptions): SyntheticFrame[] {
  const { intrinsics: intr, extrinsics: ext, fps } = opts;
  const { width, height } = intr;
  const frameDt = 1 / fps;
  const rand = mulberry32(opts.seed * 7919 + 13);

  const background = new Uint8ClampedArray(width * height * 4);
  paintBackground(background, opts);

  const lastT = gt.samples[gt.samples.length - 1].tS;
  const frames: SyntheticFrame[] = [];
  const ballRgb: [number, number, number] = [
    BALL_RGB[0] * opts.lightLevel,
    BALL_RGB[1] * opts.lightLevel,
    BALL_RGB[2] * opts.lightLevel,
  ];

  for (let index = 0; ; index++) {
    const tStart = index * frameDt;
    if (tStart > lastT) break;
    const exposure = Math.min(opts.exposureS, frameDt);
    const tMid = tStart + exposure / 2;

    const data = new Uint8ClampedArray(background);

    if (opts.movingClutter) {
      // A yellow ball rolling slowly across the dirt: right colour, wrong kinematics.
      // Only a tracker that gates on plausible velocity and arc will reject it.
      const cx = ((tStart * 60) % (width + 60)) - 30;
      splatDisc(data, width, height, cx, height * 0.86, 9, [205, 219, 35], 1);
    }

    // Integrate over the exposure window. Sub-sample count scales with how far the
    // ball moves, so fast frames stay smooth without wasting work on slow ones.
    const midState = stateAt(gt, tMid);
    let truth: SyntheticFrame['truth'] = null;

    if (midState) {
      const midProj = projectPoint(intr, ext, midState.position);
      const diameterPx = apparentDiameterPx(intr, BALL.DIAMETER_M, midProj.depthM);

      const startState = stateAt(gt, tStart);
      const endState = stateAt(gt, tStart + exposure);
      let streakPx = 0;
      if (startState && endState) {
        const a = projectPoint(intr, ext, startState.position);
        const b = projectPoint(intr, ext, endState.position);
        if (Number.isFinite(a.pixel.x) && Number.isFinite(b.pixel.x)) {
          streakPx = Math.hypot(b.pixel.x - a.pixel.x, b.pixel.y - a.pixel.y);
        }
      }

      const subSamples = Math.max(4, Math.min(96, Math.ceil(streakPx / 1.5)));
      // Energy is conserved across the streak: a fast ball is dimmer per pixel,
      // which is why fast pitches look semi-transparent on real footage.
      const alphaPer = Math.min(1, 3 / subSamples + 0.14);

      for (let s = 0; s < subSamples; s++) {
        const ts = tStart + (exposure * s) / Math.max(1, subSamples - 1);
        const st = stateAt(gt, ts);
        if (!st) continue;
        const pr = projectPoint(intr, ext, st.position);
        if (!Number.isFinite(pr.pixel.x) || pr.depthM <= 0) continue;
        const rPx = apparentDiameterPx(intr, BALL.DIAMETER_M, pr.depthM) / 2;
        splatDisc(data, width, height, pr.pixel.x, pr.pixel.y, rPx, ballRgb, alphaPer);
      }

      truth = {
        pixel: midProj.pixel,
        world: midState.position,
        diameterPx,
        streakPx,
        depthM: midProj.depthM,
        visible: midProj.visible && midProj.depthM > 0,
      };
    }

    addNoise(data, opts.noiseSigma, rand);

    frames.push({
      index,
      tS: tMid,
      timestampMs: tStart * 1000,
      width,
      height,
      exposureS: exposure,
      data,
      truth,
    });
  }

  return frames;
}

/** Convenience: the plate-cam placement from Section 3.1, as virtual camera params. */
export const DEFAULT_EXPOSURE_S = 1 / 60;
export const SHORT_EXPOSURE_S = CAPTURE.TARGET_EXPOSURE_S;
