import { useEffect, useRef, useState, type RefObject } from 'react';
import type { Batter, CameraCalibration, Handedness, RuleSetId, StrikeZone, Vec3 } from '@/domain/types';
import { PLATE, RULE_SETS } from '@/domain/constants';
import { feet, inches, toFeet, toInches } from '@/domain/units';
import { db, newId } from '@/storage/db';
import { requestCameraStream, stopStream } from '@/capture/getUserMedia';
import { cameraCenter, intersectPlaneZ, projectPoint, unprojectRay } from '@/vision/camera';
import { PoseZoneEstimator, zoneFromPoseLandmarks } from '@/calibration/poseZone';
import { defaultBullpenZone, heightZone, manualZone } from '@/calibration/strikeZone';
import { StepFooter } from '../WizardShell';
import { naturalFromClient, screenFromNatural } from '../videoGeometry';

type Mode = 'auto' | 'manual' | 'height' | 'none';

/** Batter stands roughly astride the plate's back point; used as the projection depth for both pose and manual drag. */
const BATTER_Z = -0.15;

interface ZoneSetupStepProps {
  deviceId: string | undefined;
  calibration: CameraCalibration | undefined;
  ruleSet: RuleSetId;
  zone: StrikeZone | null;
  onChange: (zone: StrikeZone | null) => void;
  onBack: () => void;
  onNext: () => void;
}

