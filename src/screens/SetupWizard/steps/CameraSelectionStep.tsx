import { useEffect, useRef, useState } from 'react';
import { PITCHING_DISTANCE_PRESETS, RULE_SETS } from '@/domain/constants';
import type { CameraRole, RuleSetId } from '@/domain/types';
import {
  isGetUserMediaSupported,
  isSecureContextForCamera,
  listCameraDevices,
  requestCameraStream,
  stopStream,
  type CameraDevice,
} from '@/capture/getUserMedia';
import { StepFooter } from '../WizardShell';
import type { WizardState } from '../types';

interface CameraSelectionStepProps {
  state: WizardState;
  ruleSet: RuleSetId;
  onRuleSetChange: (r: RuleSetId) => void;
  onChange: (patch: Partial<WizardState>) => void;
  onNext: () => void;
}

function DevicePreview({ deviceId }: { deviceId: string | undefined }) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!deviceId) return;
    let cancelled = false;
    let stream: MediaStream | null = null;
    setError(null);
    requestCameraStream(deviceId)
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
  }, [deviceId]);

  if (!deviceId) return null;
  if (error) return <p className="text-caption text-coral-700">{error}</p>;
  return (
    <video
      ref={videoRef}
      autoPlay
      playsInline
      muted
      className="aspect-video w-full rounded-input bg-indigo-900 object-cover"
    />
  );
}

export function CameraSelectionStep({ state, ruleSet, onRuleSetChange, onChange, onNext }: CameraSelectionStepProps) {
  const [devices, setDevices] = useState<CameraDevice[]>([]);
  const [permissionError, setPermissionError] = useState<string | null>(null);
  const supported = isGetUserMediaSupported();
  const secure = isSecureContextForCamera();

  useEffect(() => {
    if (!supported || !secure) return;
    void listCameraDevices().then(setDevices);
  }, [supported, secure]);

  async function grantAndEnumerate() {
    setPermissionError(null);
    try {
      const r = await requestCameraStream();
      stopStream(r.stream);
      setDevices(await listCameraDevices());
    } catch (err) {
      setPermissionError(err instanceof Error ? err.message : String(err));
    }
  }

  const setRole = (role: CameraRole, deviceId: string) => {
    onChange({ deviceByRole: { ...state.deviceByRole, [role]: deviceId } });
  };

  const canProceed = !!state.deviceByRole.plate && (state.cameraMode === 'single' || !!state.deviceByRole.side);

  return (
    <div className="space-y-8">
      <section className="space-y-4">
        <h2 className="text-title text-ink">Session basics</h2>
        <div className="grid gap-4 sm:grid-cols-3">
          <label className="block text-body">
            <span className="mb-1 block text-label text-ink-secondary">Setup name</span>
            <input
              value={state.setupName}
              onChange={(e) => onChange({ setupName: e.target.value })}
              placeholder="Home cage"
              className="min-h-tap w-full rounded-input border border-border bg-surface-1 px-3 text-body text-ink"
            />
          </label>
          <label className="block text-body">
            <span className="mb-1 block text-label text-ink-secondary">Pitching distance</span>
            <select
              value={state.pitchingDistanceFt}
              onChange={(e) => onChange({ pitchingDistanceFt: Number(e.target.value) })}
              className="min-h-tap w-full rounded-input border border-border bg-surface-1 px-3 text-body text-ink"
            >
              {PITCHING_DISTANCE_PRESETS.map((p) => (
                <option key={p.id} value={p.feet}>
                  {p.label} — {p.feet} ft
                </option>
              ))}
            </select>
          </label>
          <label className="block text-body">
            <span className="mb-1 block text-label text-ink-secondary">Rule set</span>
            <select
              value={ruleSet}
              onChange={(e) => onRuleSetChange(e.target.value as RuleSetId)}
              className="min-h-tap w-full rounded-input border border-border bg-surface-1 px-3 text-body text-ink"
            >
              {RULE_SETS.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.label}
                </option>
              ))}
            </select>
          </label>
        </div>
      </section>

      {(!supported || !secure) && (
        <div className="rounded-card border border-coral-700 bg-coral-100 p-4 text-body text-coral-700">
          {!supported
            ? 'This browser does not expose camera access (getUserMedia).'
            : 'Camera access needs HTTPS. Open this app over https:// (or localhost) and reload.'}
        </div>
      )}

      {supported && secure && (
        <section className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-title text-ink">Cameras</h2>
            <button
              type="button"
              onClick={grantAndEnumerate}
              className="min-h-tap rounded-input border border-border-strong px-4 text-body text-ink-secondary hover:bg-surface-2"
            >
              {devices.some((d) => d.label) ? 'Refresh cameras' : 'Grant camera access'}
            </button>
          </div>
          {permissionError && <p className="text-caption text-coral-700">{permissionError}</p>}

          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => onChange({ cameraMode: 'single' })}
              className={`min-h-tap flex-1 rounded-input border px-4 text-body ${
                state.cameraMode === 'single' ? 'border-indigo-600 bg-indigo-100 text-indigo-700' : 'border-border text-ink-secondary'
              }`}
            >
              Single camera
            </button>
            <button
              type="button"
              onClick={() => onChange({ cameraMode: 'dual' })}
              className={`min-h-tap flex-1 rounded-input border px-4 text-body ${
                state.cameraMode === 'dual' ? 'border-indigo-600 bg-indigo-100 text-indigo-700' : 'border-border text-ink-secondary'
              }`}
            >
              Two cameras
            </button>
          </div>

          <div className="space-y-2">
            <p className="text-label text-ink-secondary">Camera A — plate cam (required)</p>
            <select
              value={state.deviceByRole.plate ?? ''}
              onChange={(e) => setRole('plate', e.target.value)}
              className="min-h-tap w-full rounded-input border border-border bg-surface-1 px-3 text-body text-ink"
            >
              <option value="" disabled>
                Choose a camera…
              </option>
              {devices.map((d, i) => (
                <option key={d.deviceId} value={d.deviceId}>
                  {d.label || `Camera ${i + 1}`}
                </option>
              ))}
            </select>
            <DevicePreview deviceId={state.deviceByRole.plate} />
          </div>

          {state.cameraMode === 'dual' && (
            <div className="space-y-2">
              <p className="text-label text-ink-secondary">Camera B — side cam</p>
              <select
                value={state.deviceByRole.side ?? ''}
                onChange={(e) => setRole('side', e.target.value)}
                className="min-h-tap w-full rounded-input border border-border bg-surface-1 px-3 text-body text-ink"
              >
                <option value="" disabled>
                  Choose a camera…
                </option>
                {devices
                  .filter((d) => d.deviceId !== state.deviceByRole.plate)
                  .map((d, i) => (
                    <option key={d.deviceId} value={d.deviceId}>
                      {d.label || `Camera ${i + 1}`}
                    </option>
                  ))}
              </select>
              <DevicePreview deviceId={state.deviceByRole.side} />
            </div>
          )}
        </section>
      )}

      <StepFooter
        onNext={onNext}
        nextDisabled={!canProceed}
        nextDisabledReason={!canProceed ? 'Pick a camera for every role you selected.' : undefined}
      />
    </div>
  );
}
