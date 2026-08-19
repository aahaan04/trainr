import { useEffect, useRef, useState } from 'react';
import { requestCameraStream, stopStream } from '@/capture/getUserMedia';
import { measureAndClassify, type LightingReading } from '@/capture/lighting';
import { StepFooter } from '../WizardShell';

interface LightingCheckStepProps {
  deviceId: string | undefined;
  acknowledged: boolean;
  onAcknowledge: (v: boolean) => void;
  onBack: () => void;
  onNext: () => void;
}

const STATUS_STYLES: Record<LightingReading['status'], string> = {
  good: 'border-green-700 bg-green-100 text-green-700',
  marginal: 'border-amber-600 bg-amber-100 text-amber-600',
  poor: 'border-coral-700 bg-coral-100 text-coral-700',
};

export function LightingCheckStep({ deviceId, acknowledged, onAcknowledge, onBack, onNext }: LightingCheckStepProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [reading, setReading] = useState<LightingReading | null>(null);
  const [error, setError] = useState<string | null>(null);

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
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
    return () => {
      cancelled = true;
      stopStream(stream);
    };
  }, [deviceId]);

  async function recheck() {
    if (!videoRef.current) return;
    setReading(await measureAndClassify(videoRef.current));
  }

  useEffect(() => {
    const t = setTimeout(() => void recheck(), 800); // let the camera settle exposure first
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deviceId]);

  const canProceed = reading?.status === 'good' || (reading?.status === 'marginal' && acknowledged) || (reading?.status === 'poor' && acknowledged);

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-title text-ink">Lighting check</h2>
        <p className="text-body text-ink-secondary">
          A fast shutter needs light. Bright daylight or a well-lit indoor cage is required — dusk and dim gyms will
          not produce a usable track.
        </p>
      </div>

      {error && <p className="text-body text-coral-700">{error}</p>}

      <video ref={videoRef} autoPlay playsInline muted className="aspect-video w-full rounded-input bg-indigo-900 object-cover" />

      {reading && (
        <div className={`rounded-card border p-4 text-body ${STATUS_STYLES[reading.status]}`}>
          <p className="font-semibold">Mean scene brightness: {reading.meanLuma.toFixed(0)} / 255</p>
          <p>{reading.message}</p>
        </div>
      )}

      <button
        type="button"
        onClick={recheck}
        className="min-h-tap rounded-input border border-border-strong px-5 text-body text-ink-secondary hover:bg-surface-2"
      >
        Re-check
      </button>

      {reading && reading.status !== 'good' && (
        <label className="flex items-center gap-2 text-body">
          <input type="checkbox" checked={acknowledged} onChange={(e) => onAcknowledge(e.target.checked)} className="h-5 w-5" />
          <span className="text-ink-secondary">I understand tracking may be unreliable in this light and want to continue anyway.</span>
        </label>
      )}

      <StepFooter
        onBack={onBack}
        onNext={onNext}
        nextDisabled={!canProceed}
        nextDisabledReason={!canProceed ? 'Improve the lighting, or acknowledge the risk, before continuing.' : undefined}
      />
    </div>
  );
}