export function ZoneSetupStep({ deviceId, calibration, ruleSet, zone, onChange, onBack, onNext }: ZoneSetupStepProps) {
  const [mode, setMode] = useState<Mode>('auto');
  const [handedness, setHandedness] = useState<Handedness>('right');
  const [batters, setBatters] = useState<Batter[]>([]);
  const [selectedBatterId, setSelectedBatterId] = useState<string>('');
  const [heightFeet, setHeightFeet] = useState(5);
  const [heightInches, setHeightInches] = useState(6);
  const [saveName, setSaveName] = useState('');
  const [saveProfile, setSaveProfile] = useState(false);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [streamError, setStreamError] = useState<string | null>(null);

  useEffect(() => {
    void db.batters.toArray().then((rows) => setBatters(rows.sort((a, b) => a.name.localeCompare(b.name))));
  }, []);

  useEffect(() => {
    if (!deviceId || (mode !== 'auto' && mode !== 'manual')) return;
    let cancelled = false;
    let stream: MediaStream | null = null;
    requestCameraStream(deviceId)
      .then((r) => {
        if (cancelled) {
          stopStream(r.stream);
          return;
        }
        stream = r.stream;
        if (videoRef.current) videoRef.current.srcObject = stream;
      })
      .catch((err: unknown) => setStreamError(err instanceof Error ? err.message : String(err)));
    return () => {
      cancelled = true;
      stopStream(stream);
    };
  }, [deviceId, mode]);

  const heightM = feet(heightFeet) + inches(heightInches);

  async function saveIfRequested(z: StrikeZone) {
    if (!saveProfile || !saveName.trim()) return z;
    const batter: Batter = {
      id: newId(),
      name: saveName.trim(),
      heightM,
      handedness,
      savedZone: { bottomM: z.bottomM, topM: z.topM },
      createdAt: Date.now(),
    };
    await db.batters.put(batter);
    setBatters((prev) => [...prev, batter].sort((a, b) => a.name.localeCompare(b.name)));
    return { ...z, batterId: batter.id };
  }

  function applyHeightMode() {
    const z = heightZone(heightM, { ruleSet, frozenAtMs: Date.now(), batterId: selectedBatterId || undefined });
    void saveIfRequested(z).then(onChange);
  }

  function applyNoBatter() {
    onChange(defaultBullpenZone({ ruleSet, frozenAtMs: Date.now() }));
  }

  function selectBatter(id: string) {
    setSelectedBatterId(id);
    const b = batters.find((x) => x.id === id);
    if (!b) return;
    setHandedness(b.handedness);
    setHeightFeet(Math.floor(toFeet(b.heightM)));
    setHeightInches(Math.round(toInches(b.heightM) % 12));
    if (b.savedZone) {
      onChange(manualZone(b.savedZone.bottomM, b.savedZone.topM, { ruleSet, frozenAtMs: Date.now(), batterId: b.id }));
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-title text-ink">Strike zone</h2>
        <p className="text-body text-ink-secondary">
          Auto-detects from the batter's pose each pitch, frozen at release so a crouch mid-pitch can't shrink it. Or
          set it manually, from an entered height, or skip the batter entirely for solo bullpen work.
        </p>
      </div>

      {batters.length > 0 && (
        <label className="block text-body">
          <span className="mb-1 block text-label text-ink-secondary">Saved batter</span>
          <select
            value={selectedBatterId}
            onChange={(e) => selectBatter(e.target.value)}
            className="min-h-tap w-full rounded-input border border-border bg-surface-1 px-3 text-ink"
          >
            <option value="">New / unsaved batter</option>
            {batters.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </label>
      )}

      <div className="flex flex-wrap gap-2">
        {(['auto', 'manual', 'height', 'none'] as Mode[]).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => setMode(m)}
            className={`min-h-tap rounded-pill border px-4 text-body ${
              mode === m ? 'border-indigo-600 bg-indigo-100 text-indigo-700' : 'border-border text-ink-secondary'
            }`}
          >
            {{ auto: 'Auto (pose)', manual: 'Manual drag', height: 'Enter height', none: 'No batter' }[m]}
          </button>
        ))}
      </div>

      {mode !== 'none' && (
        <label className="flex items-center gap-3 text-body">
          <span className="text-ink-secondary">Batter handedness</span>
          <select
            value={handedness}
            onChange={(e) => setHandedness(e.target.value as Handedness)}
            className="min-h-tap rounded-input border border-border bg-surface-1 px-3 text-ink"
          >
            <option value="right">Right-handed</option>
            <option value="left">Left-handed</option>
          </select>
        </label>
      )}

      {streamError && <p className="text-body text-coral-700">{streamError}</p>}

      {mode === 'auto' &&
        (calibration ? (
          <AutoZone
            deviceId={deviceId}
            videoRef={videoRef}
            containerRef={containerRef}
            calibration={calibration}
            ruleSet={ruleSet}
            handedness={handedness}
            zone={zone}
            onChange={(z) => void (z ? saveIfRequested(z).then(onChange) : onChange(null))}
          />
        ) : (
          <p className="text-body text-coral-700">Calibrate the plate camera before using pose-based zone detection.</p>
        ))}

      {mode === 'manual' &&
        (calibration ? (
          <ManualZone
            videoRef={videoRef}
            containerRef={containerRef}
            calibration={calibration}
            ruleSet={ruleSet}
            zone={zone}
            onChange={(z) => void saveIfRequested(z).then(onChange)}
          />
        ) : (
          <p className="text-body text-coral-700">Calibrate the plate camera before setting the zone manually.</p>
        ))}

      {mode === 'height' && (
        <div className="space-y-3 rounded-card border border-border bg-surface-2 p-4">
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-2 text-body">
              <span className="text-ink-secondary">Height</span>
              <input
                type="number"
                value={heightFeet}
                onChange={(e) => setHeightFeet(Number(e.target.value))}
                className="min-h-tap w-16 rounded-input border border-border bg-surface-1 px-2 text-ink"
              />
              <span className="text-ink-secondary">ft</span>
            </label>
            <input
              type="number"
              value={heightInches}
              onChange={(e) => setHeightInches(Number(e.target.value))}
              className="min-h-tap w-16 rounded-input border border-border bg-surface-1 px-2 text-ink"
            />
            <span className="text-ink-secondary">in</span>
          </div>
          <p className="text-caption text-ink-tertiary">
            Estimated from anthropometric ratios, not observed pose — shown as approximate everywhere it's used.
          </p>
          <button
            type="button"
            onClick={applyHeightMode}
            className="min-h-tap rounded-input bg-indigo-600 px-5 text-body font-semibold text-white hover:bg-indigo-700"
          >
            Use this height
          </button>
        </div>
      )}

      {mode === 'none' && (
        <div className="space-y-3 rounded-card border border-border bg-surface-2 p-4">
          <p className="text-body text-ink-secondary">
            Uses a default zone from an average batter height, clearly marked as approximate. For solo bullpen
            command work where strike/ball calls matter less than pitch shape and velocity.
          </p>
          <button
            type="button"
            onClick={applyNoBatter}
            className="min-h-tap rounded-input bg-indigo-600 px-5 text-body font-semibold text-white hover:bg-indigo-700"
          >
            Use bullpen default zone
          </button>
        </div>
      )}

      {mode !== 'none' && (
        <label className="flex items-center gap-2 text-body">
          <input type="checkbox" checked={saveProfile} onChange={(e) => setSaveProfile(e.target.checked)} className="h-5 w-5" />
          <span className="text-ink-secondary">Save as a batter profile named</span>
          <input
            value={saveName}
            onChange={(e) => setSaveName(e.target.value)}
            placeholder="Batter name"
            className="min-h-tap flex-1 rounded-input border border-border bg-surface-1 px-3 text-ink"
          />
        </label>
      )}

      {zone && (
        <div className="rounded-card border border-green-700 bg-green-100 p-4 text-body text-green-700">
          Zone set: {toInches(zone.bottomM).toFixed(1)}"–{toInches(zone.topM).toFixed(1)}" from the ground ({ruleLabel(ruleSet)}
          {zone.approximate ? ', approximate' : ''}).
        </div>
      )}

      <StepFooter
        onBack={onBack}
        onNext={onNext}
        nextDisabled={!zone}
        nextDisabledReason={!zone ? 'Set a strike zone before continuing.' : undefined}
      />
    </div>
  );
}

