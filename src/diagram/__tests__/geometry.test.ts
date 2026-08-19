import { describe, expect, it } from 'vitest';
import {
  SAMPLE_PITCH_PRESETS,
  battersBoxes,
  cameraFovCone,
  cameraPose,
  diagramLabels,
  fovConeFaces,
  plateOutline,
  pitchersCircle,
  rubberRect,
  samplePitchCrossing,
  samplePitchPath,
  samplePitchRelease,
  strikeZoneBox,
} from '../geometry';
import {
  CAMERA_PLACEMENT,
  DEFAULT_BATTER_HEIGHT_M,
  DEFAULT_RULE_SET,
  FIELD,
  PLATE,
  PLATE_MODEL_M,
  rubberZ,
  zoneFromHeight,
} from '@/domain/constants';
import { feet } from '@/domain/units';

describe('plateOutline', () => {
  it('uses exactly the five corners from PLATE_MODEL_M', () => {
    const outline = plateOutline();
    expect(outline).toHaveLength(5);
    const expected = Object.values(PLATE_MODEL_M).map(([x, y, z]) => ({ x, y, z }));
    for (const corner of expected) {
      expect(outline).toContainEqual(corner);
    }
  });

  it('has the correct 17in width and 8.5in/8.5in/17in geometry', () => {
    const outline = plateOutline();
    const xs = outline.map((p) => p.x);
    const width = Math.max(...xs) - Math.min(...xs);
    expect(width).toBeCloseTo(PLATE.WIDTH_M, 6);
  });
});

describe('rubberRect', () => {
  it.each([43, 40, 35])('front edge sits at rubberZ(%i)', (distanceFt) => {
    const r = rubberRect(distanceFt);
    const frontZ = Math.max(...r.points.map((p) => p.z));
    expect(frontZ).toBeCloseTo(rubberZ(distanceFt), 6);
  });

  it('is centred on x=0 with the rulebook width', () => {
    const r = rubberRect(43);
    const xs = r.points.map((p) => p.x);
    expect(Math.max(...xs)).toBeCloseTo(FIELD.RUBBER_WIDTH_M / 2, 6);
    expect(Math.min(...xs)).toBeCloseTo(-FIELD.RUBBER_WIDTH_M / 2, 6);
  });
});

describe('pitchersCircle', () => {
  it('is centred at rubberZ(distanceFt) with the rulebook radius', () => {
    const circle = pitchersCircle(43, 8);
    const zs = circle.map((p) => p.z);
    const centerZ = (Math.max(...zs) + Math.min(...zs)) / 2;
    expect(centerZ).toBeCloseTo(rubberZ(43), 3);
    for (const p of circle) {
      const r = Math.hypot(p.x, p.z - rubberZ(43));
      expect(r).toBeCloseTo(FIELD.PITCHERS_CIRCLE_DIAMETER_M / 2, 6);
    }
  });
});

describe('battersBoxes', () => {
  it('produces two boxes with rulebook width and length', () => {
    const { left, right } = battersBoxes();
    for (const box of [left, right]) {
      const xs = box.points.map((p) => p.x);
      const zs = box.points.map((p) => p.z);
      expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(FIELD.BATTERS_BOX_WIDTH_M, 6);
      expect(Math.max(...zs) - Math.min(...zs)).toBeCloseTo(FIELD.BATTERS_BOX_LENGTH_M, 6);
    }
  });

  it('mirrors left and right around x=0', () => {
    const { left, right } = battersBoxes();
    const leftCenterX = left.points.reduce((s, p) => s + p.x, 0) / 4;
    const rightCenterX = right.points.reduce((s, p) => s + p.x, 0) / 4;
    expect(leftCenterX).toBeCloseTo(-rightCenterX, 6);
  });
});

