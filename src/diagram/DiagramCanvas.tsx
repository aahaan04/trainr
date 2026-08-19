/**
 * The SVG scene: field geometry, cameras, strike zone and the pitch ribbon,
 * projected through project.ts's orbit camera and painted back-to-front with
 * depthSort. Also owns the pointer/wheel input that turns drag, pinch and scroll
 * into orbit changes — the keyboard path lives one level up in SetupDiagram so
 * arrow keys work regardless of which element inside the sheet has focus.
 */

import { useMemo, useRef } from 'react';
import type { Vec3 } from '@/domain/types';
import type { CameraRole } from '@/domain/constants';
import { feet } from '@/domain/units';
import { color } from '@/design/tokens';
import {
  type DiagramView,
  type OrbitState,
  buildView,
  depthSort,
  orbitFromDrag,
  polygonDepth,
  projectWorld,
  zoomFromPinch,
} from './project';
import {
  battersBoxes,
  cameraFovCone,
  cameraPose,
  fovConeFaces,
  foulLines,
  plateOutline,
  pitchersCircle,
  rubberRect,
  strikeZoneBox,
} from './geometry';
import { TrajectoryRibbon } from './TrajectoryRibbon';

export const VIEW_W = 900;
export const VIEW_H = 600;

export function scenePivot(distanceFt: number): Vec3 {
  return { x: 0, y: feet(2), z: -feet(distanceFt) / 2 };
}

interface DiagramCanvasProps {
  orbit: OrbitState;
  onOrbitChange: (next: OrbitState) => void;
  distanceFt: number;
  cameraMode: 'single' | 'dual';
  selectedCamera: CameraRole | null;
  onSelectCamera: (role: CameraRole) => void;
  pitchPath: readonly Vec3[];
  pitchProgress: number;
  showRibbon: boolean;
  zoneBottomM?: number;
  zoneTopM?: number;
}

function projectPolygon(view: DiagramView, points: readonly Vec3[]): { x: number; y: number }[] | null {
  const out: { x: number; y: number }[] = [];
  for (const p of points) {
    const s = projectWorld(view, p);
    if (!Number.isFinite(s.x) || !Number.isFinite(s.y) || s.depthM <= 0.05) return null;
    out.push({ x: s.x, y: s.y });
  }
  return out;
}

function polyPath(points: { x: number; y: number }[]): string {
  return `M ${points.map((p) => `${p.x} ${p.y}`).join(' L ')} Z`;
}

interface SceneItem {
  key: string;
  depthM: number;
  node: React.ReactNode;
}

