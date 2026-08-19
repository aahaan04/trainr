import { useEffect, useRef, useState } from 'react';
import type { CameraRole } from '@/domain/types';
import { toInches } from '@/domain/units';
import { requestCameraStream, stopStream } from '@/capture/getUserMedia';
import { assessPoseCredibility, isCalibrationAcceptable, PNP_MAX_REPROJECTION_ERROR_PX } from '@/calibration/solvePnP';
import { StepFooter } from '../WizardShell';
import type { WizardState } from '../types';

interface TestPitchStepProps {
  state: WizardState;
  plateDeviceId: string | undefined;
  onBack: () => void;
  onStart: () => void;
}

interface Blocker {
  label: string;
}

function computeBlockers(state: WizardState): Blocker[] {
  const blockers: Blocker[] = [];
  const roles: CameraRole[] = state.cameraMode === 'dual' ? ['plate', 'side'] : ['plate'];

  for (const role of roles) {
    const calib = state.calibrationByRole[role];
    if (!calib) {
      blockers.push({ label: `${role === 'plate' ? 'Plate' : 'Side'} camera is not calibrated.` });
      continue;
    }
    if (!isCalibrationAcceptable(calib)) {
      blockers.push({
        label: `${role === 'plate' ? 'Plate' : 'Side'} camera reprojection error (${calib.reprojectionErrorPx.toFixed(1)}px) exceeds ${PNP_MAX_REPROJECTION_ERROR_PX}px. Redo the corner tap.`,
      });
    }
    const credibility = assessPoseCredibility(role, calib.positionWorld);
    if (!credibility.ok) blockers.push(...credibility.reasons.map((r) => ({ label: r })));
  }

  if (!state.hsvGate) blockers.push({ label: 'Ball colour has not been sampled.' });
  if (!state.zone) blockers.push({ label: 'Strike zone has not been set.' });

  return blockers;
}

export function TestPitchStep({ state, plateDeviceId, onBack, onStart }: TestPitchStepProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!plateDeviceId) return;
    let cancelled = false;
    let stream: MediaStream | null = null;
    requestCameraStream(plateDeviceId)
      .then((r) => {
        if (cancelled) {
          stopStream(r.stream);
          return;
        }
        stream = r.stream;
        if (videoRef.current) videoRef.current.srcObject = stream;
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
    return () => {
      cancelled = true;
      stopStream(stream);
    };
  }, [plateDeviceId]);

  const blockers = computeBlockers(state);
  const roles: CameraRole[] = state.cameraMode === 'dual' ? ['plate', 'side'] : ['plate'];

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-title text-ink">Confirm and start</h2>
        <p className="text-body text-ink-secondary">
          Have your pitcher throw a practice pitch through the zone once live tracking starts, to confirm detection
          looks right before it counts for real.
        </p>
      </div>

      {error && <p className="text-body text-coral-700">{error}</p>}
      <video ref={videoRef} autoPlay playsInline muted className="aspect-video w-full rounded-input bg-indigo-900 object-cover" />

      <div className="space-y-3 rounded-card border border-border bg-surface-2 p-4 text-body">
        <p className="text-title text-ink">Calibration summary</p>
        {roles.map((role) => {
          const c = state.calibrationByRole[role];
          const uncertainty = state.poseUncertaintyM[role];
          return (
            <div key={role} className="flex flex-wrap justify-between gap-x-4 gap-y-1 border-b border-border pb-2 last:border-0">
              <span className="text-ink-secondary">{role === 'plate' ? 'Plate cam' : 'Side cam'}</span>
              {c ? (
                <span className="text-ink">
                  {c.reprojectionErrorPx.toFixed(2)}px reprojection
                  {uncertainty !== undefined && <> · ±{uncertainty.toFixed(2)}m uncertainty</>}
                </span>
              ) : (
                <span className="text-coral-700">Not calibrated</span>
              )}
            </div>
          );
        })}
        <div className="flex justify-between">
          <span className="text-ink-secondary">Ball colour</span>
          <span className="text-ink">{state.hsvGate ? 'Sampled' : 'Not sampled'}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-ink-secondary">Strike zone</span>
          <span className="text-ink">
            {state.zone
              ? `${toInches(state.zone.bottomM).toFixed(1)}"–${toInches(state.zone.topM).toFixed(1)}" (${state.zone.source})`
              : 'Not set'}
          </span>
        </div>
      </div>

      {blockers.length > 0 && (
        <div className="rounded-card border border-coral-700 bg-coral-100 p-4 text-body text-coral-700">
          <p className="font-semibold">Fix these before starting a session:</p>
          <ul className="list-disc space-y-1 pl-5">
            {blockers.map((b, i) => (
              <li key={i}>{b.label}</li>
            ))}
          </ul>
        </div>
      )}

      <StepFooter
        onBack={onBack}
        onNext={onStart}
        nextLabel="Start session"
        nextDisabled={blockers.length > 0}
        nextDisabledReason={blockers.length > 0 ? 'Calibration is not good enough yet.' : undefined}
      />
    </div>
  );
}
