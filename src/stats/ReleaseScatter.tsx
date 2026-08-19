import type { PitchRecord } from '@/domain/types';
import { releaseConsistency, releasePoints } from './aggregate';
import { ReleaseScatterChart, releaseConsistencyCopy } from './charts/ReleaseScatterChart';

export interface ReleaseScatterProps {
  pitches: PitchRecord[];
  className?: string;
}

/** Section 7: release point consistency, with the tipping verdict said plainly. */
export function ReleaseScatter({ pitches, className = '' }: ReleaseScatterProps) {
  const points = releasePoints(pitches);
  if (points.length === 0) {
    return <p className={`text-body text-ink-secondary ${className}`}>No pitches recorded yet.</p>;
  }
  const consistency = releaseConsistency(pitches);
  return (
    <div className={`flex flex-col gap-2 rounded-card bg-surface-1 p-4 shadow-rest ${className}`}>
      <ReleaseScatterChart points={points} />
      <p className="text-caption text-ink-secondary">{releaseConsistencyCopy(consistency)}</p>
    </div>
  );
}
