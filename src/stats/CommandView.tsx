/**
 * Command (Section 7): average miss distance from the intended target and hit rate
 * within `settings.commandRadiusM`, for pitches thrown in call-before mode.
 */

import { PITCH_TYPE_LABEL } from '@/domain/constants';
import { formatDistance } from '@/domain/units';
import { STATS } from '@/domain/constants';
import { useAppStore } from '@/store/appStore';
import type { PitchRecord, PitchTypeId } from '@/domain/types';
import { commandStats } from './aggregate';

export interface CommandViewProps {
  pitches: PitchRecord[];
  className?: string;
}

export function CommandView({ pitches, className = '' }: CommandViewProps) {
  const units = useAppStore((s) => s.settings.units);
  const radiusM = useAppStore((s) => s.settings.commandRadiusM) ?? STATS.DEFAULT_COMMAND_RADIUS_M;

  const withIntent = pitches.filter((p) => p.intended);
  if (withIntent.length === 0) {
    return (
      <p className={`text-body text-ink-secondary ${className}`}>
        No call-before pitches this session — command stats need an intended target per pitch.
      </p>
    );
  }

  const overall = commandStats(pitches, radiusM);
  const byType = new Map<PitchTypeId, PitchRecord[]>();
  for (const p of withIntent) {
    if (!p.intended) continue;
    const list = byType.get(p.intended.type) ?? [];
    list.push(p);
    byType.set(p.intended.type, list);
  }

  return (
    <div className={`flex flex-col gap-3 rounded-card bg-surface-1 p-4 shadow-rest ${className}`}>
      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-0.5">
          <span className="text-label uppercase text-ink-tertiary">Avg miss</span>
          <span className="num font-display text-display-md font-bold text-ink">
            {overall.avgMissM !== null ? formatDistance(overall.avgMissM, units) : '—'}
          </span>
        </div>
        <div className="flex flex-col gap-0.5">
          <span className="text-label uppercase text-ink-tertiary">Hit rate (within {formatDistance(radiusM, units)})</span>
          <span className="num font-display text-display-md font-bold text-ink">
            {overall.hitRate !== null ? `${(overall.hitRate * 100).toFixed(0)}%` : '—'}
          </span>
        </div>
      </div>

      <table className="w-full text-left text-caption">
        <thead>
          <tr className="text-ink-tertiary">
            <th className="py-1 font-normal">Called type</th>
            <th className="py-1 font-normal">Count</th>
            <th className="py-1 font-normal">Avg miss</th>
            <th className="py-1 font-normal">Hit rate</th>
          </tr>
        </thead>
        <tbody>
          {[...byType.entries()].map(([type, list]) => {
            const s = commandStats(list, radiusM);
            return (
              <tr key={type} className="num border-t border-border text-ink">
                <td className="py-1 font-medium">{PITCH_TYPE_LABEL[type]}</td>
                <td className="py-1">{list.length}</td>
                <td className="py-1">{s.avgMissM !== null ? formatDistance(s.avgMissM, units) : '—'}</td>
                <td className="py-1">{s.hitRate !== null ? `${(s.hitRate * 100).toFixed(0)}%` : '—'}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
