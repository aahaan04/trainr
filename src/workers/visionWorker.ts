/**
 * Vision worker entry point. Runs the entire pipeline -- frame decode, segmentation,
 * blob extraction, tracking, trajectory fit -- off the main thread, per the
 * performance budget in CAPTURE.FRAME_BUDGET_MS.
 *
 * Message protocol is intentionally small: `init`/`recalibrate` set up a
 * VisionPipeline for one camera, `frame` feeds it decoded pixels and gets per-frame
 * detections back for live overlay, `finish` asks for the promoted pitch (if any),
 * and `reset` re-arms tracking between pitches without losing calibration.
 *
 * `self` is cast to `DedicatedWorkerGlobalScope` throughout rather than relied on
 * ambiently: this project's tsconfig lib list includes both "DOM" and "WebWorker",
 * whose global declarations for `self`/`postMessage` do not merge cleanly.
 */

import type { BallDetection, CameraExtrinsics, CameraIntrinsics, CameraRole, FittedTrajectory, HsvGate, PitchCall, StrikeZone } from '@/domain/types';
import { VisionPipeline } from '@/vision/pipeline';

const ctx = self as unknown as DedicatedWorkerGlobalScope;

export interface VisionWorkerInitMessage {
  type: 'init';
  role: CameraRole;
  intrinsics: CameraIntrinsics;
  extrinsics: CameraExtrinsics;
  hsvGate: HsvGate;
  pitchingDistanceFt: number;
  zone?: StrikeZone;
}

export interface VisionWorkerRecalibrateMessage {
  type: 'recalibrate';
  intrinsics: CameraIntrinsics;
  extrinsics: CameraExtrinsics;
}

export interface VisionWorkerFrameMessage {
  type: 'frame';
  index: number;
  timestampMs: number;
  exposureS: number;
  width: number;
  height: number;
  bitmap: ImageBitmap;
}

export interface VisionWorkerFinishMessage {
  type: 'finish';
  requestId: number;
}

export interface VisionWorkerResetMessage {
  type: 'reset';
}

export type VisionWorkerInboundMessage =
  | VisionWorkerInitMessage
  | VisionWorkerRecalibrateMessage
  | VisionWorkerFrameMessage
  | VisionWorkerFinishMessage
  | VisionWorkerResetMessage;

export interface VisionWorkerDetectionsMessage {
  type: 'detections';
  frameIndex: number;
  detections: BallDetection[];
}

export interface VisionWorkerResultMessage {
  type: 'result';
  requestId: number;
  result: { trajectory: FittedTrajectory; call: PitchCall } | null;
}

export interface VisionWorkerErrorMessage {
  type: 'error';
  message: string;
  frameIndex?: number;
}

export type VisionWorkerOutboundMessage = VisionWorkerDetectionsMessage | VisionWorkerResultMessage | VisionWorkerErrorMessage;

let pipeline: VisionPipeline | null = null;
let lastCameraConfig: { intrinsics: CameraIntrinsics; extrinsics: CameraExtrinsics } | null = null;
let decodeCanvas: OffscreenCanvas | null = null;
let decodeCtx: OffscreenCanvasRenderingContext2D | null = null;

function post(message: VisionWorkerOutboundMessage, transfer: Transferable[] = []): void {
  ctx.postMessage(message, transfer);
}

function ensureDecodeSurface(width: number, height: number): OffscreenCanvasRenderingContext2D {
  if (!decodeCanvas || decodeCanvas.width !== width || decodeCanvas.height !== height) {
    decodeCanvas = new OffscreenCanvas(width, height);
    const surface = decodeCanvas.getContext('2d', { willReadFrequently: true }) as OffscreenCanvasRenderingContext2D | null;
    if (!surface) throw new Error('OffscreenCanvas 2D context unavailable in vision worker');
    decodeCtx = surface;
  }
  if (!decodeCtx) throw new Error('OffscreenCanvas 2D context unavailable in vision worker');
  return decodeCtx;
}

function decodeBitmap(bitmap: ImageBitmap, width: number, height: number): Uint8ClampedArray {
  const surface = ensureDecodeSurface(width, height);
  surface.drawImage(bitmap, 0, 0, width, height);
  return surface.getImageData(0, 0, width, height).data;
}

async function handleMessage(msg: VisionWorkerInboundMessage): Promise<void> {
  switch (msg.type) {
    case 'init': {
      lastCameraConfig = { intrinsics: msg.intrinsics, extrinsics: msg.extrinsics };
      pipeline = new VisionPipeline({
        role: msg.role,
        hsvGate: msg.hsvGate,
        pitchingDistanceFt: msg.pitchingDistanceFt,
        zone: msg.zone,
      });
      pipeline.reset(lastCameraConfig);
      return;
    }
    case 'recalibrate': {
      if (!pipeline) throw new Error('Vision worker received "recalibrate" before "init"');
      lastCameraConfig = { intrinsics: msg.intrinsics, extrinsics: msg.extrinsics };
      pipeline.reset(lastCameraConfig);
      return;
    }
    case 'reset': {
      if (!pipeline || !lastCameraConfig) throw new Error('Vision worker received "reset" before "init"');
      pipeline.reset(lastCameraConfig);
      return;
    }
    case 'frame': {
      if (!pipeline) throw new Error('Vision worker received "frame" before "init"');
      const data = decodeBitmap(msg.bitmap, msg.width, msg.height);
      const detections = pipeline.pushFrame({
        index: msg.index,
        timestampMs: msg.timestampMs,
        width: msg.width,
        height: msg.height,
        exposureS: msg.exposureS,
        data,
      });
      msg.bitmap.close();
      post({ type: 'detections', frameIndex: msg.index, detections });
      return;
    }
    case 'finish': {
      if (!pipeline) throw new Error('Vision worker received "finish" before "init"');
      const result = await pipeline.finish();
      post({ type: 'result', requestId: msg.requestId, result });
      return;
    }
  }
}

ctx.addEventListener('message', (ev: MessageEvent<VisionWorkerInboundMessage>) => {
  handleMessage(ev.data).catch((err: unknown) => {
    const frameIndex = ev.data.type === 'frame' ? ev.data.index : undefined;
    post({ type: 'error', message: err instanceof Error ? err.message : String(err), frameIndex });
  });
});
