import type { Vec2 } from '@/domain/types';

/** CSS-pixel pointer position -> video-natural-pixel position (what solvePnP/projectPoint work in). */
export function naturalFromClient(video: HTMLVideoElement, clientX: number, clientY: number): Vec2 | null {
  if (!video.videoWidth) return null;
  const rect = video.getBoundingClientRect();
  return {
    x: (clientX - rect.left) * (video.videoWidth / rect.width),
    y: (clientY - rect.top) * (video.videoHeight / rect.height),
  };
}

/** Video-natural-pixel position -> CSS position relative to a positioned ancestor, for overlay SVGs. */
export function screenFromNatural(video: HTMLVideoElement, container: HTMLElement, p: Vec2): Vec2 | null {
  if (!video.videoWidth) return null;
  const rect = video.getBoundingClientRect();
  const c = container.getBoundingClientRect();
  return {
    x: rect.left - c.left + (p.x / video.videoWidth) * rect.width,
    y: rect.top - c.top + (p.y / video.videoHeight) * rect.height,
  };
}
