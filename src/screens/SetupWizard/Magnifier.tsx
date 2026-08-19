import { useEffect, useRef } from 'react';

const SIZE = 120;
const ZOOM = 4;

interface MagnifierProps {
  source: HTMLVideoElement | null;
  /** Position to magnify, in the source's natural pixel space (video pixels, not CSS pixels). */
  sourcePoint: { x: number; y: number } | null;
  /** Where to draw the lens on screen, in CSS pixels relative to the positioning container. */
  screenPosition: { left: number; top: number } | null;
}

/**
 * Section 3.2: "magnifier-on-drag for precision." Corner-tap accuracy is not a
 * nicety here — solvePnP.ts's own tests show the plate-cam solve can be off by
 * metres at 2px of tap noise while reprojection error looks fine (see the header
 * comment on `estimatePoseUncertainty`), so this is what keeps taps near ~1px.
 */
export function Magnifier({ source, sourcePoint, screenPosition }: MagnifierProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !source || !sourcePoint) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const cropSize = SIZE / ZOOM;
    ctx.clearRect(0, 0, SIZE, SIZE);
    ctx.imageSmoothingEnabled = false;
    try {
      ctx.drawImage(
        source,
        sourcePoint.x - cropSize / 2,
        sourcePoint.y - cropSize / 2,
        cropSize,
        cropSize,
        0,
        0,
        SIZE,
        SIZE,
      );
    } catch {
      // Video not ready yet for a given frame; skip this paint.
    }
    ctx.strokeStyle = '#D8E600';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(SIZE / 2, 0);
    ctx.lineTo(SIZE / 2, SIZE);
    ctx.moveTo(0, SIZE / 2);
    ctx.lineTo(SIZE, SIZE / 2);
    ctx.stroke();
  }, [source, sourcePoint]);

  if (!sourcePoint || !screenPosition) return null;

  return (
    <div
      className="pointer-events-none absolute z-20 overflow-hidden rounded-full border-2 border-white shadow-raised"
      style={{ left: screenPosition.left - SIZE / 2, top: screenPosition.top - SIZE - 24, width: SIZE, height: SIZE }}
    >
      <canvas ref={canvasRef} width={SIZE} height={SIZE} />
    </div>
  );
}
