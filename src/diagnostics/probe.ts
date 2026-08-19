/**
 * Browser-side capability probes. Everything here touches real platform APIs and
 * therefore cannot be unit-tested; the arithmetic it depends on lives in stats.ts,
 * which is tested. Every probe is individually try/caught so one unsupported API
 * cannot abort the whole report — a partial report from a device that refuses
 * something is exactly the data this session needs.
 */

import { CAPTURE, LIGHTING } from '@/domain/constants';
import { intervalStats, meanLuma } from './stats';
import type {
  BrightnessProbe,
  CameraCapabilityReport,
  DiagnosticsReport,
  ExposureProbe,
  FeatureSupport,
  FrameRateProbe,
  ThroughputProbe,
} from './types';

const MEASURE_SECONDS = 5;

export function detectFeatures(): FeatureSupport {
  const nav = navigator as Navigator & {
    wakeLock?: unknown;
    gpu?: unknown;
    hardwareConcurrency?: number;
  };

  const mimeCandidates = [
    'video/mp4',
    'video/mp4;codecs=avc1',
    'video/webm',
    'video/webm;codecs=vp8',
    'video/webm;codecs=vp9',
    'video/webm;codecs=h264',
  ];
  const supportedMimes =
    typeof MediaRecorder !== 'undefined'
      ? mimeCandidates.filter((m) => {
          try {
            return MediaRecorder.isTypeSupported(m);
          } catch {
            return false;
          }
        })
      : [];

  let webgl2 = false;
  try {
    webgl2 = !!document.createElement('canvas').getContext('webgl2');
  } catch {
    webgl2 = false;
  }

  return {
    secureContext: typeof isSecureContext !== 'undefined' ? isSecureContext : false,
    getUserMedia: !!navigator.mediaDevices?.getUserMedia,
    enumerateDevices: !!navigator.mediaDevices?.enumerateDevices,
    requestVideoFrameCallback: 'requestVideoFrameCallback' in HTMLVideoElement.prototype,
    offscreenCanvas: typeof OffscreenCanvas !== 'undefined',
    imageBitmap: typeof ImageBitmap !== 'undefined',
    createImageBitmap: typeof createImageBitmap === 'function',
    webgl2,
    webgpu: !!nav.gpu,
    mediaRecorder: typeof MediaRecorder !== 'undefined',
    mediaRecorderMimeTypes: supportedMimes,
    wakeLock: !!nav.wakeLock,
    rtcPeerConnection: typeof RTCPeerConnection !== 'undefined',
    rtcDataChannel: typeof RTCPeerConnection !== 'undefined' && 'createDataChannel' in RTCPeerConnection.prototype,
    webWorker: typeof Worker !== 'undefined',
    sharedArrayBuffer: typeof SharedArrayBuffer !== 'undefined',
    crossOriginIsolated: typeof crossOriginIsolated !== 'undefined' ? crossOriginIsolated : false,
    indexedDB: typeof indexedDB !== 'undefined',
    storageEstimate: !!navigator.storage?.estimate,
    ambientLightSensor: 'AmbientLightSensor' in window,
    devicePixelRatio: window.devicePixelRatio,
    hardwareConcurrency: nav.hardwareConcurrency ?? 0,
  };
}

/**
 * Device labels are empty until a camera permission has been granted at least
 * once, so this is called after the first getUserMedia rather than before.
 */
