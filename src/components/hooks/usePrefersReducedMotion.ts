import { useEffect, useState } from 'react';

/** Mirrors the OS-level reduced-motion preference for JS-driven animation (rAF loops), where the
 * global CSS override in tokens.css (which handles `animation`/`transition`) can't reach. */
export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReduced(mq.matches);
    const listener = () => setReduced(mq.matches);
    mq.addEventListener?.('change', listener);
    return () => mq.removeEventListener?.('change', listener);
  }, []);
  return reduced;
}
