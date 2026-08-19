/**
 * Device capability probe (Task 1 of the hardware validation session).
 *
 * The whole point is to replace assumptions with measurements. Two of the spec's
 * load-bearing assumptions have never been checked on real hardware:
 *   - that 720p60 is grantable
 *   - that iOS will not grant manual exposure
 * Everything here is designed so both devices produce comparable JSON.
 *
 * Measured-not-reported is the rule: frame rate comes from timing actual
 * `requestVideoFrameCallback` deliveries, never from `getSettings().frameRate`,
 * which reports what the browser intends rather than what the sensor delivers.
 */

export interface FeatureSupport {
  secureContext: boolean;
  getUserMedia: boolean;
  enumerateDevices: boolean;
  requestVideoFrameCallback: boolean;
  offscreenCanvas: boolean;
  imageBitmap: boolean;
  createImageBitmap: boolean;
  webgl2: boolean;
  webgpu: boolean;
  mediaRecorder: boolean;
  mediaRecorderMimeTypes: string[];
  wakeLock: boolean;
  rtcPeerConnection: boolean;
  rtcDataChannel: boolean;
  webWorker: boolean;
  sharedArrayBuffer: boolean;
  crossOriginIsolated: boolean;
  indexedDB: boolean;
  storageEstimate: boolean;
  ambientLightSensor: boolean;
  devicePixelRatio: number;
  hardwareConcurrency: number;
}

export interface CameraCapabilityReport {
  deviceId: string;
  label: string;
  kind: string;
  facingMode: string[];
  /** Raw getCapabilities() output, whatever the platform chose to expose. */
  capabilities: Record<string, unknown>;
  /** Raw getSettings() output for the granted track. */
  settings: Record<string, unknown>;
  error?: string;
}

export interface ExposureProbe {
  supported: boolean;
  /** Modes the platform admits to, e.g. ['continuous','manual']. */
  exposureModes: string[];
  manualSettable: boolean;
  exposureTimeRange: { min: number; max: number; step: number } | null;
  isoRange: { min: number; max: number; step: number } | null;
  /** What actually stuck after applyConstraints, read back from getSettings(). */
  appliedExposureTime: number | null;
  appliedIso: number | null;
  error?: string;
}

export interface FrameRateProbe {
  requested: { width: number; height: number; frameRate: number };
  /**
   * Whether the app's constraint ladder had to step down, and why. A device that
   * refuses 720p60 outright matters more than one that merely delivers it slowly.
   */
  degraded: boolean;
  degradeReason: string | null;
  /** What getSettings() claims. Often optimistic. */
  reported: { width: number; height: number; frameRate: number | null };
  /** What was actually delivered, timed over the sample window. */
  measured: {
    frames: number;
    durationS: number;
    fps: number;
    meanIntervalMs: number;
    medianIntervalMs: number;
    p95IntervalMs: number;
    /** Intervals longer than 1.5x the median, i.e. probable dropped frames. */
    longIntervals: number;
  };
}

export interface StageTiming {
  stage: string;
  meanMs: number;
  p95Ms: number;
  samples: number;
}

export interface ThroughputProbe {
  /** Round-trip for one frame to the worker and back, excluding pipeline work. */
  workerRoundTripMs: number | null;
  /** Full pipeline, measured end to end in the worker. */
  pipelineFps: number | null;
  pipelineMeanMsPerFrame: number | null;
  stages: StageTiming[];
  error?: string;
}

export interface BrightnessProbe {
  meanLuma: number;
  classification: 'too-dark' | 'marginal' | 'good';
  sampledPixels: number;
}

export interface DiagnosticsReport {
  schemaVersion: 1;
  capturedAt: string;
  device: {
    userAgent: string;
    platform: string;
    screen: { width: number; height: number; dpr: number };
    /** Best-effort label the tester can correct by hand in the report. */
    guessedName: string;
  };
  features: FeatureSupport;
  cameras: CameraCapabilityReport[];
  frameRate: FrameRateProbe | null;
  exposure: ExposureProbe | null;
  throughput: ThroughputProbe | null;
  brightness: BrightnessProbe | null;
  notes: string[];
}