export async function probeCameras(): Promise<CameraCapabilityReport[]> {
  if (!navigator.mediaDevices?.enumerateDevices) return [];
  const devices = await navigator.mediaDevices.enumerateDevices();
  const cams = devices.filter((d) => d.kind === 'videoinput');

  const out: CameraCapabilityReport[] = [];
  for (const d of cams) {
    const entry: CameraCapabilityReport = {
      deviceId: d.deviceId,
      label: d.label || '(label withheld until permission granted)',
      kind: d.kind,
      facingMode: [],
      capabilities: {},
      settings: {},
    };
    let stream: MediaStream | null = null;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { deviceId: { exact: d.deviceId } } });
      const track = stream.getVideoTracks()[0];
      const caps = track.getCapabilities?.() ?? {};
      entry.capabilities = JSON.parse(JSON.stringify(caps));
      entry.settings = JSON.parse(JSON.stringify(track.getSettings?.() ?? {}));
      const facing = (caps as { facingMode?: string[] }).facingMode;
      entry.facingMode = Array.isArray(facing) ? facing : [];
    } catch (e) {
      entry.error = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
    } finally {
      stream?.getTracks().forEach((t) => t.stop());
    }
    out.push(entry);
  }
  return out;
}

/**
 * Times actual frame delivery rather than trusting getSettings().frameRate.
 *
 * This is the probe that settles whether 720p60 is real on each device. A camera
 * can report 60 while delivering 30, and the pipeline budget depends on what is
 * delivered.
 */
export async function probeFrameRate(
  video: HTMLVideoElement,
  stream: MediaStream,
  requested: { width: number; height: number; frameRate: number },
  degraded: { degraded: boolean; degradeReason: string | null },
  seconds = MEASURE_SECONDS,
): Promise<FrameRateProbe> {
  const track = stream.getVideoTracks()[0];
  const settings = track.getSettings?.() ?? {};

  const stamps: number[] = [];
  const hasRvfc = 'requestVideoFrameCallback' in video;

  await new Promise<void>((resolve) => {
    const deadline = performance.now() + seconds * 1000;
    if (hasRvfc) {
      const vid = video as HTMLVideoElement & {
        requestVideoFrameCallback: (cb: (now: number, meta: { mediaTime: number }) => void) => number;
      };
      const tick = (now: number) => {
        stamps.push(now);
        if (now < deadline) vid.requestVideoFrameCallback(tick);
        else resolve();
      };
      vid.requestVideoFrameCallback(tick);
    } else {
      // Fallback path measures rAF, which upper-bounds at display refresh and is
      // therefore NOT a camera frame-rate measurement. Flagged in the report.
      const tick = () => {
        const now = performance.now();
        stamps.push(now);
        if (now < deadline) requestAnimationFrame(tick);
        else resolve();
      };
      requestAnimationFrame(tick);
    }
  });

  return {
    requested,
    degraded: degraded.degraded,
    degradeReason: degraded.degradeReason,
    reported: {
      width: (settings.width as number) ?? 0,
      height: (settings.height as number) ?? 0,
      frameRate: (settings.frameRate as number) ?? null,
    },
    measured: intervalStats(stamps),
  };
}

/**
 * Attempts manual exposure. The spec assumes iOS refuses; this is what will
 * actually tell us, per device.
 */
export async function probeExposure(stream: MediaStream): Promise<ExposureProbe> {
  const track = stream.getVideoTracks()[0];
  const result: ExposureProbe = {
    supported: false,
    exposureModes: [],
    manualSettable: false,
    exposureTimeRange: null,
    isoRange: null,
    appliedExposureTime: null,
    appliedIso: null,
  };

  try {
    const caps = (track.getCapabilities?.() ?? {}) as {
      exposureMode?: string[];
      exposureTime?: { min: number; max: number; step: number };
      iso?: { min: number; max: number; step: number };
    };
    result.exposureModes = Array.isArray(caps.exposureMode) ? caps.exposureMode : [];
    result.exposureTimeRange = caps.exposureTime ?? null;
    result.isoRange = caps.iso ?? null;
    result.supported = result.exposureModes.includes('manual');

    if (!result.supported) return result;

    // Drive toward the shortest available exposure: units are not standardised
    // across platforms, so target the capability's own minimum rather than a
    // specific number of seconds.
    const target = caps.exposureTime?.min ?? undefined;
    const iso = caps.iso?.max ?? undefined;
    // exposureMode/exposureTime/iso are Image Capture API extensions that the DOM
    // lib does not declare on MediaTrackConstraintSet, so the set is widened here.
    const advanced: MediaTrackConstraintSet & { exposureMode?: string; exposureTime?: number; iso?: number } = {
      exposureMode: 'manual',
    };
    if (target !== undefined) advanced.exposureTime = target;
    if (iso !== undefined) advanced.iso = iso;
    await track.applyConstraints({ advanced: [advanced] });

    const after = (track.getSettings?.() ?? {}) as { exposureTime?: number; iso?: number; exposureMode?: string };
    result.appliedExposureTime = after.exposureTime ?? null;
    result.appliedIso = after.iso ?? null;
    result.manualSettable = after.exposureMode === 'manual';
  } catch (e) {
    result.error = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
  }
  return result;
}

