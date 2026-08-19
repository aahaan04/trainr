/**
 * Cross-session trends (Section 7): velocity and command over weeks and months.
 * `TrendsProps` only carries sessions, so pitches are fetched per session here.
 */

import { useEffect, useState } from 'react';
import { pitchesForSession } from '@/storage/db';
import { STATS } from '@/domain/constants';
import { formatSpeed, toMph } from '@/domain/units';
import { useAppStore } from '@/store/appStore';
import type { PitchRecord, Session } from '@/domain/types';
import { crossSessionTrends } from './aggregate';
import { CrossSessionTrendChart } from './charts/CrossSessionTrendChart';

export interface TrendsProps {
  pitcherId: string;
  sessions: Session[];
  className?: string;
}

export function TrendsView({ sessions, className = '' }: TrendsProps) {
  const units = useAppStore((s) => s.settings.units);
  const commandRadiusM = useAppStore((s) => s.settings.commandRadiusM) ?? STATS.DEFAULT_COMMAND_RADIUS_M;
  const [byId, setById] = useState<Record<string, PitchRecord[]> | null>(null);

  useEffect(() => {
    let cancelled = false;
    setById(null);
    void Promise.all(sessions.map(async (s) => [s.id, await pitchesForSession(s.id)] as const)).then((entries) => {
      if (cancelled) return;
      setById(Object.fromEntries(entries));
    });
    return () => {
      cancelled = true;
    };
  }, [sessions]);

  if (byId === null) return <p className="text-caption text-ink-tertiary">Loading trends…</p>;

  const trends = crossSessionTrends(
    sessions.map((session) => ({ session, pitches: byId[session.id] ?? [] })),
    commandRadiusM,
  );

  if (trends.length === 0) {
    return <p className={`text-body text-ink-secondary ${className}`}>No completed sessions with pitches yet.</p>;
  }

  const velocityPoints = trends.map((t) => ({ t: t.startedAt, value: toMph(t.avgVelocityMps), label: t.sessionId }));
  const commandTrends = trends.filter((t) => t.commandHitRate !== null);
  const commandPoints = commandTrends.map((t) => ({ t: t.startedAt, value: (t.commandHitRate ?? 0) * 100, label: t.sessionId }));

  return (
    <div className={`flex flex-col gap-6 ${className}`}>
      <div className="flex flex-col gap-2 rounded-card bg-surface-1 p-4 shadow-rest">
        <span className="text-label uppercase text-ink-tertiary">Average velocity by session</span>
        <CrossSessionTrendChart points={velocityPoints} valueFormat={(v) => `${v.toFixed(0)}`} />
        <span className="text-caption text-ink-tertiary">
          Latest: {formatSpeed(trends[trends.length - 1].avgVelocityMps, units, 0)}
        </span>
      </div>

      {commandPoints.length > 0 && (
        <div className="flex flex-col gap-2 rounded-card bg-surface-1 p-4 shadow-rest">
          <span className="text-label uppercase text-ink-tertiary">Command hit rate by session</span>
          <CrossSessionTrendChart points={commandPoints} valueFormat={(v) => `${v.toFixed(0)}%`} />
        </div>
      )}
    </div>
  );
}
