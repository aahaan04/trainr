/**
 * Section 3.1 lighting check. A 1/1000s-ish exposure needs light; the wizard must
 * say so in plain language rather than let a user find out at dusk that their
 * clip is an unusable blur.
 *
 * The pixel-reading half of this (measureSceneLuma) needs a canvas and a live
 * video element, so it is UNTESTABLE without a browser — only `lumaFromRgba` and
 * `classifyLighting`, the pure parts, are unit tested.
 */

import { LIGHTING } from '@/domain/constants';

export type LightingStatus = 'good' | 'marginal' | 'poor';

export interface LightingReading {
  meanLuma: number;
  status: LightingStatus;
  message: string;
}

/** Rec. 601 luma, sampled at a stride so a full-frame read stays cheap. */
export function lumaFromRgba(data: Uint8ClampedArray | Uint8Array, stride = 4): number {
  let sum = 0;
  let count = 0;
  const step = stride * 4;
  for (let i = 0; i + 2 < data.length; i += step) {
    sum += 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    count++;
  }
  return count > 0 ? sum / count : 0;
}

export function classifyLighting(meanLuma: number): LightingReading {
  if (meanLuma >= LIGHTING.GOOD_MEAN_LUMA) {
    return { meanLuma, status: 'good', message: 'Lighting looks good for a fast shutter.' };
  }
  if (meanLuma >= LIGHTING.MIN_MEAN_LUMA) {
    return {
      meanLuma,
      status: 'marginal',
      message: 'Lighting is marginal. Detection may be less reliable — add more light if you can.',
    };
  }
  return {
    meanLuma,
    status: 'poor',
    message:
      'Too dark to track reliably. Bright daylight or a well-lit indoor cage is required; dusk and dim gyms will not work.',
  };
}

function makeCanvas(width: number, height: number): OffscreenCanvas | HTMLCanvasElement {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(width, height);
  const c = document.createElement('canvas');
  c.width = width;
  c.height = height;
  return c;
}

/** Draws a small sample of the current video frame and measures its mean luma. */
export async function measureSceneLuma(video: HTMLVideoElement, sampleSize = 64): Promise<number> {
  if (!video.videoWidth || !video.videoHeight) return 0;
  const aspect = video.videoHeight / video.videoWidth;
  const w = sampleSize;
  const h = Math.max(1, Math.round(sampleSize * aspect));
  const canvas = makeCanvas(w, h);
  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
  if (!ctx) return 0;
  ctx.drawImage(video, 0, 0, w, h);
  const { data } = ctx.getImageData(0, 0, w, h);
  return lumaFromRgba(data, 1);
}

export async function measureAndClassify(video: HTMLVideoElement, sampleSize = 64): Promise<LightingReading> {
  const meanLuma = await measureSceneLuma(video, sampleSize);
  return classifyLighting(meanLuma);
}
