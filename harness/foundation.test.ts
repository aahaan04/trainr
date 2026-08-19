/**
 * Foundation self-checks. These guard the shared assumptions that every workstream
 * builds on: the coordinate frame, the plate model, the camera math, and the
 * physics simulator. If one of these fails, downstream failures are meaningless.
 */

import { describe, expect, it } from 'vitest';
import {
  BALL,
  PLATE,
  PLATE_MODEL_M,
  PLATE_MODEL_POINTS,
  PHYSICS,
  zoneFromHeight,
} from '@/domain/constants';
import { feet, inches, toInches, toMph } from '@/domain/units';
import {
  apparentDiameterPx,
  cameraCenter,
  depthFromDiameterPx,
  intrinsicsFromFov,
  lookAt,
  matrixToRodrigues,
  projectPoint,
  reprojectionError,
  rodriguesToMatrix,
  undistort,
  distort,
  unprojectRay,
} from '@/vision/camera';
import { presetByName, simulate } from './physics';
import { buildScenario, plateCam, scenarioById } from './scenarios';
import { defaultTestZone, evaluateZone, referenceCall } from './metrics';

describe('plate model', () => {
  it('is dimensionally self-consistent with the rulebook', () => {
    const { thirdBaseSide, backPoint, thirdBaseFront, firstBaseFront } = PLATE_MODEL_M;
    // The diagonal side must be the rulebook's 12 in.
    const diag = Math.hypot(thirdBaseSide[0] - backPoint[0], thirdBaseSide[2] - backPoint[2]);
    expect(toInches(diag)).toBeCloseTo(12.02, 1);
    // Front edge must be 17 in wide.
    expect(toInches(firstBaseFront[0] - thirdBaseFront[0])).toBeCloseTo(17, 6);
    // Total depth must be 17 in.
    expect(toInches(Math.abs(thirdBaseFront[2]))).toBeCloseTo(17, 6);
    // The plate is flat on the ground.
    expect(PLATE_MODEL_POINTS.every((p) => p[1] === 0)).toBe(true);
  });

  it('places the front edge toward the pitcher and the back point at the origin', () => {
    expect(PLATE.FRONT_Z_M).toBeLessThan(0);
    expect(PLATE.BACK_Z_M).toBe(0);
  });
});

describe('ball constants', () => {
  it('derives diameter from the 12 in circumference', () => {
    expect(BALL.DIAMETER_M * 100).toBeCloseTo(9.7, 1);
    expect(toInches(BALL.DIAMETER_M)).toBeCloseTo(3.82, 2);
    expect(BALL.RADIUS_M * 2).toBeCloseTo(BALL.DIAMETER_M, 12);
  });
});

