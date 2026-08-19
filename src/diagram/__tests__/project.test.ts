import { describe, expect, it } from 'vitest';
import {
  ORBIT_LIMITS,
  buildView,
  clampOrbit,
  cubicBezierEasing,
  depthSort,
  lerpOrbit,
  orbitEye,
  orbitStateForEye,
  projectWorld,
  stepOrbit,
  zoomFromPinch,
  type OrbitState,
} from '../project';
import { degToRad } from '@/domain/units';

const baseOrbit = (over: Partial<OrbitState> = {}): OrbitState => ({
  azimuthRad: 0,
  elevationRad: degToRad(45),
  distanceM: 10,
  zoom: 1,
  ...over,
});

describe('clampOrbit', () => {
  it('clamps elevation at the 15 degree floor', () => {
    const clamped = clampOrbit(baseOrbit({ elevationRad: degToRad(-40) }));
    expect(clamped.elevationRad).toBeCloseTo(ORBIT_LIMITS.minElevationRad, 10);
  });

  it('clamps elevation at the 90 degree ceiling', () => {
    const clamped = clampOrbit(baseOrbit({ elevationRad: degToRad(150) }));
    expect(clamped.elevationRad).toBeCloseTo(ORBIT_LIMITS.maxElevationRad, 10);
  });

  it('leaves an in-range elevation untouched', () => {
    const clamped = clampOrbit(baseOrbit({ elevationRad: degToRad(40) }));
    expect(clamped.elevationRad).toBeCloseTo(degToRad(40), 10);
  });

  it('clamps zoom within bounds', () => {
    expect(clampOrbit(baseOrbit({ zoom: 100 })).zoom).toBe(ORBIT_LIMITS.maxZoom);
    expect(clampOrbit(baseOrbit({ zoom: -5 })).zoom).toBe(ORBIT_LIMITS.minZoom);
  });

  it('wraps azimuth into [0, 2pi)', () => {
    const clamped = clampOrbit(baseOrbit({ azimuthRad: -degToRad(10) }));
    expect(clamped.azimuthRad).toBeCloseTo(degToRad(350), 5);
  });
});

describe('orbitEye / orbitStateForEye round trip', () => {
  it('recovers the same spherical state from a placed eye', () => {
    const pivot = { x: 0, y: 1, z: -5 };
    const state = clampOrbit(baseOrbit({ azimuthRad: degToRad(35), elevationRad: degToRad(50), distanceM: 12 }));
    const eye = orbitEye(pivot, state);
    const recovered = orbitStateForEye(pivot, eye, state.zoom);
    expect(recovered.azimuthRad).toBeCloseTo(state.azimuthRad, 6);
    expect(recovered.elevationRad).toBeCloseTo(state.elevationRad, 6);
    expect(recovered.distanceM).toBeCloseTo(state.distanceM, 6);
  });

  it('azimuth 0 sits on +Z and azimuth 90deg sits on +X, matching CAMERA_PLACEMENT convention', () => {
    const pivot = { x: 0, y: 0, z: 0 };
    const behind = orbitEye(pivot, baseOrbit({ azimuthRad: 0, elevationRad: 0, distanceM: 5 }));
    expect(behind.x).toBeCloseTo(0, 6);
    expect(behind.z).toBeCloseTo(5, 6);

    const side = orbitEye(pivot, baseOrbit({ azimuthRad: degToRad(90), elevationRad: 0, distanceM: 5 }));
    expect(side.x).toBeCloseTo(5, 6);
    expect(side.z).toBeCloseTo(0, 6);
  });

  it('elevation 90deg (top-down) sits directly above the pivot regardless of azimuth', () => {
    const pivot = { x: 0, y: 0, z: -3 };
    const top = orbitEye(pivot, baseOrbit({ azimuthRad: degToRad(200), elevationRad: degToRad(90), distanceM: 8 }));
    expect(top.x).toBeCloseTo(0, 6);
    expect(top.z).toBeCloseTo(-3, 6);
    expect(top.y).toBeCloseTo(8, 6);
  });
});

describe('lerpOrbit', () => {
  it('takes the shortest path across the 0/360 seam', () => {
    const a = baseOrbit({ azimuthRad: degToRad(350) });
    const b = baseOrbit({ azimuthRad: degToRad(10) });
    const mid = lerpOrbit(a, b, 0.5);
    // Shortest path from 350 to 10 passes through 0, not through 180.
    const deg = (mid.azimuthRad * 180) / Math.PI;
    const distanceFromZero = Math.min(deg, 360 - deg);
    expect(distanceFromZero).toBeLessThan(5);
  });

  it('interpolates elevation, distance and zoom linearly', () => {
    const a = baseOrbit({ elevationRad: degToRad(20), distanceM: 5, zoom: 1 });
    const b = baseOrbit({ elevationRad: degToRad(60), distanceM: 15, zoom: 2 });
    const mid = lerpOrbit(a, b, 0.5);
    expect(mid.elevationRad).toBeCloseTo(degToRad(40), 5);
    expect(mid.distanceM).toBeCloseTo(10, 5);
    expect(mid.zoom).toBeCloseTo(1.5, 5);
  });
});

