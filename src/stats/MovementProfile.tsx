import type { PitchRecord } from '@/domain/types';
import { movementProfile } from './aggregate';
import { MovementProfileChart } from './charts/MovementProfileChart';

export interface MovementProfileProps {
  pitches: PitchRecord[];
  className?: string;
}

/** Section 7: the classic pitch-shape chart. */
export function MovementProfile({ pitches, className = '' }: MovementProfileProps) {
  const points = movementProfile(pitches);
  if (points.length === 0) {
    return <p className={`text-body text-ink-secondary ${className}`}>No pitches recorded yet.</p>;
  }
  return (
    <div className={`rounded-card bg-surface-1 p-4 shadow-rest ${className}`}>
      <MovementProfileChart points={points} />
    </div>
  );
}