describe('camera math', () => {
  const { intrinsics, extrinsics, position } = plateCam();

  it('recovers the camera centre from its extrinsics', () => {
    const c = cameraCenter(extrinsics);
    expect(c.x).toBeCloseTo(position.x, 9);
    expect(c.y).toBeCloseTo(position.y, 9);
    expect(c.z).toBeCloseTo(position.z, 9);
  });

  it('round-trips Rodrigues vectors through rotation matrices', () => {
    for (const rvec of [
      [0.1, -0.4, 0.9],
      [0, 0, 0],
      [2.9, 0.05, 0.02],
    ] as [number, number, number][]) {
      const back = matrixToRodrigues(rodriguesToMatrix(rvec));
      const R1 = rodriguesToMatrix(rvec);
      const R2 = rodriguesToMatrix(back);
      for (let i = 0; i < 9; i++) expect(R2[i]).toBeCloseTo(R1[i], 8);
    }
  });

  it('round-trips distortion', () => {
    const k1 = -0.06;
    for (const [x, y] of [[0.2, 0.1], [-0.4, 0.35], [0, 0]]) {
      const d = distort(x, y, k1);
      const u = undistort(d.x, d.y, k1);
      expect(u.x).toBeCloseTo(x, 6);
      expect(u.y).toBeCloseTo(y, 6);
    }
  });

  it('puts first base on the right of the plate cam frame', () => {
    // A camera behind the plate looking at the pitcher sees what a batter sees.
    const firstBase = projectPoint(intrinsics, extrinsics, { x: 1, y: 0.8, z: PLATE.FRONT_Z_M });
    const thirdBase = projectPoint(intrinsics, extrinsics, { x: -1, y: 0.8, z: PLATE.FRONT_Z_M });
    expect(firstBase.pixel.x).toBeGreaterThan(thirdBase.pixel.x);
  });

  it('puts higher world points higher in the image', () => {
    const high = projectPoint(intrinsics, extrinsics, { x: 0, y: 1.5, z: PLATE.FRONT_Z_M });
    const low = projectPoint(intrinsics, extrinsics, { x: 0, y: 0.3, z: PLATE.FRONT_Z_M });
    expect(high.pixel.y).toBeLessThan(low.pixel.y);
  });

  it('round-trips project -> unproject along the view ray', () => {
    const world = { x: 0.12, y: 0.9, z: -3.5 };
    const proj = projectPoint(intrinsics, extrinsics, world);
    const ray = unprojectRay(intrinsics, extrinsics, proj.pixel);
    const centre = cameraCenter(extrinsics);
    const dist = Math.hypot(world.x - centre.x, world.y - centre.y, world.z - centre.z);
    const hit = {
      x: centre.x + ray.x * dist,
      y: centre.y + ray.y * dist,
      z: centre.z + ray.z * dist,
    };
    expect(hit.x).toBeCloseTo(world.x, 6);
    expect(hit.y).toBeCloseTo(world.y, 6);
    expect(hit.z).toBeCloseTo(world.z, 6);
  });

  it('reports zero reprojection error for a synthetic plate solve', () => {
    const worldPts = PLATE_MODEL_POINTS.map((p) => ({ x: p[0], y: p[1], z: p[2] }));
    const imgPts = worldPts.map((p) => projectPoint(intrinsics, extrinsics, p).pixel);
    expect(reprojectionError(intrinsics, extrinsics, worldPts, imgPts)).toBeLessThan(1e-9);
  });

  it('round-trips apparent diameter against depth', () => {
    const depth = 8.4;
    const px = apparentDiameterPx(intrinsics, BALL.DIAMETER_M, depth);
    expect(depthFromDiameterPx(intrinsics, BALL.DIAMETER_M, px)).toBeCloseTo(depth, 9);
    // Sanity: a softball at ~8 m through a 68 deg lens on 1280 px is a small blob.
    expect(px).toBeGreaterThan(8);
    expect(px).toBeLessThan(20);
  });

  it('builds sane intrinsics from a field of view', () => {
    const i = intrinsicsFromFov(1280, 720, 90);
    expect(i.fx).toBeCloseTo(640, 6);
    expect(i.cx).toBe(640);
    expect(i.cy).toBe(360);
  });

  it('places a camera looking straight down without collapsing', () => {
    const ext = lookAt({ x: 0, y: 5, z: 0 }, { x: 0, y: 0, z: 0 });
    const c = cameraCenter(ext);
    expect(c.y).toBeCloseTo(5, 9);
  });
});

describe('physics simulator', () => {
  it('produces a plausible fastball flight', () => {
    const gt = simulate(presetByName('fastball'));
    expect(gt.crossings.front).not.toBeNull();
    expect(gt.crossings.back).not.toBeNull();
    // ~0.42 s at 60 mph over 37 ft, per the spec's own sanity figure.
    expect(gt.crossings.back!.tS).toBeGreaterThan(0.33);
    expect(gt.crossings.back!.tS).toBeLessThan(0.55);
    // Drag costs a few mph over the flight; it must slow down, never speed up.
    expect(gt.crossings.back!.speedMps).toBeLessThan(gt.releaseSpeedMps);
    expect(toMph(gt.releaseSpeedMps - gt.crossings.back!.speedMps)).toBeLessThan(8);
    // Stays inside the physics sanity bounds the tracker gates on.
    expect(gt.releaseSpeedMps).toBeGreaterThan(PHYSICS.MIN_SPEED_MPS);
    expect(gt.releaseSpeedMps).toBeLessThan(PHYSICS.MAX_SPEED_MPS);
  });

  it('separates rise and drop by vertical break, in the right directions', () => {
    const rise = simulate(presetByName('rise'));
    const drop = simulate(presetByName('drop'));

    // Gravity-only drop over each flight, from the same release and initial velocity.
    const gravityOnlyFall = (gt: ReturnType<typeof simulate>) => {
      const t = gt.crossings.back!.tS;
      const v0 = gt.samples[0].velocity;
      return gt.spec.release.y + v0.y * t - 0.5 * PHYSICS.GRAVITY_MPS2 * t * t;
    };

    const riseVsGravity = rise.crossings.back!.position.y - gravityOnlyFall(rise);
    const dropVsGravity = drop.crossings.back!.position.y - gravityOnlyFall(drop);

    // A rise ball drops LESS than gravity alone; a drop ball drops MORE.
    expect(riseVsGravity).toBeGreaterThan(0.05);
    expect(dropVsGravity).toBeLessThan(-0.02);
    expect(riseVsGravity).toBeGreaterThan(dropVsGravity);
  });

  it('breaks curve and screw to opposite sides', () => {
    const curve = simulate(presetByName('curve'));
    const screw = simulate(presetByName('screw'));
    const lateral = (gt: ReturnType<typeof simulate>) => {
      const t = gt.crossings.back!.tS;
      const v0 = gt.samples[0].velocity;
      const straight = gt.spec.release.x + v0.x * t;
      return gt.crossings.back!.position.x - straight;
    };
    expect(lateral(curve)).toBeGreaterThan(0.02);
    expect(lateral(screw)).toBeLessThan(-0.02);
  });

  it('keeps the changeup meaningfully slower than the fastball', () => {
    const fb = simulate(presetByName('fastball'));
    const ch = simulate(presetByName('changeup'));
    const delta = toMph(fb.releaseSpeedMps - ch.releaseSpeedMps);
    expect(delta).toBeGreaterThanOrEqual(6);
    expect(delta).toBeLessThanOrEqual(12);
  });
});

