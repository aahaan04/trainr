/**
 * Section 11 platform constraints, camera acquisition side. Every capability here
 * is patchy across browsers (manual exposure barely exists on iOS, 120fps is a
 * Android-Chrome-only ask, `requestVideoFrameCallback` needs Safari 15.4+), so
 * nothing in this module assumes success — every entry point reports what it
 * actually got, and callers degrade the UI from that, not from a guess.
 *
 * UNTESTABLE in this environment: everything here needs a real `navigator.mediaDevices`
 * and a physical or virtual camera. There is no unit test for this file — it is
 * exercised by hand against real hardware, not asserted against here.
 */

import { CAPTURE } from '@/domain/constants';

export function isGetUserMediaSupported(): boolean {
  return typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia;
}

/** getUserMedia requires a secure context on every platform that matters here (iOS Safari in particular). */
export function isSecureContextForCamera(): boolean {
  if (typeof window === 'undefined') return false;
  if (window.isSecureContext) return true;
  return window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
}

export interface CameraDevice {
  deviceId: string;
  label: string;
  groupId: string;
}

/**
 * Device labels are blank until a permission grant has happened at least once in
 * this origin, so the wizard should call this again after `requestAnyCameraStream`
 * succeeds to pick up real labels for the picker.
 */
export async function listCameraDevices(): Promise<CameraDevice[]> {
  if (!isGetUserMediaSupported()) return [];
  const devices = await navigator.mediaDevices.enumerateDevices();
  return devices
    .filter((d): d is MediaDeviceInfo => d.kind === 'videoinput')
    .map((d) => ({ deviceId: d.deviceId, label: d.label, groupId: d.groupId }));
}

export interface StreamResult {
  stream: MediaStream;
  width: number;
  height: number;
  frameRate: number;
  /** True when we fell back from the ideal 720p60+ request. */
  degraded: boolean;
  degradeReason: string | null;
}

/** Constraint attempts in order, from ideal down to "anything that moves". Section 11: prefer 720p60 over 1080p30. */
function constraintChain(deviceId?: string): { constraints: MediaStreamConstraints; degradeReason: string | null }[] {
  const deviceConstraint = deviceId ? { deviceId: { exact: deviceId } } : {};
  return [
    {
      constraints: {
        video: {
          ...deviceConstraint,
          width: { ideal: CAPTURE.PREFERRED_WIDTH },
          height: { ideal: CAPTURE.PREFERRED_HEIGHT },
          frameRate: { ideal: CAPTURE.IDEAL_FPS, min: CAPTURE.MIN_FPS },
        },
        audio: false,
      },
      degradeReason: null,
    },
    {
      constraints: {
        video: {
          ...deviceConstraint,
          width: { ideal: CAPTURE.PREFERRED_WIDTH },
          height: { ideal: CAPTURE.PREFERRED_HEIGHT },
          frameRate: { ideal: CAPTURE.MIN_FPS },
        },
        audio: false,
      },
      degradeReason: `Camera would not commit to ${CAPTURE.MIN_FPS}fps minimum; falling back to a best-effort frame rate.`,
    },
    {
      constraints: {
        video: {
          ...deviceConstraint,
          width: { ideal: CAPTURE.PREFERRED_WIDTH },
          height: { ideal: CAPTURE.PREFERRED_HEIGHT },
        },
        audio: false,
      },
      degradeReason: 'Camera does not expose frame-rate control; using its default.',
    },
    {
      constraints: { video: deviceId ? deviceConstraint : true, audio: false },
      degradeReason: 'Camera would not accept the preferred resolution; using its default resolution.',
    },
  ];
}

/** Tries the constraint chain in order and reports what was actually granted. Throws only if every attempt fails. */
export async function requestCameraStream(deviceId?: string): Promise<StreamResult> {
  if (!isGetUserMediaSupported()) throw new Error('getUserMedia is not supported in this browser.');
  if (!isSecureContextForCamera()) throw new Error('Camera access needs HTTPS (or localhost).');

  const chain = constraintChain(deviceId);
  let lastError: unknown = null;
  for (const attempt of chain) {
    try {
      const stream = await navigator.mediaDevices.getUserMedia(attempt.constraints);
      const track = stream.getVideoTracks()[0];
      const settings = track?.getSettings?.() ?? {};
      return {
        stream,
        width: settings.width ?? CAPTURE.PREFERRED_WIDTH,
        height: settings.height ?? CAPTURE.PREFERRED_HEIGHT,
        frameRate: settings.frameRate ?? CAPTURE.ACCEPTABLE_FPS,
        degraded: attempt.degradeReason !== null,
        degradeReason: attempt.degradeReason,
      };
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError instanceof Error ? lastError : new Error('Could not open any camera stream.');
}

export function stopStream(stream: MediaStream | null | undefined): void {
  stream?.getTracks().forEach((t) => t.stop());
}

// ---------------------------------------------------------------------------
// Capability detection and manual exposure
// ---------------------------------------------------------------------------

export interface ExposureAttempt {
  supported: boolean;
  applied: boolean;
  reason: string;
}

/**
 * `MediaTrackCapabilities.exposureTime`'s units are not standardized across
 * browsers/devices (some report camera-driver ticks, not seconds), so this does
 * not try to hit `CAPTURE.TARGET_EXPOSURE_S` exactly. Instead it drives exposure
 * time toward the capability's reported minimum — the shortest exposure the device
 * will do — since less time integrating light is what fights motion blur,
 * regardless of what unit the number is actually in. `iso` is raised toward its
 * capability maximum to compensate for the darker, shorter exposure.
 */
export function tryManualExposure(track: MediaStreamTrack): Promise<ExposureAttempt> {
  const capabilities = (track.getCapabilities?.() ?? {}) as MediaTrackCapabilities & {
    exposureMode?: string[];
    exposureTime?: { min: number; max: number; step: number };
    iso?: { min: number; max: number; step: number };
  };

  if (!capabilities.exposureMode?.includes('manual')) {
    return Promise.resolve({ supported: false, applied: false, reason: 'Manual exposure is not exposed by this camera/browser.' });
  }

  // exposureMode/exposureTime/iso are valid MediaTrackConstraints per the Image
  // Capture spec but this project's lib.dom.d.ts doesn't declare them, hence the
  // loosened type here.
  const advanced: MediaTrackConstraintSet & { exposureMode?: string; exposureTime?: number; iso?: number } = {
    exposureMode: 'manual',
  };
  if (capabilities.exposureTime) advanced.exposureTime = capabilities.exposureTime.min;
  if (capabilities.iso) advanced.iso = capabilities.iso.max;

  return track
    .applyConstraints({ advanced: [advanced] })
    .then(() => ({ supported: true, applied: true, reason: 'Manual exposure applied.' }))
    .catch((err: unknown) => ({
      supported: true,
      applied: false,
      reason: `Manual exposure was reported as supported but applyConstraints failed: ${String(err)}`,
    }));
}

export function getTrackCapabilities(track: MediaStreamTrack): MediaTrackCapabilities {
  return track.getCapabilities?.() ?? {};
}

export function getTrackSettings(track: MediaStreamTrack): MediaTrackSettings {
  return track.getSettings?.() ?? {};
}
