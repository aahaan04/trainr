import { useEffect, useRef, useState } from 'react';
import { TrajectoryRibbon, type RibbonPoint } from '@/diagram/TrajectoryRibbon';
import { usePrefersReducedMotion } from '../hooks/usePrefersReducedMotion';

const VIEWBOX = '0 0 240 160';
const CYCLE_MS = 1800;
const PAUSE_MS = 700;

// Release at lower-left, arcing down through a simple zone rectangle at lower-right.
const PATH: readonly RibbonPoint[] = [
  { x: 10, y: 40 },
  { x: 60, y: 10 },
  { x: 120, y: 30 },
  { x: 170, y: 90 },
  { x: 195, y: 130 },
];

/**
 * First-run hero: a ribbon crossing the zone, animated in on a loop (Section 8.6).
 * Shown on Home before any pitcher/session exists, so the first thing a new user
 * sees is the app's one signature motif rather than an empty list.
 */
export function OnboardingHero({ className = '' }: { className?: string }) {
  const reducedMotion = usePrefersReducedMotion();
  const [progress, setProgress] = useState(reducedMotion ? 1 : 0);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    if (reducedMotion) {
      setProgress(1);
      return;
    }
    const start = performance.now();
    const total = CYCLE_MS + PAUSE_MS;
    const tick = (now: number) => {
      const elapsed = (now - start) % total;
      setProgress(Math.min(1, elapsed / CYCLE_MS));
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, [reducedMotion]);

  return (
    <div className={className}>
      <svg viewBox={VIEWBOX} className="h-40 w-full max-w-md" role="img" aria-label="A pitch crossing the strike zone">
        <rect x={150} y={70} width={70} height={70} fill="none" stroke="var(--indigo-100)" strokeWidth={2} rx={4} />
        <line x1={173.3} y1={70} x2={173.3} y2={140} stroke="var(--indigo-100)" strokeWidth={1} />
        <line x1={196.6} y1={70} x2={196.6} y2={140} stroke="var(--indigo-100)" strokeWidth={1} />
        <line x1={150} y1={93.3} x2={220} y2={93.3} stroke="var(--indigo-100)" strokeWidth={1} />
        <line x1={150} y1={116.6} x2={220} y2={116.6} stroke="var(--indigo-100)" strokeWidth={1} />
        <TrajectoryRibbon points={PATH} progress={progress} minWidthPx={2} maxWidthPx={13} glow />
      </svg>
    </div>
  );
}