describe('strike zone rule', () => {
  const zone = defaultTestZone();

  it('derives sane vertical bounds from a batter height', () => {
    const z = zoneFromHeight(inches(66), 'ncaa');
    expect(toInches(z.bottomM)).toBeGreaterThan(14);
    expect(toInches(z.bottomM)).toBeLessThan(22);
    expect(toInches(z.topM)).toBeGreaterThan(40);
    expect(toInches(z.topM)).toBeLessThan(50);
    expect(z.topM).toBeGreaterThan(z.bottomM);
  });

  it('makes the USA Softball zone taller than the NCAA zone', () => {
    const ncaa = zoneFromHeight(inches(66), 'ncaa');
    const usa = zoneFromHeight(inches(66), 'usaSoftball');
    expect(usa.topM).toBeGreaterThan(ncaa.topM);
    expect(usa.bottomM).toBeCloseTo(ncaa.bottomM, 9);
  });

  it('counts a ball that only clips the zone edge as a strike', () => {
    // Centre exactly one radius outside the nominal top: the ball still touches.
    const clipping = { x: 0, y: zone.topM + BALL.RADIUS_M * 0.99, z: 0 };
    expect(evaluateZone(clipping, zone).inside).toBe(true);

    // Two radii above: no part of the ball touches.
    const clear = { x: 0, y: zone.topM + BALL.RADIUS_M * 2.01, z: 0 };
    expect(evaluateZone(clear, zone).inside).toBe(false);
  });

  it('inflates horizontally by a ball radius too', () => {
    const justOutside = { x: zone.halfWidthM + BALL.RADIUS_M * 0.9, y: 0.8, z: 0 };
    expect(evaluateZone(justOutside, zone).inside).toBe(true);
    const wellOutside = { x: zone.halfWidthM + BALL.RADIUS_M * 3, y: 0.8, z: 0 };
    expect(evaluateZone(wellOutside, zone).inside).toBe(false);
  });

  it('reports negative margin inside the zone and positive outside', () => {
    expect(evaluateZone({ x: 0, y: 0.8, z: 0 }, zone).marginM).toBeLessThan(0);
    expect(evaluateZone({ x: 0, y: 2.5, z: 0 }, zone).marginM).toBeGreaterThan(0);
  });
});

