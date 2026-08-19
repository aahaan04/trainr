/**
 * Section 10: the interactive setup diagram, a first-class full-screen sheet /
 * desktop modal — scale-accurate geometry, drag/keyboard/pinch orbit, camera
 * detail cards, a two-camera comparison, and a sample-pitch player. Everything
 * here reads from the app store and domain constants; nothing writes global
 * settings, so the diagram's own unit toggle is local-only.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CameraRole } from '@/domain/constants';
import { DEFAULT_PITCHING_DISTANCE_FT } from '@/domain/constants';
import { formatDistance, mph, type UnitSystem } from '@/domain/units';
import { motion } from '@/design/tokens';
import { useAppStore } from '@/store/appStore';
import {
  ORBIT_EASING,
  ORBIT_LIMITS,
  type OrbitAction,
  type OrbitState,
  clampOrbit,
  lerpOrbit,
  orbitStateForEye,
  stepOrbit,
} from './project';
import { DiagramCanvas, scenePivot } from './DiagramCanvas';
import { DiagramControls, type SnapTarget } from './DiagramControls';
import { CameraCard } from './CameraCard';
import { Legend } from './Legend';
import { SamplePitchPlayer } from './SamplePitchPlayer';
import {
  SAMPLE_PITCH_PRESETS,
  cameraPose,
  diagramLabels,
  samplePitchCrossing,
  samplePitchPath,
  samplePitchRelease,
  type SamplePitchId,
} from './geometry';
import { vec3 } from './project';

function defaultViewDistanceM(distanceFt: number): number {
  return Math.max(14, distanceFt * 0.3048 * 1.15);
}

function initialOrbit(distanceFt: number): OrbitState {
  return clampOrbit({
    azimuthRad: (35 * Math.PI) / 180,
    elevationRad: (32 * Math.PI) / 180,
    distanceM: defaultViewDistanceM(distanceFt),
    zoom: 1,
  });
}

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReduced(mq.matches);
    const listener = () => setReduced(mq.matches);
    mq.addEventListener?.('change', listener);
    return () => mq.removeEventListener?.('change', listener);
  }, []);
  return reduced;
}

export interface SetupDiagramProps {
  open: boolean;
  onClose: () => void;
  onOpenHowThisWorks?: () => void;
}

export function SetupDiagram({ open, onClose, onOpenHowThisWorks }: SetupDiagramProps) {
  const settings = useAppStore((s) => s.settings);
  const distanceFt = settings.pitchingDistanceFt || DEFAULT_PITCHING_DISTANCE_FT;

  const [units, setUnits] = useState<UnitSystem>(settings.units);
  const [cameraMode, setCameraMode] = useState<'single' | 'dual'>('single');
  const [selectedCamera, setSelectedCamera] = useState<CameraRole | null>(null);
  const [orbit, setOrbit] = useState<OrbitState>(() => initialOrbit(distanceFt));

  const [presetId, setPresetId] = useState<SamplePitchId>('fastball');
  const [playing, setPlaying] = useState(false);
  const [finished, setFinished] = useState(false);
  const [progress, setProgress] = useState(1);
  const [slowMotion, setSlowMotion] = useState(false);

  const reducedMotion = usePrefersReducedMotion();

  const animRef = useRef<{ from: OrbitState; to: OrbitState; startedAt: number } | null>(null);
  const rafRef = useRef<number | null>(null);
  const playRef = useRef<{ startedAt: number; durationMs: number } | null>(null);

  const preset = SAMPLE_PITCH_PRESETS.find((p) => p.id === presetId) ?? SAMPLE_PITCH_PRESETS[0];
  const pitchPath = useMemo(() => samplePitchPath(distanceFt, preset, 60), [distanceFt, preset]);
  const labels = useMemo(() => diagramLabels(distanceFt, units), [distanceFt, units]);

  const cancelOrbitAnimation = useCallback(() => {
    animRef.current = null;
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
  }, []);

  const runOrbitAnimation = useCallback(() => {
    const tick = (now: number) => {
      const anim = animRef.current;
      if (!anim) return;
      const t = Math.min(1, (now - anim.startedAt) / motion.orbit);
      const eased = reducedMotion ? 1 : ORBIT_EASING(t);
      setOrbit(lerpOrbit(anim.from, anim.to, eased));
      if (t >= 1) {
        animRef.current = null;
        rafRef.current = null;
        return;
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
  }, [reducedMotion]);

  const animateTo = useCallback(
    (target: OrbitState) => {
      cancelOrbitAnimation();
      if (reducedMotion) {
        setOrbit(target);
        return;
      }
      animRef.current = { from: orbit, to: target, startedAt: performance.now() };
      runOrbitAnimation();
    },
    [orbit, reducedMotion, cancelOrbitAnimation, runOrbitAnimation],
  );

  const handleSnap = useCallback(
    (snap: SnapTarget) => {
      const pivot = scenePivot(distanceFt);
      if (snap === 'top') {
        animateTo(clampOrbit({ ...orbit, elevationRad: ORBIT_LIMITS.maxElevationRad }));
      } else if (snap === '3d') {
        animateTo(initialOrbit(distanceFt));
      } else {
        const camPos = cameraPose('plate', distanceFt).position;
        animateTo(orbitStateForEye(pivot, camPos, orbit.zoom));
      }
    },
    [orbit, distanceFt, animateTo],
  );

  const handleStep = useCallback(
    (action: OrbitAction) => {
      cancelOrbitAnimation();
      setOrbit((prev) => stepOrbit(prev, action));
    },
    [cancelOrbitAnimation],
  );

  const handleOrbitChange = useCallback(
    (next: OrbitState) => {
      cancelOrbitAnimation();
      setOrbit(next);
    },
    [cancelOrbitAnimation],
  );

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;
    const isFormField = ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
    if (e.key === 'Escape') {
      onClose();
      return;
    }
    if (isFormField) return;
    const keyMap: Record<string, OrbitAction> = {
      ArrowLeft: 'rotateLeft',
      ArrowRight: 'rotateRight',
      ArrowUp: 'rotateUp',
      ArrowDown: 'rotateDown',
      '+': 'zoomIn',
      '=': 'zoomIn',
      '-': 'zoomOut',
      _: 'zoomOut',
    };
    const action = keyMap[e.key];
    if (action) {
      e.preventDefault();
      handleStep(action);
    }
  };

  const playPitch = useCallback(() => {
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    setFinished(false);
    setPlaying(true);
    setProgress(0);

    const release = samplePitchRelease(distanceFt, preset);
    const crossing = samplePitchCrossing(preset);
    const lengthM = vec3.length(vec3.sub(crossing, release));
    const speedMps = mph(preset.speedMph);
    const durationMs = Math.max(300, (lengthM / speedMps) * 1000 * (slowMotion ? 4 : 1));
    playRef.current = { startedAt: performance.now(), durationMs };

    const tick = (now: number) => {
      const state = playRef.current;
      if (!state) return;
      const t = Math.min(1, (now - state.startedAt) / state.durationMs);
      setProgress(t);
      if (t >= 1) {
        setPlaying(false);
        setFinished(true);
        playRef.current = null;
        rafRef.current = null;
        return;
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
  }, [distanceFt, preset, slowMotion]);

  useEffect(() => {
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  useEffect(() => {
    if (!open) {
      cancelOrbitAnimation();
      setPlaying(false);
      setFinished(false);
      setProgress(1);
    }
  }, [open, cancelOrbitAnimation]);

  if (!open) return null;

  const summary = `Scale diagram of a ${labels.pitchingDistance} pitching setup, ${
    cameraMode === 'dual' ? 'two cameras' : 'one camera'
  }. Camera A sits ${labels.plateCamDistance} behind home plate at ${labels.plateCamHeight} of height${
    cameraMode === 'dual' ? `, Camera B sits ${labels.sideCamDistance} to the side at ${labels.sideCamHeight}` : ''
  }.`;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Setup diagram"
      onKeyDown={handleKeyDown}
      className="fixed inset-0 z-50 flex flex-col overflow-hidden bg-surface-0 sm:inset-10 sm:rounded-sheet sm:shadow-raised"
    >
      <p className="sr-only">{summary}</p>

      <header className="flex items-center justify-between border-b border-border px-5 py-4">
        <h2 className="font-display text-display-md text-ink">Setup diagram</h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close setup diagram"
          className="flex min-h-tap min-w-tap items-center justify-center rounded-full text-title text-ink-secondary hover:bg-surface-2"
        >
          ✕
        </button>
      </header>

      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto sm:flex-row">
        <div className="min-h-[45vh] flex-1 sm:min-h-0">
          <DiagramCanvas
            orbit={orbit}
            onOrbitChange={handleOrbitChange}
            distanceFt={distanceFt}
            cameraMode={cameraMode}
            selectedCamera={selectedCamera}
            onSelectCamera={setSelectedCamera}
            pitchPath={pitchPath}
            pitchProgress={progress}
            showRibbon={playing || finished}
          />
        </div>

        <aside className="flex w-full flex-col gap-6 overflow-y-auto border-t border-border p-5 sm:w-80 sm:border-l sm:border-t-0">
          <DiagramControls
            onSnap={handleSnap}
            onStep={handleStep}
            cameraMode={cameraMode}
            onCameraModeChange={setCameraMode}
            units={units}
            onUnitsChange={setUnits}
          />

          <div className="space-y-3 rounded-card bg-surface-2 p-3">
            <p className="text-label text-ink-secondary">Distances</p>
            <dl className="space-y-1 text-body">
              <div className="flex justify-between">
                <dt className="text-ink-secondary">Pitching distance</dt>
                <dd className="num text-ink">{labels.pitchingDistance}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-ink-secondary">Camera A distance</dt>
                <dd className="num text-ink">{labels.plateCamDistance}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-ink-secondary">Camera A height</dt>
                <dd className="num text-ink">{labels.plateCamHeight}</dd>
              </div>
              {cameraMode === 'dual' && (
                <>
                  <div className="flex justify-between">
                    <dt className="text-ink-secondary">Camera B distance</dt>
                    <dd className="num text-ink">{labels.sideCamDistance}</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-ink-secondary">Camera B height</dt>
                    <dd className="num text-ink">{labels.sideCamHeight}</dd>
                  </div>
                </>
              )}
            </dl>
          </div>

          <SamplePitchPlayer
            presetId={presetId}
            onPresetChange={setPresetId}
            playing={playing}
            onPlay={playPitch}
            finished={finished}
            slowMotion={slowMotion}
            onSlowMotionChange={setSlowMotion}
          />

          <div className="space-y-3">
            <p className="text-label text-ink-secondary">Cameras</p>
            <CameraCard
              role="plate"
              distanceFt={distanceFt}
              units={units}
              expanded={selectedCamera === 'plate'}
              onToggle={() => setSelectedCamera((c) => (c === 'plate' ? null : 'plate'))}
              samplePath={pitchPath}
            />
            {cameraMode === 'dual' && (
              <CameraCard
                role="side"
                distanceFt={distanceFt}
                units={units}
                expanded={selectedCamera === 'side'}
                onToggle={() => setSelectedCamera((c) => (c === 'side' ? null : 'side'))}
                samplePath={pitchPath}
              />
            )}
          </div>

          <Legend cameraMode={cameraMode} onOpenHowThisWorks={onOpenHowThisWorks} />

          <p className="text-caption text-ink-tertiary">
            {formatDistance(0, units)} shown at {distanceFt} ft pitching distance. Distances update live from session settings.
          </p>
        </aside>
      </div>
    </div>
  );
}
