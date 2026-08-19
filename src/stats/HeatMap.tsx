/**
 * Zone heat map view: filterable by pitch type and by called (pre-pitch intended
 * target, call-before mode) vs actual (measured crossing). Section 7.
 */

import { useMemo, useState } from 'react';
import { PITCH_TYPE_LABEL, PITCH_TYPES } from '@/domain/constants';
import type { PitchRecord, PitchTypeId, StrikeZone } from '@/domain/types';
import { computeHeatMap } from './aggregate';
import { ZoneHeatMapChart } from './charts/ZoneHeatMapChart';

export interface HeatMapProps {
  pitches: PitchRecord[];
  className?: string;
}

/** No single canonical zone per session, so cells are bucketed against a representative zone: the median bounds actually seen. */
function representativeZone(pitches: readonly PitchRecord[]): StrikeZone | null {
  if (pitches.length === 0) return null;
  const bottoms = pitches.map((p) => p.zone.bottomM).sort((a, b) => a - b);
  const tops = pitches.map((p) => p.zone.topM).sort((a, b) => a - b);
  const mid = Math.floor(pitches.length / 2);
  return { ...pitches[0].zone, bottomM: bottoms[mid], topM: tops[mid] };
}

export function HeatMap({ pitches, className = '' }: HeatMapProps) {
  const [pitchType, setPitchType] = useState<PitchTypeId | 'all'>('all');
  const [source, setSource] = useState<'called' | 'actual'>('actual');

  const zone = useMemo(() => representativeZone(pitches), [pitches]);
  const hasIntent = pitches.some((p) => p.intended);

  const cells = useMemo(() => {
    if (!zone) return [];
    return computeHeatMap(pitches, zone, { pitchType: pitchType === 'all' ? undefined : pitchType, source });
  }, [pitches, zone, pitchType, source]);

  if (!zone) return <p className={`text-body text-ink-secondary ${className}`}>No pitches recorded yet.</p>;

  return (
    <div className={`flex flex-col gap-3 rounded-card bg-surface-1 p-4 shadow-rest ${className}`}>
      <div className="flex flex-wrap items-center gap-2">
        <select
          className="rounded-input border border-border bg-surface-1 px-2 py-1 text-caption text-ink"
          value={pitchType}
          onChange={(e) => setPitchType(e.target.value as PitchTypeId | 'all')}
        >
          <option value="all">All types</option>
          {PITCH_TYPES.map((t) => (
            <option key={t.id} value={t.id}>
              {t.label}
            </option>
          ))}
        </select>
        {hasIntent && (
          <div className="flex gap-1">
            <button
              type="button"
              onClick={() => setSource('actual')}
              className={`rounded-pill px-3 py-1 text-caption font-medium ${source === 'actual' ? 'bg-indigo-600 text-white' : 'bg-surface-2 text-ink-secondary'}`}
            >
              Actual
            </button>
            <button
              type="button"
              onClick={() => setSource('called')}
              className={`rounded-pill px-3 py-1 text-caption font-medium ${source === 'called' ? 'bg-indigo-600 text-white' : 'bg-surface-2 text-ink-secondary'}`}
            >
              Called
            </button>
          </div>
        )}
      </div>
      <ZoneHeatMapChart cells={cells} zone={zone} />
      {pitchType !== 'all' && (
        <p className="text-caption text-ink-tertiary">Showing {PITCH_TYPE_LABEL[pitchType]} only.</p>
      )}
    </div>
  );
}