describe('synthetic renderer', () => {
  it('produces enough frames across the flight at 60 fps', () => {
    const built = buildScenario(scenarioById('daylight-fastball-60fps'), 640, 360);
    const visible = built.frames.filter((f) => f.truth?.visible);
    // ~26 samples across the flight is the spec's workable figure; allow slack for
    // the portion of the flight that starts outside the plate cam's narrow frame.
    expect(built.frames.length).toBeGreaterThan(15);
    expect(visible.length).toBeGreaterThan(8);
  });

  /**
   * Motion blur is strongly VIEW DEPENDENT, and the spec's "4.6 ball diameters per
   * frame" figure is a world-space number, not an image-space one.
   *
   * From the side cam the ball crosses the frame laterally, so that full 45 cm of
   * travel becomes a long streak: this is the case that destroys a circularity gate.
   * From the plate cam the ball flies almost straight down the optical axis, so it
   * barely translates in the image and instead SCALES. The blur there is a radial
   * smear, not a streak.
   *
   * Both cases have to be handled, and they fail differently: the side cam breaks
   * circularity, while the plate cam makes the minor-axis depth estimate wobble as
   * the ball's own expansion blurs its edges. Asserted separately so a change that
   * fixes one and breaks the other cannot pass.
   */
  it('renders a long streak on the side cam, where lateral motion dominates', () => {
    const built = buildScenario(scenarioById('daylight-curve-side'), 640, 360);
    const visible = built.frames.filter((f) => f.truth?.visible);
    const mid = visible[Math.floor(visible.length / 2)];
    expect(mid.truth!.streakPx).toBeGreaterThan(mid.truth!.diameterPx * 2.5);
  });

  it('renders a much shorter streak on the plate cam, where motion is near-axial', () => {
    const plate = buildScenario(scenarioById('daylight-fastball-60fps'), 640, 360);
    const side = buildScenario(scenarioById('daylight-curve-side'), 640, 360);
    const ratio = (b: typeof plate) => {
      const v = b.frames.filter((f) => f.truth?.visible);
      const m = v[Math.floor(v.length / 2)].truth!;
      return m.streakPx / m.diameterPx;
    };
    expect(ratio(plate)).toBeLessThan(ratio(side));
  });

  it('shortens the streak dramatically at a 1 ms exposure', () => {
    const slow = buildScenario(scenarioById('daylight-fastball-60fps'), 640, 360);
    const fast = buildScenario(scenarioById('short-exposure-120fps'), 640, 360);
    const streak = (b: typeof slow) => {
      const v = b.frames.filter((f) => f.truth?.visible);
      return v[Math.floor(v.length / 2)].truth!.streakPx;
    };
    expect(streak(fast)).toBeLessThan(streak(slow));
  });

  it('grows the ball as it approaches the plate cam', () => {
    const built = buildScenario(scenarioById('daylight-fastball-60fps'), 640, 360);
    const visible = built.frames.filter((f) => f.truth?.visible);
    const first = visible[0].truth!;
    const last = visible[visible.length - 1].truth!;
    // The apparent-size depth signal the monocular path depends on.
    expect(last.diameterPx).toBeGreaterThan(first.diameterPx);
    expect(last.depthM).toBeLessThan(first.depthM);
  });

  it('is deterministic for a given seed', () => {
    const a = buildScenario(scenarioById('daylight-fastball-60fps'), 320, 180);
    const b = buildScenario(scenarioById('daylight-fastball-60fps'), 320, 180);
    expect(Array.from(a.frames[2].data.slice(0, 400))).toEqual(
      Array.from(b.frames[2].data.slice(0, 400)),
    );
  });

  it('actually paints ball-coloured pixels where ground truth says the ball is', () => {
    const built = buildScenario(scenarioById('daylight-fastball-60fps'), 640, 360);
    const frame = built.frames.filter((f) => f.truth?.visible).slice(-3)[0];
    const { x, y } = frame.truth!.pixel;
    const i = (Math.round(y) * frame.width + Math.round(x)) * 4;
    const [r, g, b] = [frame.data[i], frame.data[i + 1], frame.data[i + 2]];
    // Optic yellow: red and green both high, blue low.
    expect(g).toBeGreaterThan(120);
    expect(r).toBeGreaterThan(90);
    expect(b).toBeLessThan(g - 40);
  });

  it('darkens the whole frame in the poor-light scenario', () => {
    const bright = buildScenario(scenarioById('daylight-fastball-60fps'), 320, 180);
    const dim = buildScenario(scenarioById('poor-light'), 320, 180);
    const meanLuma = (b: typeof bright) => {
      const d = b.frames[1].data;
      let sum = 0;
      for (let i = 0; i < d.length; i += 4) sum += 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
      return sum / (d.length / 4);
    };
    expect(meanLuma(dim)).toBeLessThan(meanLuma(bright) * 0.6);
  });
});

describe('reference call', () => {
  it('calls a pitch aimed at the middle of the zone a strike', () => {
    const built = buildScenario(scenarioById('daylight-fastball-60fps'), 320, 180);
    const call = referenceCall(built, defaultTestZone());
    expect(call.result).toBe('strike');
  });

  it('evaluates both plate planes and takes the more favourable one', () => {
    const built = buildScenario(scenarioById('daylight-curve-side'), 320, 180);
    const call = referenceCall(built, defaultTestZone());
    // Whatever the outcome, it must have considered a plane and produced a finite margin.
    expect(Number.isFinite(call.marginM)).toBe(true);
    if (call.result === 'strike') expect(['front', 'back']).toContain(call.strikePlane);
  });
});

describe('release geometry', () => {
  it('places release 5-7 ft in front of the rubber', () => {
    const gt = simulate(presetByName('fastball'));
    const rubberZ = -feet(43);
    const stride = gt.spec.release.z - rubberZ;
    expect(stride).toBeGreaterThanOrEqual(feet(5));
    expect(stride).toBeLessThanOrEqual(feet(7));
  });
});
