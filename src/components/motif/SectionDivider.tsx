import { TrajectoryRibbon } from '@/diagram/TrajectoryRibbon';
import { RIBBON_POINTS, RIBBON_VIEWBOX } from './ribbonPath';

/**
 * A hairline version of the signature curve, used in place of a plain <hr> so even
 * the smallest chrome carries the brand motif. See Section 8.6.
 */
export function SectionDivider({ className = '' }: { className?: string }) {
  return (
    <svg viewBox={RIBBON_VIEWBOX} preserveAspectRatio="none" className={`h-3 w-full ${className}`} aria-hidden="true">
      <TrajectoryRibbon points={RIBBON_POINTS} minWidthPx={0.75} maxWidthPx={3} glow={false} />
    </svg>
  );
}
