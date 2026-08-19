/**
 * Rolling clip capture (Section 7). Keeps a short MediaRecorder buffer running
 * against the live camera stream; when a pitch is detected, the surrounding
 * `CAPTURE.CLIP_SECONDS` window is cut out and persisted as a `ClipRecord`.
 *
 * NOTE on the trajectory overlay the spec asks for: per-frame detection and
 * trajectory data are intentionally kept OUT of `appStore` (see its header
 * comment) so React never re-renders at frame rate. That means this module,
 * which only has access to the store's settled results, cannot burn the tracked
 * path into the recorded pixels — that needs frame-level access that lives in
 * WS3/WS4's worker. What this module does today is the achievable half: a
 * correctly-windowed rolling buffer with retention. Burning in the trajectory is
 * a clean follow-up once WS3/WS4 exposes a lightweight per-pitch path, either by
 * drawing it into a compositing canvas before recording or by post-processing the
 * saved clip.
 */
import { db, newId, pruneClips } from '@/storage/db';
import type { ClipRecord } from '@/domain/types';
import { CAPTURE } from '@/domain/constants';

interface BufferedChunk {
  blob: Blob;
  atMs: number;
}

const CANDIDATE_MIME_TYPES = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm', 'video/mp4'];

function pickMimeType(): string | undefined {
  if (typeof MediaRecorder === 'undefined' || !MediaRecorder.isTypeSupported) return undefined;
  return CANDIDATE_MIME_TYPES.find((t) => MediaRecorder.isTypeSupported(t));
}

const TIMESLICE_MS = 200;

export class RollingClipRecorder {
  private recorder: MediaRecorder | null = null;
  private buffer: BufferedChunk[] = [];
  private readonly maxBufferMs = CAPTURE.CLIP_SECONDS * 1000 + 2000;

  get isRecording(): boolean {
    return this.recorder !== null;
  }

  start(stream: MediaStream): void {
    if (typeof MediaRecorder === 'undefined') return;
    this.stop();
    const mimeType = pickMimeType();
    this.recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    this.recorder.ondataavailable = (e: BlobEvent) => {
      if (e.data.size === 0) return;
      this.buffer.push({ blob: e.data, atMs: Date.now() });
      const cutoff = Date.now() - this.maxBufferMs;
      while (this.buffer.length && this.buffer[0].atMs < cutoff) this.buffer.shift();
    };
    this.recorder.start(TIMESLICE_MS);
  }

  stop(): void {
    if (this.recorder && this.recorder.state !== 'inactive') this.recorder.stop();
    this.recorder = null;
    this.buffer = [];
  }

  /**
   * Waits for the post-roll to fill, cuts the buffer to a `CAPTURE.CLIP_SECONDS`
   * window centred on `atMs`, and persists it. Returns the new clip's id, or null
   * if capture wasn't running or nothing fell in the window.
   */
  async captureAround(sessionId: string, pitchId: string, atMs: number, retain: number): Promise<string | null> {
    if (!this.recorder) return null;
    const halfMs = (CAPTURE.CLIP_SECONDS * 1000) / 2;
    const untilMs = atMs + halfMs;
    const waitMs = Math.max(0, untilMs - Date.now());
    if (waitMs > 0) await new Promise((resolve) => setTimeout(resolve, waitMs));

    const chunks = this.buffer.filter((c) => c.atMs >= atMs - halfMs && c.atMs <= untilMs);
    if (chunks.length === 0) return null;

    const blob = new Blob(
      chunks.map((c) => c.blob),
      { type: chunks[0].blob.type || 'video/webm' },
    );
    const clip: ClipRecord = {
      id: newId(),
      sessionId,
      pitchId,
      createdAt: Date.now(),
      durationS: CAPTURE.CLIP_SECONDS,
      bytes: blob.size,
      blob,
    };
    await db.clips.put(clip);
    await pruneClips(retain);
    return clip.id;
  }
}