function ruleLabel(id: RuleSetId): string {
  return RULE_SETS.find((r) => r.id === id)?.label ?? id;
}

// ---------------------------------------------------------------------------
// Auto (pose) sub-view
// ---------------------------------------------------------------------------

interface AutoZoneProps {
  deviceId: string | undefined;
  videoRef: RefObject<HTMLVideoElement>;
  containerRef: RefObject<HTMLDivElement>;
  calibration: CameraCalibration;
  ruleSet: RuleSetId;
  handedness: Handedness;
  zone: StrikeZone | null;
  onChange: (zone: StrikeZone | null) => void;
}

function AutoZone({ videoRef, containerRef, calibration, ruleSet, handedness, zone, onChange }: AutoZoneProps) {
  const estimatorRef = useRef<PoseZoneEstimator | null>(null);
  const rafRef = useRef<number | null>(null);
  const [live, setLive] = useState<StrikeZone | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'no-pose' | 'error'>('loading');

  useEffect(() => {
    let cancelled = false;
    const estimator = new PoseZoneEstimator();
    estimatorRef.current = estimator;
    estimator
      .init()
      .then(() => {
        if (cancelled) return;
        setStatus('ready');
        tick();
      })
      .catch(() => setStatus('error'));

    function tick() {
      const video = videoRef.current;
      if (!cancelled && video && video.readyState >= 2 && estimator.ready) {
        const det = estimator.detectForVideo(video, performance.now());
        if (det.landmarks) {
          const z = zoneFromPoseLandmarks({
            landmarks: det.landmarks,
            videoWidth: video.videoWidth,
            videoHeight: video.videoHeight,
            calibration,
            ruleSet,
            handedness,
            batterZ: BATTER_Z,
            frozenAtMs: Date.now(),
          });
          setLive(z);
          setStatus(z ? 'ready' : 'no-pose');
        } else {
          setLive(null);
          setStatus('no-pose');
        }
      }
      // A UI preview poll, not the capture pipeline — rAF is fine here (Section 11's
      // "never rAF for capture" is about frame acquisition for tracking, not this).
      rafRef.current = requestAnimationFrame(tick);
    }

    return () => {
      cancelled = true;
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      estimator.dispose();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [calibration, ruleSet, handedness]);

  return (
    <div className="space-y-3">
      <div ref={containerRef} className="relative w-full overflow-hidden rounded-input bg-indigo-900">
        <video ref={videoRef} autoPlay playsInline muted className="block w-full" />
        <ZoneOverlay videoRef={videoRef} containerRef={containerRef} calibration={calibration} zone={live ?? zone} color="#D8E600" />
      </div>
      {status === 'loading' && <p className="text-body text-ink-secondary">Loading the pose model…</p>}
      {status === 'error' && (
        <p className="text-body text-coral-700">
          Could not load the on-device pose model. Use manual or height-based zone setup instead.
        </p>
      )}
      {status === 'no-pose' && <p className="text-body text-amber-600">No batter detected in frame — step into the box.</p>}
      <p className="text-caption text-ink-tertiary">
        This preview is not frozen — it updates live so you can check the fit. During a real session the zone freezes
        at each pitch's release point automatically.
      </p>
      <button
        type="button"
        disabled={!live}
        onClick={() => onChange(live)}
        className="min-h-tap rounded-input bg-indigo-600 px-5 text-body font-semibold text-white disabled:cursor-not-allowed disabled:bg-surface-2 disabled:text-ink-tertiary"
      >
        Use this zone
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Manual drag sub-view
// ---------------------------------------------------------------------------

interface ManualZoneProps {
  videoRef: RefObject<HTMLVideoElement>;
  containerRef: RefObject<HTMLDivElement>;
  calibration: CameraCalibration;
  ruleSet: RuleSetId;
  zone: StrikeZone | null;
  onChange: (zone: StrikeZone) => void;
}

function ManualZone({ videoRef, containerRef, calibration, ruleSet, zone, onChange }: ManualZoneProps) {
  const [bottomM, setBottomM] = useState(zone?.bottomM ?? inches(18));
  const [topM, setTopM] = useState(zone?.topM ?? inches(42));
  const [dragging, setDragging] = useState<'top' | 'bottom' | null>(null);

  function heightFromPointer(clientX: number, clientY: number): number | null {
    const video = videoRef.current;
    if (!video) return null;
    const pixel = naturalFromClient(video, clientX, clientY);
    if (!pixel) return null;
    const origin = cameraCenter(calibration.extrinsics);
    const dir = unprojectRay(calibration.intrinsics, calibration.extrinsics, pixel);
    const hit = intersectPlaneZ(origin, dir, PLATE.FRONT_Z_M);
    return hit ? hit.y : null;
  }

  function handlePointerMove(e: React.PointerEvent) {
    if (!dragging) return;
    const h = heightFromPointer(e.clientX, e.clientY);
    if (h === null) return;
    if (dragging === 'top') setTopM(Math.max(h, bottomM + 0.02));
    else setBottomM(Math.min(h, topM - 0.02));
  }

  const current = manualZone(bottomM, topM, { ruleSet, frozenAtMs: Date.now() });

  return (
    <div className="space-y-3">
      <div
        ref={containerRef}
        className="relative w-full select-none overflow-hidden rounded-input bg-indigo-900"
        onPointerMove={handlePointerMove}
        onPointerUp={() => setDragging(null)}
      >
        <video ref={videoRef} autoPlay playsInline muted className="block w-full" />
        <ZoneOverlay videoRef={videoRef} containerRef={containerRef} calibration={calibration} zone={current} color="#3D45B8" />
        <DragHandle videoRef={videoRef} containerRef={containerRef} calibration={calibration} heightM={topM} label="Top" onDown={() => setDragging('top')} />
        <DragHandle videoRef={videoRef} containerRef={containerRef} calibration={calibration} heightM={bottomM} label="Bottom" onDown={() => setDragging('bottom')} />
      </div>
      <div className="flex items-center gap-6 text-body text-ink-secondary">
        <span>Bottom: {toInches(bottomM).toFixed(1)}"</span>
        <span>Top: {toInches(topM).toFixed(1)}"</span>
      </div>
      <button
        type="button"
        onClick={() => onChange(current)}
        className="min-h-tap rounded-input bg-indigo-600 px-5 text-body font-semibold text-white hover:bg-indigo-700"
      >
        Use this zone
      </button>
    </div>
  );
}

function DragHandle({
  videoRef,
  containerRef,
  calibration,
  heightM,
  label,
  onDown,
}: {
  videoRef: RefObject<HTMLVideoElement>;
  containerRef: RefObject<HTMLDivElement>;
  calibration: CameraCalibration;
  heightM: number;
  label: string;
  onDown: () => void;
}) {
  const video = videoRef.current;
  const container = containerRef.current;
  if (!video || !container) return null;
  const world: Vec3 = { x: 0, y: heightM, z: PLATE.FRONT_Z_M };
  const proj = projectPoint(calibration.intrinsics, calibration.extrinsics, world);
  const pos = screenFromNatural(video, container, proj.pixel);
  if (!pos) return null;
  return (
    <div
      onPointerDown={(e) => {
        e.stopPropagation();
        onDown();
      }}
      className="absolute flex min-h-tap min-w-tap -translate-x-1/2 -translate-y-1/2 cursor-ns-resize items-center justify-center rounded-pill bg-indigo-600 px-3 text-caption font-semibold text-white shadow-raised"
      style={{ left: pos.x, top: pos.y }}
    >
      {label}
    </div>
  );
}

function ZoneOverlay({
  videoRef,
  containerRef,
  calibration,
  zone,
  color,
}: {
  videoRef: RefObject<HTMLVideoElement>;
  containerRef: RefObject<HTMLDivElement>;
  calibration: CameraCalibration;
  zone: StrikeZone | null;
  color: string;
}) {
  const video = videoRef.current;
  const container = containerRef.current;
  if (!zone || !video || !container) return null;

  const hw = zone.halfWidthM;
  const faces: [number, number][] = [
    [PLATE.FRONT_Z_M, zone.bottomM],
    [PLATE.FRONT_Z_M, zone.topM],
    [PLATE.BACK_Z_M, zone.bottomM],
    [PLATE.BACK_Z_M, zone.topM],
  ];
  const project = (x: number, z: number, y: number) => {
    const proj = projectPoint(calibration.intrinsics, calibration.extrinsics, { x, y, z });
    return screenFromNatural(video, container, proj.pixel);
  };

  const frontBottomL = project(-hw, faces[0][0], faces[0][1]);
  const frontBottomR = project(hw, faces[0][0], faces[0][1]);
  const frontTopL = project(-hw, faces[1][0], faces[1][1]);
  const frontTopR = project(hw, faces[1][0], faces[1][1]);
  const backBottomL = project(-hw, faces[2][0], faces[2][1]);
  const backBottomR = project(hw, faces[2][0], faces[2][1]);
  const backTopL = project(-hw, faces[3][0], faces[3][1]);
  const backTopR = project(hw, faces[3][0], faces[3][1]);

  const pts = [frontBottomL, frontBottomR, frontTopL, frontTopR, backBottomL, backBottomR, backTopL, backTopR];
  if (pts.some((p) => !p)) return null;

  const edge = (a: Vec2Like, b: Vec2Like) => <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={color} strokeWidth={2} />;

  return (
    <svg className="pointer-events-none absolute inset-0 h-full w-full">
      {edge(frontBottomL!, frontBottomR!)}
      {edge(frontTopL!, frontTopR!)}
      {edge(frontBottomL!, frontTopL!)}
      {edge(frontBottomR!, frontTopR!)}
      {edge(backBottomL!, backBottomR!)}
      {edge(backTopL!, backTopR!)}
      {edge(backBottomL!, backTopL!)}
      {edge(backBottomR!, backTopR!)}
      {edge(frontBottomL!, backBottomL!)}
      {edge(frontBottomR!, backBottomR!)}
      {edge(frontTopL!, backTopL!)}
      {edge(frontTopR!, backTopR!)}
    </svg>
  );
}

type Vec2Like = { x: number; y: number };
