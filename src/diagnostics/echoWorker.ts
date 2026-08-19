/**
 * Bounces an ImageBitmap straight back, so the diagnostics probe can separate
 * transfer cost from pipeline cost. Without this baseline a slow frame time is
 * ambiguous between "the segmentation is slow" and "this device is slow at moving
 * bitmaps across the worker boundary", and those have completely different fixes.
 */

const ctx = self as unknown as {
  onmessage: ((e: MessageEvent) => void) | null;
  postMessage: (m: unknown) => void;
};

ctx.onmessage = (e: MessageEvent) => {
  const data = e.data as { type: string; bitmap?: ImageBitmap };
  if (data.type === 'echo') {
    data.bitmap?.close();
    ctx.postMessage({ type: 'echoed' });
  }
};
