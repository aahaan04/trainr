import { useEffect, useRef, useState } from 'react';
import type { HsvGate } from '@/domain/types';
import { requestCameraStream, stopStream } from '@/capture/getUserMedia';
import { fitHsvGate, fitNegativeGate, largestYellowRegion, sampleAllPixels, type RgbaImage } from '@/calibration/ballColor';
import { StepFooter } from '../WizardShell';

const SAMPLE_MAX_DIM = 480;

function captureFrame(video: HTMLVideoElement): RgbaImage | null {
  if (!video.videoWidth) return null;
  const scale = SAMPLE_MAX_DIM / Math.max(video.videoWidth, video.videoHeight);
  const w = Math.max(1, Math.round(video.videoWidth * Math.min(1, scale)));
  const h = Math.max(1, Math.round(video.videoHeight * Math.min(1, scale)));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.drawImage(video, 0, 0, w, h);
  const { data } = ctx.getImageData(0, 0, w, h);
  return { data, width: w, height: h };
}

function gateSwatch(gate: HsvGate): string {
  const hDeg = ((gate.hMin + gate.hMax) / 2) * 2;
  const s = ((gate.sMin + gate.sMax) / 2 / 255) * 100;
  const v = ((gate.vMin + gate.vMax) / 2 / 255) * 100;
  return `hsl(${hDeg}, ${s}%, ${v}%)`;
}

interface BallColorSampleStepProps {
  deviceId: string | undefined;
  hsvGate: HsvGate | null;
  negativeSamples: HsvGate[];
  onChange: (patch: { hsvGate?: HsvGate | null; negativeSamples?: HsvGate[] }) => void;
  onBack: () => void;
  onNext: () => void;
}

export function BallColorSampleStep({ deviceId, hsvGate, negativeSamples, onChange, onBack, onNext }: BallColorSampleStepProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [regionPx, setRegionPx] = useState<number | null>(null);
  const [captureError, setCaptureError] = useState<string | null>(null);

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

  function sampleBall() {
    setCaptureError(null);
    const video = videoRef.current;
    if (!video) return;
    const image = captureFrame(video);
    if (!image) return;
    const region = largestYellowRegion(image);
    if (!region || region.pixelIndices.length < 20) {
      setCaptureError('No clear yellow ball found. Fill more of the frame with the ball and try again.');
      return;
    }
    setRegionPx(region.pixelIndices.length);
    onChange({ hsvGate: fitHsvGate(region.samples) });
  }

  function sampleNegative() {
    const video = videoRef.current;
    if (!video) return;
    const image = captureFrame(video);
    if (!image) return;
    const gate = fitNegativeGate(sampleAllPixels(image));
    onChange({ negativeSamples: [...negativeSamples, gate] });
  }

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-title text-ink">Ball colour</h2>
        <p className="text-body text-ink-secondary">
          Hold the game ball so it fills a good part of the frame, in the same light you'll pitch under, then capture.
        </p>
      </div>

      {error && <p className="text-body text-coral-700">{error}</p>}

      <video ref={videoRef} autoPlay playsInline muted className="aspect-video w-full rounded-input bg-indigo-900 object-cover" />

      <div className="flex flex-wrap gap-3">
        <button
          type="button"
          onClick={sampleBall}
          className="min-h-tap rounded-input bg-indigo-600 px-5 text-body font-semibold text-white hover:bg-indigo-700"
        >
          Capture ball colour
        </button>
        <button
          type="button"
          onClick={sampleNegative}
          className="min-h-tap rounded-input border border-border-strong px-5 text-body text-ink-secondary hover:bg-surface-2"
        >
          Sample background / uniform (not the ball)
        </button>
      </div>

      {captureError && <p className="text-body text-coral-700">{captureError}</p>}

      {hsvGate && (
        <div className="flex items-center gap-4 rounded-card border border-border bg-surface-2 p-4">
          <div className="h-12 w-12 flex-none rounded-input border border-border-strong" style={{ background: gateSwatch(hsvGate) }} />
          <div className="text-body text-ink-secondary">
            <p className="text-ink">
              H {hsvGate.hMin}-{hsvGate.hMax} · S {hsvGate.sMin}-{hsvGate.sMax} · V {hsvGate.vMin}-{hsvGate.vMax}
            </p>
            {regionPx !== null && <p className="text-caption">Fit from {regionPx} sampled pixels.</p>}
          </div>
        </div>
      )}

      {negativeSamples.length > 0 && (
        <div className="space-y-2">
          <p className="text-label text-ink-secondary">Negative samples ({negativeSamples.length})</p>
          <div className="flex flex-wrap gap-2">
            {negativeSamples.map((g, i) => (
              <div key={i} className="flex items-center gap-2 rounded-pill border border-border bg-surface-1 py-1 pl-1 pr-3">
                <div className="h-6 w-6 rounded-full border border-border-strong" style={{ background: gateSwatch(g) }} />
                <button
                  type="button"
                  onClick={() => onChange({ negativeSamples: negativeSamples.filter((_, j) => j !== i) })}
                  className="text-caption text-ink-tertiary hover:text-coral-700"
                >
                  Remove
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      <StepFooter
        onBack={onBack}
        onNext={onNext}
        nextDisabled={!hsvGate}
        nextDisabledReason={!hsvGate ? 'Capture the ball colour before continuing.' : undefined}
      />
    </div>
  );
}
