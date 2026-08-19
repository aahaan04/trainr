import { useEffect, useMemo, useRef, useState } from 'react';
import { CAMERA_PLACEMENT, PLATE_CORNER_LABELS, PLATE_CORNER_ORDER, PLATE_MODEL_M } from '@/domain/constants';
import type { CameraCalibration, CameraRole, PlateCornerName, Vec2 } from '@/domain/types';
import { requestCameraStream, stopStream } from '@/capture/getUserMedia';
import { intrinsicsFromFov, projectPoint } from '@/vision/camera';
import {
  assessPoseCredibility,
  buildCameraCalibration,
  estimatePoseUncertainty,
  isCalibrationAcceptable,
  PNP_MAX_REPROJECTION_ERROR_PX,
  solvePlatePnP,
  type PoseCredibility,
} from '@/calibration/solvePnP';
import { Magnifier } from '../Magnifier';
import { StepFooter } from '../WizardShell';
import { naturalFromClient, screenFromNatural } from '../videoGeometry';

// Physical outline order for drawing the plate boundary (distinct from
// PLATE_CORNER_ORDER, which is the order the user TAPS in).
const OUTLINE_ORDER: PlateCornerName[] = ['thirdBaseFront', 'firstBaseFront', 'firstBaseSide', 'backPoint', 'thirdBaseSide'];

interface PlateCornerTapStepProps {
  roles: CameraRole[];
  deviceByRole: Partial<Record<CameraRole, string>>;
  existing: Partial<Record<CameraRole, CameraCalibration>>;
  onRoleCalibrated: (role: CameraRole, calibration: CameraCalibration, uncertaintyM: number) => void;
  onAllDone: () => void;
  onBack: () => void;
}

export function PlateCornerTapStep({ roles, deviceByRole, existing, onRoleCalibrated, onAllDone, onBack }: PlateCornerTapStepProps) {
  const [roleIndex, setRoleIndex] = useState(0);
  const role = roles[roleIndex];

  return (
    <SingleCameraTap
      key={role}
      role={role}
      deviceId={deviceByRole[role]}
      existing={existing[role]}
      roleNumber={roleIndex + 1}
      roleCount={roles.length}
      onBack={roleIndex === 0 ? onBack : () => setRoleIndex((i) => i - 1)}
      onAccepted={(calibration, uncertaintyM) => {
        onRoleCalibrated(role, calibration, uncertaintyM);
        if (roleIndex < roles.length - 1) setRoleIndex((i) => i + 1);
        else onAllDone();
      }}
    />
  );
}

interface SingleCameraTapProps {
  role: CameraRole;
  deviceId: string | undefined;
  existing: CameraCalibration | undefined;
  roleNumber: number;
  roleCount: number;
  onBack: () => void;
  onAccepted: (calibration: CameraCalibration, uncertaintyM: number) => void;
}

