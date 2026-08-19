import { useEffect, useRef, useState } from 'react';
import { TrajectoryRibbon } from '@/diagram/TrajectoryRibbon';
import { usePrefersReducedMotion } from '../hooks/usePrefersReducedMotion';
import { RIBBON_POINTS, RIBBON_VIEWBOX } from './ribbonPath';

interface RibbonLoaderProps {
  label?: string;
  className?: string;
}

const CYCLE_MS = 1200;

/**
 * Loading / empty state: the signature ribbon draws itself in on a loop rather
 * than a generic spinner, via WS7's `<TrajectoryRibbon progress/>`. Honors
 * prefers-reduced-motion by freezing on the fully-drawn ribbon instead of looping.
 */
export function RibbonLoader({ label = 'Loading', className = '' }: RibbonLoaderProps) {
  const reducedMotion = usePrefersReducedMotion();
  const [progress, setProgress] = useState(reducedMotion ? 1 : 0);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    if (reducedMotion) {
      setProgress(1);
      return;
    }
    const start = performance.now();
    const tick = (now: number) => {
      const t = ((now - start) % CYCLE_MS) / CYCLE_MS;
      setProgress(t);
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, [reducedMotion]);

  return (
    <div className={`flex flex-col items-center justify-center gap-3 py-10 ${className}`}>
      <svg viewBox={RIBBON_VIEWBOX} className="h-20 w-40" aria-hidden="true">
        <TrajectoryRibbon points={RIBBON_POINTS} progress={progress} minWidthPx={2} maxWidthPx={12} glow />
      </svg>
      <p className="text-caption text-ink-tertiary" role="status">
        {label}
      </p>
    </div>
  );
}