describe('cubicBezierEasing', () => {
  it('starts at 0 and ends at 1', () => {
    const ease = cubicBezierEasing(0.2, 0, 0, 1);
    expect(ease(0)).toBeCloseTo(0, 6);
    expect(ease(1)).toBeCloseTo(1, 6);
  });

  it('is monotonically increasing for the app easing curve', () => {
    const ease = cubicBezierEasing(0.2, 0, 0, 1);
    let prev = -Infinity;
    for (let t = 0; t <= 1; t += 0.05) {
      const v = ease(t);
      expect(v).toBeGreaterThanOrEqual(prev);
      prev = v;
    }
  });

  it('approximates linear for a linear bezier', () => {
    const linear = cubicBezierEasing(0, 0, 1, 1);
    for (let t = 0; t <= 1; t += 0.1) {
      expect(linear(t)).toBeCloseTo(t, 2);
    }
  });
});

describe('stepOrbit', () => {
  it('rotateLeft/rotateRight move azimuth in opposite directions', () => {
    const start = baseOrbit();
    const left = stepOrbit(start, 'rotateLeft');
    const right = stepOrbit(start, 'rotateRight');
    expect(left.azimuthRad).not.toBeCloseTo(start.azimuthRad, 6);
    expect(right.azimuthRad).not.toBeCloseTo(start.azimuthRad, 6);
    expect(left.azimuthRad).not.toBeCloseTo(right.azimuthRad, 6);
  });

  it('rotateUp/rotateDown respect the elevation clamp at the boundary', () => {
    const atFloor = baseOrbit({ elevationRad: ORBIT_LIMITS.minElevationRad });
    expect(stepOrbit(atFloor, 'rotateDown').elevationRad).toBeCloseTo(ORBIT_LIMITS.minElevationRad, 10);
    const atCeiling = baseOrbit({ elevationRad: ORBIT_LIMITS.maxElevationRad });
    expect(stepOrbit(atCeiling, 'rotateUp').elevationRad).toBeCloseTo(ORBIT_LIMITS.maxElevationRad, 10);
  });

  it('zoomIn/zoomOut move zoom oppositely and respect clamps', () => {
    const start = baseOrbit({ zoom: 1 });
    expect(stepOrbit(start, 'zoomIn').zoom).toBeGreaterThan(start.zoom);
    expect(stepOrbit(start, 'zoomOut').zoom).toBeLessThan(start.zoom);
  });
});

describe('zoomFromPinch', () => {
  it('scales zoom multiplicatively and clamps', () => {
    const start = baseOrbit({ zoom: 1 });
    expect(zoomFromPinch(start, 1.5).zoom).toBeCloseTo(1.5, 6);
    expect(zoomFromPinch(start, 1000).zoom).toBe(ORBIT_LIMITS.maxZoom);
  });
});

describe('buildView / projectWorld', () => {
  it('projects a known world point to the expected screen position from a top-down view', () => {
    const pivot = { x: 0, y: 0, z: 0 };
    const orbit = baseOrbit({ azimuthRad: 0, elevationRad: degToRad(90), distanceM: 10, zoom: 1 });
    const view = buildView({ pivot, orbit, viewportW: 800, viewportH: 600 });
    // Eye is directly above the origin, looking straight down.
    const center = projectWorld(view, { x: 0, y: 0, z: 0 });
    expect(center.x).toBeCloseTo(400, 1);
    expect(center.y).toBeCloseTo(300, 1);
    expect(center.depthM).toBeCloseTo(10, 6);

    // A point offset along world +X should land off-centre on screen.
    const offset = projectWorld(view, { x: 1, y: 0, z: 0 });
    expect(offset.x).not.toBeCloseTo(400, 1);
  });

  it('increasing zoom magnifies the projected offset of an off-centre point', () => {
    const pivot = { x: 0, y: 0, z: 0 };
    const nearView = buildView({
      pivot,
      orbit: baseOrbit({ elevationRad: degToRad(90), distanceM: 10, zoom: 1 }),
      viewportW: 800,
      viewportH: 600,
    });
    const zoomedView = buildView({
      pivot,
      orbit: baseOrbit({ elevationRad: degToRad(90), distanceM: 10, zoom: 2 }),
      viewportW: 800,
      viewportH: 600,
    });
    const p = { x: 1, y: 0, z: 0 };
    const a = projectWorld(nearView, p);
    const b = projectWorld(zoomedView, p);
    expect(Math.abs(b.x - 400)).toBeGreaterThan(Math.abs(a.x - 400));
  });
});

describe('depthSort', () => {
  it('orders items farthest-to-nearest', () => {
    const items = [{ id: 'near', depthM: 2 }, { id: 'far', depthM: 20 }, { id: 'mid', depthM: 8 }];
    const sorted = depthSort(items);
    expect(sorted.map((i) => i.id)).toEqual(['far', 'mid', 'near']);
  });

  it('does not mutate the input array', () => {
    const items = [{ id: 'a', depthM: 1 }, { id: 'b', depthM: 2 }];
    const copy = [...items];
    depthSort(items);
    expect(items).toEqual(copy);
  });
});