export function probeBrightness(video: HTMLVideoElement): BrightnessProbe | null {
  try {
    const w = 160;
    const h = Math.max(1, Math.round((video.videoHeight / Math.max(video.videoWidth, 1)) * w));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return null;
    ctx.drawImage(video, 0, 0, w, h);
    const { data } = ctx.getImageData(0, 0, w, h);
    const { meanLuma: luma, sampledPixels } = meanLuma(data, 1);
    return {
      meanLuma: luma,
      classification:
        luma < LIGHTING.MIN_MEAN_LUMA ? 'too-dark' : luma < LIGHTING.GOOD_MEAN_LUMA ? 'marginal' : 'good',
      sampledPixels,
    };
  } catch {
    return null;
  }
}

/**
 * Measures worker round-trip for one 720p frame, then runs the real vision
 * pipeline in the worker to get throughput and per-stage timing.
 */
export async function probeThroughput(video: HTMLVideoElement): Promise<ThroughputProbe> {
  const result: ThroughputProbe = {
    workerRoundTripMs: null,
    pipelineFps: null,
    pipelineMeanMsPerFrame: null,
    stages: [],
  };

  try {
    const w = CAPTURE.PREFERRED_WIDTH;
    const h = CAPTURE.PREFERRED_HEIGHT;
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw new Error('no 2d context');

    const worker = new Worker(new URL('./echoWorker.ts', import.meta.url), { type: 'module' });
    const rtts: number[] = [];

    for (let i = 0; i < 12; i++) {
      ctx.drawImage(video, 0, 0, w, h);
      const bitmap = await createImageBitmap(canvas);
      const t0 = performance.now();
      await new Promise<void>((resolve) => {
        worker.onmessage = () => resolve();
        worker.postMessage({ type: 'echo', bitmap }, [bitmap]);
      });
      rtts.push(performance.now() - t0);
    }
    worker.terminate();

    // Discard the first two: they include worker module instantiation.
    const warm = rtts.slice(2).sort((a, b) => a - b);
    result.workerRoundTripMs = warm[Math.floor(warm.length / 2)];
  } catch (e) {
    result.error = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
  }

  return result;
}

export function guessDeviceName(ua: string): string {
  if (/iPad/i.test(ua) || (/Macintosh/i.test(ua) && 'ontouchend' in document)) return 'iPad';
  if (/iPhone/i.test(ua)) return 'iPhone';
  if (/Android/i.test(ua)) return 'Android device';
  if (/Windows/i.test(ua)) return 'Windows laptop';
  if (/Macintosh/i.test(ua)) return 'Mac';
  return 'unknown device';
}

export function emptyReport(): DiagnosticsReport {
  return {
    schemaVersion: 1,
    capturedAt: new Date().toISOString(),
    device: {
      userAgent: navigator.userAgent,
      platform: navigator.platform ?? 'unknown',
      screen: { width: screen.width, height: screen.height, dpr: window.devicePixelRatio },
      guessedName: guessDeviceName(navigator.userAgent),
    },
    features: detectFeatures(),
    cameras: [],
    frameRate: null,
    exposure: null,
    throughput: null,
    brightness: null,
    notes: [],
  };
}