export function DiagramCanvas({
  orbit,
  onOrbitChange,
  distanceFt,
  cameraMode,
  selectedCamera,
  onSelectCamera,
  pitchPath,
  pitchProgress,
  showRibbon,
  zoneBottomM,
  zoneTopM,
}: DiagramCanvasProps) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinchStartDist = useRef<number | null>(null);

  const view = useMemo(
    () => buildView({ pivot: scenePivot(distanceFt), orbit, viewportW: VIEW_W, viewportH: VIEW_H }),
    [distanceFt, orbit],
  );

  const clientToViewScale = (): number => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return 1;
    return VIEW_W / rect.width;
  };

  const handlePointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    (e.target as Element).setPointerCapture?.(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      pinchStartDist.current = Math.hypot(a.x - b.x, a.y - b.y);
    }
  };

  const handlePointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!pointers.current.has(e.pointerId)) return;
    const prev = pointers.current.get(e.pointerId)!;
    const scale = clientToViewScale();

    if (pointers.current.size === 2) {
      pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      const [a, b] = [...pointers.current.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      if (pinchStartDist.current && pinchStartDist.current > 1) {
        onOrbitChange(zoomFromPinch(orbit, dist / pinchStartDist.current));
      }
      pinchStartDist.current = dist;
      return;
    }

    const dx = (e.clientX - prev.x) * scale;
    const dy = (e.clientY - prev.y) * scale;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    onOrbitChange(orbitFromDrag(orbit, dx, dy, VIEW_W, VIEW_H));
  };

  const endPointer = (e: React.PointerEvent<SVGSVGElement>) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) pinchStartDist.current = null;
  };

  const handleWheel = (e: React.WheelEvent<SVGSVGElement>) => {
    e.preventDefault();
    const scaleDelta = Math.exp(-e.deltaY * 0.0015);
    onOrbitChange(zoomFromPinch(orbit, scaleDelta));
  };

  const items: SceneItem[] = [];

  // Grass, low-saturation surface-2 fill per the style guide.
  const grassPts: Vec3[] = [
    { x: -11, y: 0, z: 5 },
    { x: 11, y: 0, z: 5 },
    { x: 11, y: 0, z: -feet(distanceFt) - 6 },
    { x: -11, y: 0, z: -feet(distanceFt) - 6 },
  ];
  const grassScreen = projectPolygon(view, grassPts);
  if (grassScreen) {
    items.push({
      key: 'grass',
      depthM: polygonDepth(view, grassPts),
      node: <path d={polyPath(grassScreen)} fill={color.surface2} opacity={0.6} />,
    });
  }

  const dirtPts = pitchersCircle(distanceFt, 32);
  const dirtScreen = projectPolygon(view, dirtPts);
  if (dirtScreen) {
    items.push({
      key: 'dirt-circle',
      depthM: polygonDepth(view, dirtPts),
      node: <path d={polyPath(dirtScreen)} fill={color.surface2} stroke={color.border} strokeWidth={1} />,
    });
  }

  const { first, third } = foulLines(distanceFt);
  for (const [id, line] of [['first', first] as const, ['third', third] as const]) {
    const a = projectWorld(view, line[0]);
    const b = projectWorld(view, line[1]);
    if (a.depthM > 0.05 && b.depthM > 0.05) {
      items.push({
        key: `foul-${id}`,
        depthM: (a.depthM + b.depthM) / 2,
        node: <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={color.surface1} strokeWidth={2} strokeOpacity={0.8} />,
      });
    }
  }

  const { left, right } = battersBoxes();
  for (const [id, box] of [['left', left] as const, ['right', right] as const]) {
    const s = projectPolygon(view, box.points);
    if (s) {
      items.push({
        key: `box-${id}`,
        depthM: polygonDepth(view, box.points),
        node: <path d={polyPath(s)} fill="none" stroke={color.surface1} strokeWidth={2} strokeOpacity={0.9} />,
      });
    }
  }

  const plate = plateOutline();
  const plateScreen = projectPolygon(view, plate);
  if (plateScreen) {
    items.push({
      key: 'plate',
      depthM: polygonDepth(view, plate),
      node: <path d={polyPath(plateScreen)} fill={color.surface1} stroke={color.indigo900} strokeWidth={1.5} />,
    });
  }

  const rubber = rubberRect(distanceFt);
  const rubberScreen = projectPolygon(view, rubber.points);
  if (rubberScreen) {
    items.push({
      key: 'rubber',
      depthM: polygonDepth(view, rubber.points),
      node: <path d={polyPath(rubberScreen)} fill={color.surface1} stroke={color.indigo900} strokeWidth={1} />,
    });
  }

  const zone = strikeZoneBox(zoneBottomM, zoneTopM);
  for (const [id, face] of Object.entries(zone.faces)) {
    const s = projectPolygon(view, face);
    if (s) {
      items.push({
        key: `zone-${id}`,
        depthM: polygonDepth(view, face),
        node: (
          <path d={polyPath(s)} fill={color.indigo500} fillOpacity={0.14} stroke={color.indigo600} strokeOpacity={0.55} strokeWidth={1} />
        ),
      });
    }
  }

  const roles: CameraRole[] = cameraMode === 'dual' ? ['plate', 'side'] : ['plate'];
  for (const role of roles) {
    const pose = cameraPose(role, distanceFt);
    const cone = cameraFovCone(pose);
    for (const [i, face] of fovConeFaces(cone).entries()) {
      const s = projectPolygon(view, face);
      if (s) {
        items.push({
          key: `cone-${role}-${i}`,
          depthM: polygonDepth(view, face),
          node: <path d={polyPath(s)} fill={color.indigo500} fillOpacity={0.1} stroke="none" />,
        });
      }
    }

    const posScreen = projectWorld(view, pose.position);
    if (posScreen.depthM > 0.05) {
      const isSelected = selectedCamera === role;
      items.push({
        key: `camera-${role}`,
        depthM: posScreen.depthM,
        node: (
          <g
            role="button"
            tabIndex={0}
            aria-label={`${role === 'plate' ? 'Camera A, plate cam' : 'Camera B, side cam'} — view placement details`}
            aria-pressed={isSelected}
            onClick={() => onSelectCamera(role)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onSelectCamera(role);
              }
            }}
            style={{ cursor: 'pointer', outline: 'none' }}
            transform={`translate(${posScreen.x}, ${posScreen.y})`}
          >
            <circle r={16} fill={isSelected ? color.indigo500 : color.indigo700} stroke={color.surface1} strokeWidth={2} />
            <rect x={-7} y={-5} width={14} height={10} rx={2} fill={color.surface1} />
            <circle r={3.5} fill={color.indigo700} />
            <line x1={0} y1={16} x2={-9} y2={30} stroke={color.indigo700} strokeWidth={2} />
            <line x1={0} y1={16} x2={9} y2={30} stroke={color.indigo700} strokeWidth={2} />
            <line x1={0} y1={16} x2={0} y2={32} stroke={color.indigo700} strokeWidth={2} />
            <text y={-22} textAnchor="middle" fontSize={11} fontFamily="var(--font-ui)" fill={color.textPrimary} fontWeight={600}>
              {role === 'plate' ? 'A' : 'B'}
            </text>
          </g>
        ),
      });
    }
  }

  if (showRibbon && pitchPath.length > 1) {
    const screenPts = pitchPath.map((p) => {
      const s = projectWorld(view, p);
      return { x: s.x, y: s.y };
    });
    items.push({
      key: 'ribbon',
      depthM: polygonDepth(view, pitchPath),
      node: <TrajectoryRibbon points={screenPts} progress={pitchProgress} minWidthPx={2} maxWidthPx={16} />,
    });
  }

  const sorted = depthSort(items);

  return (
    <svg
      ref={svgRef}
      viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
      className="h-full w-full touch-none select-none bg-surface-0"
      role="img"
      aria-label="Scale diagram of the pitching setup: home plate, pitcher's circle, camera placements, the strike zone and a sample pitch path. Drag, use the on-screen controls, or arrow keys to rotate; plus and minus to zoom."
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={endPointer}
      onPointerCancel={endPointer}
      onPointerLeave={endPointer}
      onWheel={handleWheel}
    >
      {sorted.map((item) => (
        <g key={item.key}>{item.node}</g>
      ))}
    </svg>
  );
}