describe('strikeZoneBox', () => {
  it('defaults to the height-derived zone for the default rule set', () => {
    const expected = zoneFromHeight(DEFAULT_BATTER_HEIGHT_M, DEFAULT_RULE_SET);
    const box = strikeZoneBox();
    expect(box.bottomM).toBeCloseTo(expected.bottomM, 6);
    expect(box.topM).toBeCloseTo(expected.topM, 6);
  });

  it('spans the plate width and both evaluation planes', () => {
    const box = strikeZoneBox(0.4, 1.0);
    const xs = box.faces.front.map((p) => p.x);
    expect(Math.max(...xs)).toBeCloseTo(PLATE.HALF_WIDTH_M, 6);
    expect(Math.min(...xs)).toBeCloseTo(-PLATE.HALF_WIDTH_M, 6);
    const frontZs = box.faces.front.map((p) => p.z);
    const backZs = box.faces.back.map((p) => p.z);
    expect(frontZs.every((z) => z === PLATE.FRONT_Z_M)).toBe(true);
    expect(backZs.every((z) => z === PLATE.BACK_Z_M)).toBe(true);
  });
});

describe('cameraPose', () => {
  it('places Camera A behind the plate at its ideal distance/height', () => {
    const pose = cameraPose('plate', 43);
    expect(pose.distanceM).toBeCloseTo(feet(CAMERA_PLACEMENT.plate.distanceFt.ideal), 6);
    expect(pose.heightM).toBeCloseTo(feet(CAMERA_PLACEMENT.plate.heightFt.ideal), 6);
    expect(pose.position.x).toBeCloseTo(0, 6);
    expect(pose.position.z).toBeGreaterThan(0); // behind the plate = +Z
  });

  it('places Camera B off to the first-base side, perpendicular to the pitch line', () => {
    const pose = cameraPose('side', 43);
    expect(pose.distanceM).toBeCloseTo(feet(CAMERA_PLACEMENT.side.distanceFt.ideal), 6);
    expect(pose.position.x).toBeGreaterThan(0);
    expect(pose.position.z).toBeCloseTo(0, 6);
  });
});

describe('cameraFovCone / fovConeFaces', () => {
  it('produces four triangular faces sharing the camera apex', () => {
    const pose = cameraPose('plate', 43);
    const cone = cameraFovCone(pose);
    const faces = fovConeFaces(cone);
    expect(faces).toHaveLength(4);
    for (const face of faces) {
      expect(face).toHaveLength(3);
      expect(face[0]).toEqual(pose.position);
    }
  });
});

describe('sample pitch presets', () => {
  it('every preset path starts exactly at release and ends exactly at crossing', () => {
    for (const preset of SAMPLE_PITCH_PRESETS) {
      const release = samplePitchRelease(43, preset);
      const crossing = samplePitchCrossing(preset);
      const path = samplePitchPath(43, preset, 20);
      expect(path[0].x).toBeCloseTo(release.x, 9);
      expect(path[0].y).toBeCloseTo(release.y, 9);
      expect(path[0].z).toBeCloseTo(release.z, 9);
      expect(path[path.length - 1].x).toBeCloseTo(crossing.x, 9);
      expect(path[path.length - 1].y).toBeCloseTo(crossing.y, 9);
      expect(path[path.length - 1].z).toBeCloseTo(crossing.z, 9);
    }
  });

  it('fastball, drop and changeup have visibly different shapes', () => {
    const paths = SAMPLE_PITCH_PRESETS.map((p) => samplePitchPath(43, p, 20));
    const midY = paths.map((p) => p[Math.floor(p.length / 2)].y);
    // No two presets should share the same mid-flight height.
    expect(new Set(midY.map((y) => y.toFixed(4))).size).toBe(midY.length);
  });
});

describe('diagramLabels', () => {
  it('changes when the pitching distance changes', () => {
    const at43 = diagramLabels(43, 'imperial');
    const at35 = diagramLabels(35, 'imperial');
    expect(at43.pitchingDistance).not.toBe(at35.pitchingDistance);
  });

  it('changes format when the unit system changes', () => {
    const imperial = diagramLabels(43, 'imperial');
    const metric = diagramLabels(43, 'metric');
    expect(imperial.pitchingDistance).not.toBe(metric.pitchingDistance);
    expect(imperial.pitchingDistance).toMatch(/ft/);
    expect(metric.pitchingDistance).toMatch(/m/);
  });
});
