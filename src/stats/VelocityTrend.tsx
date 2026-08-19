import type { PitchRecord } from '@/domain/types';
import { detectFatigue, velocityTrend } from './aggregate';
import { VelocityTrendChart } from './charts/VelocityTrendChart';

export interface VelocityTrendProps {
  pitches: PitchRecord[];
  className?: string;
}

/** Section 7: velocity within a session, flagged for a sustained peak-relative drop (fatigue). */
export function VelocityTrend({ pitches, className = '' }: VelocityTrendProps) {
  const points = velocityTrend(pitches);
  const fatigue = detectFatigue(pitches);
  if (points.length === 0) {
    return <p className={`text-body text-ink-secondary ${className}`}>No pitches recorded yet.</p>;
  }
  return (
    <div className={`rounded-card bg-surface-1 p-4 shadow-rest ${className}`}>
      <VelocityTrendChart points={points} fatigue={fatigue} />
    </div>
  );
}
