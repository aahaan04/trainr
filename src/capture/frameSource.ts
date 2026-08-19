/**
 * Section 11 capture loop, and the producer half of the WS3 interface contract.
 *
 * `requestVideoFrameCallback` (rVFC) is the only correct way to drive capture: it
 * fires once per decoded frame and hands back `mediaTime`, so frames are neither
 * dropped nor duplicated the way they are under `setInterval`/`requestAnimationFrame`
 * polling. Where rVFC is unavailable (Safari < 15.4) this falls back to an rAF loop
 * that de-dupes on `video.currentTime`, which is strictly worse — degraded, not
 * silently wrong — and every consumer can check `usesFrameCallback` to know which
 * regime it's getting.
 *
 * UNTESTABLE in this environment: needs a real `<video>` element decoding a live
 * MediaStream, which jsdom cannot provide. Exercised by hand against real hardware.
 */

import type { CameraRole, FramePacket } from '@/domain/types';

export type FrameCallback = (packet: FramePacket) => void;
export type InterruptedCallback = (reason: 'track-ended' | 'visibility-resume-failed') => void;

interface VideoFrameCallbackMetadata {
  mediaTime: number;
  width: number;
  height: number;
}

type VideoWithFrameCallback = HTMLVideoElement & {
  requestVideoFrameCallback?: (cb: (now: number, metadata: VideoFrameCallbackMetadata) => void) => number;
  cancelVideoFrameCallback?: (handle: number) => void;
};

export class FrameSource {
  private readonly role: CameraRole;
  private readonly video: VideoWithFrameCallback;
  private readonly usingRvfc: boolean;
  private stream: MediaStream | null = null;
  private frameCallbacks = new Set<FrameCallback>();
  private interruptedCallbacks = new Set<InterruptedCallback>();
  private active = false;
  private frameIndex = 0;
  private exposureS: number;
  private rvfcHandle: number | null = null;
  private rafHandle: number | null = null;
  private lastRafTime = -1;
  private readonly onVisibilityChange = () => this.handleVisibilityChange();
  private readonly onTrackEnded = () => this.interruptedCallbacks.forEach((cb) => cb('track-ended'));

  constructor(role: CameraRole, options?: { exposureS?: number }) {
    this.role = role;
    this.exposureS = options?.exposureS ?? 1 / 60;
    this.video = document.createElement('video') as VideoWithFrameCallback;
    this.video.muted = true;
    this.video.playsInline = true;
    this.video.autoplay = true;
    this.usingRvfc = typeof this.video.requestVideoFrameCallback === 'function';
  }

  /** Owned by this class, but exposed so a wizard step or live screen can mount it for preview/overlay. */
  get videoElement(): HTMLVideoElement {
    return this.video;
  }

  get usesFrameCallback(): boolean {
    return this.usingRvfc;
  }

  setExposureS(exposureS: number): void {
    this.exposureS = exposureS;
  }

  async start(stream: MediaStream): Promise<void> {
    this.stop();
    this.stream = stream;
    this.video.srcObject = stream;
    stream.getVideoTracks().forEach((t) => t.addEventListener('ended', this.onTrackEnded));
    this.active = true;
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', this.onVisibilityChange);
    try {
      await this.video.play();
    } catch {
      // Autoplay can be deferred until a gesture even after camera permission is
      // granted on some platforms; the visibility handler retries on resume.
    }
    this.scheduleNext();
  }

  stop(): void {
    this.active = false;
    if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', this.onVisibilityChange);
    if (this.rvfcHandle !== null) {
      this.video.cancelVideoFrameCallback?.(this.rvfcHandle);
      this.rvfcHandle = null;
    }
    if (this.rafHandle !== null) {
      cancelAnimationFrame(this.rafHandle);
      this.rafHandle = null;
    }
    this.stream?.getVideoTracks().forEach((t) => t.removeEventListener('ended', this.onTrackEnded));
    this.video.pause();
    this.video.srcObject = null;
    this.stream = null;
  }

  /** Subscribe to frames. Returns an unsubscribe function. */
  onFrame(cb: FrameCallback): () => void {
    this.frameCallbacks.add(cb);
    return () => this.frameCallbacks.delete(cb);
  }

  /** Subscribe to unexpected interruptions (track ended, resume failed after backgrounding). */
  onInterrupted(cb: InterruptedCallback): () => void {
    this.interruptedCallbacks.add(cb);
    return () => this.interruptedCallbacks.delete(cb);
  }

  private handleVisibilityChange(): void {
    if (document.visibilityState !== 'visible' || !this.active) return;
    if (!this.video.paused) return;
    void this.video
      .play()
      .then(() => this.scheduleNext())
      .catch(() => this.interruptedCallbacks.forEach((cb) => cb('visibility-resume-failed')));
  }

  private scheduleNext(): void {
    if (!this.active) return;
    if (this.usingRvfc) {
      this.rvfcHandle = this.video.requestVideoFrameCallback!((_now, metadata) => {
        void this.emitFrame(metadata.mediaTime, metadata.width, metadata.height);
        this.scheduleNext();
      });
    } else {
      this.rafHandle = requestAnimationFrame(() => {
        if (this.video.readyState >= 2 && this.video.currentTime !== this.lastRafTime) {
          this.lastRafTime = this.video.currentTime;
          void this.emitFrame(this.video.currentTime, this.video.videoWidth, this.video.videoHeight);
        }
        this.scheduleNext();
      });
    }
  }

  private async emitFrame(mediaTime: number, width: number, height: number): Promise<void> {
    if (this.frameCallbacks.size === 0 || !width || !height) return;
    if (typeof createImageBitmap !== 'function') return;
    let bitmap: ImageBitmap;
    try {
      bitmap = await createImageBitmap(this.video);
    } catch {
      return;
    }
    const packet: FramePacket = {
      role: this.role,
      index: this.frameIndex++,
      mediaTime,
      // Single-camera host clock. Cross-device offset correction is the multi-camera
      // sync workstream's job (src/net/clockSync.ts) and happens downstream of this.
      timestampMs: performance.timeOrigin + performance.now(),
      width,
      height,
      exposureS: this.exposureS,
      bitmap,
    };
    for (const cb of this.frameCallbacks) cb(packet);
  }
}