function SingleCameraTap({ role, deviceId, existing, roleNumber, roleCount, onBack, onAccepted }: SingleCameraTapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [streamError, setStreamError] = useState<string | null>(null);
  const [videoSize, setVideoSize] = useState({ width: 0, height: 0 });
  const [fovDeg, setFovDeg] = useState(role === 'plate' ? 60 : 55);
  const [taps, setTaps] = useState<Vec2[]>([]);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dragScreenPos, setDragScreenPos] = useState<{ left: number; top: number } | null>(null);

  useEffect(() => {
    if (!deviceId) return;
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
  }, [deviceId]);

  useEffect(() => {
    setTaps(existing ? PLATE_CORNER_ORDER.map((k) => existing.tappedCorners[k]) : []);
  }, [existing]);

  const solve = useMemo(() => {
    if (taps.length < 5) return null;
    const points = Object.fromEntries(PLATE_CORNER_ORDER.map((k, i) => [k, taps[i]])) as Record<PlateCornerName, Vec2>;
    try {
      const seed = intrinsicsFromFov(videoSize.width || 1280, videoSize.height || 720, fovDeg, 0);
      const result = solvePlatePnP(points, seed);
      const calibration = buildCameraCalibration(role, result, points);
      const credibility: PoseCredibility = assessPoseCredibility(role, calibration.positionWorld);
      const uncertainty = estimatePoseUncertainty(points, seed, 2, 20);
      return { calibration, credibility, uncertainty, error: null as string | null };
    } catch (err) {
      return { calibration: null, credibility: null, uncertainty: null, error: err instanceof Error ? err.message : String(err) };
    }
  }, [taps, videoSize, fovDeg, role]);

  const reprojected = useMemo(() => {
    if (!solve?.calibration) return null;
    const out: Partial<Record<PlateCornerName, Vec2>> = {};
    for (const name of PLATE_CORNER_ORDER) {
      const [x, y, z] = PLATE_MODEL_M[name];
      out[name] = projectPoint(solve.calibration.intrinsics, solve.calibration.extrinsics, { x, y, z }).pixel;
    }
    return out as Record<PlateCornerName, Vec2>;
  }, [solve]);

  function toScreenPixel(p: Vec2): Vec2 | null {
    const video = videoRef.current;
    const container = containerRef.current;
    if (!video || !container) return null;
    return screenFromNatural(video, container, p);
  }

  function handleVideoClick(e: React.MouseEvent) {
    if (taps.length >= 5) return;
    const video = videoRef.current;
    if (!video) return;
    const p = naturalFromClient(video, e.clientX, e.clientY);
    if (!p) return;
    if (!videoSize.width) setVideoSize({ width: video.videoWidth, height: video.videoHeight });
    setTaps((prev) => [...prev, p]);
  }

  function handleDragStart(i: number, e: React.PointerEvent) {
    e.stopPropagation();
    setDragIndex(i);
  }
  function handlePointerMove(e: React.PointerEvent) {
    if (dragIndex === null) return;
    const video = videoRef.current;
    if (!video) return;
    const p = naturalFromClient(video, e.clientX, e.clientY);
    if (!p) return;
    setTaps((prev) => prev.map((t, i) => (i === dragIndex ? p : t)));
    const container = containerRef.current?.getBoundingClientRect();
    if (container) setDragScreenPos({ left: e.clientX - container.left, top: e.clientY - container.top });
  }
  function handlePointerUp() {
    setDragIndex(null);
    setDragScreenPos(null);
  }

  const nextCornerName: PlateCornerName | null = taps.length < 5 ? PLATE_CORNER_ORDER[taps.length] : null;

  const accepted = solve?.calibration && solve.credibility?.ok && isCalibrationAcceptable(solve.calibration);
  const spec = CAMERA_PLACEMENT[role];

  return (
    <div className="space-y-5">
      <div>
        <p className="text-label text-ink-secondary">
          Camera {roleNumber} of {roleCount} — {spec.label}
        </p>
        <h2 className="text-title text-ink">Tap the five corners of home plate</h2>
        <p className="text-body text-ink-secondary">
          {nextCornerName ? `Next: ${PLATE_CORNER_LABELS[nextCornerName]}` : 'All five corners placed. Drag any point to adjust.'}
        </p>
      </div>

      <label className="flex items-center gap-3 text-body">
        <span className="text-ink-secondary">Approximate horizontal field of view</span>
        <input
          type="number"
          min={30}
          max={140}
          value={fovDeg}
          onChange={(e) => setFovDeg(Number(e.target.value))}
          className="min-h-tap w-24 rounded-input border border-border bg-surface-1 px-2 text-ink"
        />
        <span className="text-ink-secondary">degrees</span>
      </label>

      {streamError && <p className="text-body text-coral-700">{streamError}</p>}

      <div
        ref={containerRef}
        className="relative w-full select-none overflow-hidden rounded-input bg-indigo-900"
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
      >
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          onClick={handleVideoClick}
          onLoadedMetadata={() => setVideoSize({ width: videoRef.current!.videoWidth, height: videoRef.current!.videoHeight })}
          className="block w-full cursor-crosshair"
        />
        <svg className="pointer-events-none absolute inset-0 h-full w-full">
          {reprojected &&
            OUTLINE_ORDER.map((name, i) => {
              const a = toScreenPixel(reprojected[name]);
              const b = toScreenPixel(reprojected[OUTLINE_ORDER[(i + 1) % OUTLINE_ORDER.length]]);
              if (!a || !b) return null;
              return (
                <line
                  key={name}
                  x1={a.x}
                  y1={a.y}
                  x2={b.x}
                  y2={b.y}
                  stroke={accepted ? '#12C46B' : '#FFB020'}
                  strokeWidth={2}
                />
              );
            })}
          {taps.map((t, i) => {
            const p = toScreenPixel(t);
            if (!p) return null;
            return (
              <g key={i}>
                <circle cx={p.x} cy={p.y} r={7} fill="none" stroke="#D8E600" strokeWidth={2} />
                <circle
                  cx={p.x}
                  cy={p.y}
                  r={14}
                  fill="transparent"
                  className="pointer-events-auto cursor-grab"
                  onPointerDown={(e) => handleDragStart(i, e)}
                />
              </g>
            );
          })}
        </svg>
        <Magnifier
          source={videoRef.current}
          sourcePoint={dragIndex !== null ? taps[dragIndex] : null}
          screenPosition={dragScreenPos}
        />
      </div>

      {taps.length === 5 && (
        <div className="space-y-2 rounded-card border border-border bg-surface-2 p-4">
          {solve?.error && <p className="text-body text-coral-700">{solve.error}</p>}
          {solve?.calibration && (
            <>
              <div className="flex flex-wrap gap-4 text-body">
                <span className="text-ink">
                  Reprojection error:{' '}
                  <strong className={solve.calibration.reprojectionErrorPx <= PNP_MAX_REPROJECTION_ERROR_PX ? 'text-green-700' : 'text-coral-700'}>
                    {solve.calibration.reprojectionErrorPx.toFixed(2)} px
                  </strong>
                </span>
                {solve.uncertainty && (
                  <span className="text-ink">
                    Position uncertainty:{' '}
                    <strong className={solve.uncertainty.positionSpreadM < 0.3 ? 'text-green-700' : 'text-amber-600'}>
                      ±{solve.uncertainty.positionSpreadM.toFixed(2)} m
                    </strong>
                  </span>
                )}
              </div>
              {solve.uncertainty && solve.uncertainty.positionSpreadM >= 0.3 && (
                <p className="text-caption text-amber-600">
                  This is normal for a plate cam viewed at a grazing angle — a couple of pixels of tap error can
                  move the solved position by a lot even though the reprojected outline still lines up. Re-tap each
                  corner slowly using the magnifier for the best result. (An ArUco marker sheet on the plate would
                  remove this ambiguity entirely, but is not built in this app — this magnifier-and-recheck flow is
                  the mitigation.)
                </p>
              )}
              {solve.credibility && !solve.credibility.ok && (
                <ul className="list-disc space-y-1 pl-5 text-body text-coral-700">
                  {solve.credibility.reasons.map((r) => (
                    <li key={r}>{r}</li>
                  ))}
                </ul>
              )}
            </>
          )}
          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={() => setTaps([])}
              className="min-h-tap rounded-input border border-border-strong px-4 text-body text-ink-secondary hover:bg-surface-1"
            >
              Redo corners
            </button>
            <button
              type="button"
              disabled={!accepted}
              onClick={() => solve?.calibration && solve.uncertainty && onAccepted(solve.calibration, solve.uncertainty.positionSpreadM)}
              className="min-h-tap rounded-input bg-indigo-600 px-6 text-body font-semibold text-white disabled:cursor-not-allowed disabled:bg-surface-2 disabled:text-ink-tertiary"
            >
              Accept this calibration
            </button>
          </div>
        </div>
      )}

      <StepFooter onBack={onBack} />
    </div>
  );
}
