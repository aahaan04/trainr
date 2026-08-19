import { TrajectoryRibbon } from '@/diagram/TrajectoryRibbon';
import { PLATE_SILHOUETTE_D, RIBBON_POINTS, RIBBON_VIEWBOX } from './ribbonPath';

interface RibbonMarkProps {
  className?: string;
  /** Renders on a dark surface (header chrome) vs a light one (favicon, splash). */
  tone?: 'onDark' | 'onLight';
  withPlate?: boolean;
  title?: string;
}

/**
 * The logo mark: WS7's `<TrajectoryRibbon/>` arcing over a plate silhouette. Every
 * app icon, header brand mark and splash screen renders from this one component so
 * the identity never drifts. See Section 8.6.
 */
export function RibbonMark({ className, tone = 'onDark', withPlate = true, title = 'Trainr' }: RibbonMarkProps) {
  const plateFill = tone === 'onDark' ? 'rgba(255,255,255,0.9)' : 'var(--indigo-900)';
  return (
    <svg viewBox={RIBBON_VIEWBOX} className={className} role="img" aria-label={title}>
      {withPlate && <path d={PLATE_SILHOUETTE_D} fill={plateFill} />}
      <TrajectoryRibbon points={RIBBON_POINTS} minWidthPx={4} maxWidthPx={26} glow />
    </svg>
  );
}
