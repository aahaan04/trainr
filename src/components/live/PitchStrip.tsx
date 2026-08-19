import { useState } from 'react';
import type { PitchRecord } from '@/domain/types';
import { PITCH_TYPE_LABEL, PITCH_TYPES, confidenceBand, type PitchTypeId } from '@/domain/constants';
import type { UnitSystem } from '@/domain/units';
import { formatSpeed } from '@/domain/units';
import { ConfidenceMeter } from '@/components/primitives/ConfidenceMeter';

interface PitchStripProps {
  pitches: PitchRecord[];
  units: UnitSystem;
  onRelabel: (pitchId: string, typeId: PitchTypeId) => void;
}

/** A strip of the last several pitches along one edge, tappable to relabel (Section 9). */
export function PitchStrip({ pitches, units, onRelabel }: PitchStripProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const recent = pitches.slice(0, 12);

  return (
    <div className="over-video flex gap-2 overflow-x-auto px-3 py-2">
      {recent.map((p) => {
        const band = confidenceBand(p.trackingConfidence);
        const isStrike = p.call.result === 'strike';
        const editing = editingId === p.id;
        return (
          <div key={p.id} className="relative shrink-0">
            <button
              type="button"
              onClick={() => setEditingId(editing ? null : p.id)}
              className={[
                'flex min-h-tap min-w-[4.5rem] flex-col items-center justify-center gap-0.5 rounded-input px-2 py-1',
                isStrike ? 'bg-green-700' : 'bg-coral-700',
                band !== 'confident' ? 'opacity-80' : '',
              ].join(' ')}
            >
              <span className="text-caption font-semibold uppercase text-white">
                {isStrike ? 'K' : 'B'}
              </span>
              <span className="num text-caption text-white">{formatSpeed(p.call.front.speedMps, units, 0)}</span>
              <span className="text-caption text-white/80">
                {p.labeledType ? PITCH_TYPE_LABEL[p.labeledType] : p.predictedType ? PITCH_TYPE_LABEL[p.predictedType] : '—'}
              </span>
            </button>
            {editing && (
              <div className="absolute bottom-full left-0 z-10 mb-1 flex w-40 flex-col gap-1 rounded-card bg-surface-1 p-2 shadow-raised">
                {PITCH_TYPES.filter((t) => t.id !== 'custom').map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => {
                      onRelabel(p.id, t.id);
                      setEditingId(null);
                    }}
                    className="min-h-tap rounded-input px-2 text-left text-caption text-ink hover:bg-surface-2"
                  >
                    {t.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        );
      })}
      {recent.length > 0 && (
        <div className="flex shrink-0 items-center px-1">
          <ConfidenceMeter score={recent[0].trackingConfidence} showLabel={false} />
        </div>
      )}
    </div>
  );
}
