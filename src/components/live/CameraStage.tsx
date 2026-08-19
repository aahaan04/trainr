import { useEffect, useRef, useState, type ReactNode } from 'react';
import { CAPTURE } from '@/domain/constants';

interface CameraStageProps {
  onStream?: (stream: MediaStream | null) => void;
  children?: ReactNode;
}

type CameraState = 'requesting' | 'ready' | 'denied' | 'unavailable';

/**
 * Full-bleed camera preview. This is a PREVIEW ONLY — frame extraction, ball
 * detection and calibration belong to WS3/WS4 (`src/capture/`, `src/vision/`,
 * `src/geometry/`), which this workstream does not own or import UI from directly
 * (Section "MOUNTING OTHER WORKSTREAMS": their results are consumed via the store,
 * not their internals). Once that pipeline exists it can attach to the same
 * getUserMedia stream or replace this element outright; this component's job is
 * only to make the live screen feel camera-first before that lands.
 *
 * UNTESTABLE without physical camera hardware — see the Live screen's own note.
 */
export function CameraStage({ onStream, children }: CameraStageProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [state, setState] = useState<CameraState>('requesting');

  useEffect(() => {
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      setState('unavailable');
      return;
    }
    let stream: MediaStream | null = null;
    let cancelled = false;

    void navigator.mediaDevices
      .getUserMedia({
        video: {
          width: { ideal: CAPTURE.PREFERRED_WIDTH },
          height: { ideal: CAPTURE.PREFERRED_HEIGHT },
          frameRate: { ideal: CAPTURE.IDEAL_FPS, min: CAPTURE.MIN_FPS },
          facingMode: 'environment',
        },
        audio: false,
      })
      .then((s) => {
        if (cancelled) {
          s.getTracks().forEach((t) => t.stop());
          return;
        }
        stream = s;
        if (videoRef.current) videoRef.current.srcObject = s;
        setState('ready');
        onStream?.(s);
      })
      .catch(() => setState('denied'));

    return () => {
      cancelled = true;
      stream?.getTracks().forEach((t) => t.stop());
      onStream?.(null);
    };
    // Runs once per screen mount; onStream is a stable prop by convention here.
  }, []);

  return (
    <div className="relative h-full w-full overflow-hidden bg-indigo-900">
      <video ref={videoRef} autoPlay playsInline muted className="h-full w-full object-cover" />
      {state !== 'ready' && (
        <div className="over-video absolute inset-0 flex flex-col items-center justify-center gap-2 text-center text-white">
          {state === 'requesting' && <p className="text-body">Requesting camera access...</p>}
          {state === 'denied' && (
            <>
              <p className="text-title font-semibold">Camera access denied</p>
              <p className="max-w-xs text-caption text-indigo-100">
                Allow camera access in your browser settings, then reload.
              </p>
            </>
          )}
          {state === 'unavailable' && (
            <>
              <p className="text-title font-semibold">No camera available</p>
              <p className="max-w-xs text-caption text-indigo-100">
                This device or browser doesn't expose a camera. The live view needs one.
              </p>
            </>
          )}
        </div>
      )}
      {children}
    </div>
  );
}
