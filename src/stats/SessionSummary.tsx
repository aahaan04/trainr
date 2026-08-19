/**
 * Session summary (Section 7): pitch count, strike%, first-pitch strike%, strike%
 * and velocity by type. Matches the `{ pitches, className? }` contract WS6's
 * adapter (src/components/adapters/statsAdapter.tsx) already expects.
 */

import { PITCH_TYPE_LABEL } from '@/domain/constants';
import { formatSpeed } from '@/domain/units';
import { useAppStore } from '@/store/appStore';
import type { PitchRecord } from '@/domain/types';
import { summarizeSession } from './aggregate';

export interface SessionSummaryProps {
  pitches: PitchRecord[];
  className?: string;
}

export function SessionSummary({ pitches, className = '' }: SessionSummaryProps) {
  const units = useAppStore((s) => s.settings.units);
  const summary = summarizeSession(pitches);

  if (summary.pitchCount === 0) {
    return <p className={`text-body text-ink-secondary ${className}`}>No pitches recorded yet.</p>;
  }

  return (
    <div className={`flex flex-col gap-3 rounded-card bg-surface-1 p-4 shadow-rest ${className}`}>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Stat label="Pitches" value={String(summary.pitchCount)} />
        <Stat label="Strike %" value={`${(summary.strikePercentage * 100).toFixed(0)}%`} />
        <Stat label="1st-pitch strike %" value={`${(summary.firstPitchStrikePercentage * 100).toFixed(0)}%`} />
      </div>

      <table className="w-full text-left text-caption">
        <thead>
          <tr className="text-ink-tertiary">
            <th className="py-1 font-normal">Type</th>
            <th className="py-1 font-normal">Count</th>
            <th className="py-1 font-normal">Strike %</th>
            <th className="py-1 font-normal">Avg</th>
            <th className="py-1 font-normal">Peak</th>
          </tr>
        </thead>
        <tbody>
          {summary.velocityByType.map((v) => {
            const sr = summary.strikeRateByType.find((s) => s.type === v.type);
            return (
              <tr key={v.type} className="num border-t border-border text-ink">
                <td className="py-1 font-medium">{PITCH_TYPE_LABEL[v.type]}</td>
                <td className="py-1">{v.count}</td>
                <td className="py-1">{sr ? `${(sr.strikeRate * 100).toFixed(0)}%` : '—'}</td>
                <td className="py-1">{formatSpeed(v.avgMps, units, 0)}</td>
                <td className="py-1">{formatSpeed(v.peakMps, units, 0)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {summary.hasApproximateBreaks && (
        <p className="text-caption text-ink-tertiary">
          Some pitches used single-camera mode — their break figures are approximate (Section 16).
        </p>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-label uppercase text-ink-tertiary">{label}</span>
      <span className="num font-display text-display-md font-bold text-ink">{value}</span>
    </div>
  );
}
