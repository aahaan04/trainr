/**
 * Manual pitch-type labelling (Section 6.1), the PRIMARY path — the learned
 * classifier only ever suggests. Large tap targets for every PITCH_TYPES entry,
 * a one-tap "same as last" repeat for bullpen sets, and inline naming for the
 * custom slot. Prop shape matches src/components/adapters/statsAdapter.tsx exactly
 * so WS6's live screen picks this up in place of its PitchTypeRow fallback.
 */

import { useRef, useState } from 'react';
import { PITCH_TYPES, type PitchTypeId } from '@/domain/constants';

export interface PitchTypePadProps {
  value: PitchTypeId | null;
  onChange: (type: PitchTypeId, customName?: string) => void;
  disabled?: boolean;
  className?: string;
}

export function PitchTypePad({ value, onChange, disabled, className = '' }: PitchTypePadProps) {
  const [customDraft, setCustomDraft] = useState('');
  const [editingCustom, setEditingCustom] = useState(false);
  const lastPicked = useRef<{ type: PitchTypeId; customName?: string } | null>(null);
  const savedCustomName = useRef<string>('');

  const pick = (type: PitchTypeId, customName?: string) => {
    lastPicked.current = { type, customName };
    if (customName) savedCustomName.current = customName;
    onChange(type, customName);
  };

  const handleCustomTap = () => {
    if (savedCustomName.current) {
      pick('custom', savedCustomName.current);
      return;
    }
    setEditingCustom(true);
  };

  const commitCustomName = () => {
    const name = customDraft.trim();
    setEditingCustom(false);
    if (name) pick('custom', name);
  };

  const showSameAsLast = lastPicked.current !== null && lastPicked.current.type !== value;

  return (
    <div className={`flex flex-col gap-2 px-3 py-2 ${className}`}>
      {showSameAsLast && lastPicked.current && (
        <button
          type="button"
          disabled={disabled}
          onClick={() => pick(lastPicked.current!.type, lastPicked.current!.customName)}
          className="min-h-tap w-fit rounded-pill border-2 border-dashed border-indigo-600 bg-indigo-100 px-4 text-body font-medium text-indigo-600 transition-colors duration-hover ease-brand disabled:opacity-50"
        >
          Same as last —{' '}
          {lastPicked.current.type === 'custom'
            ? lastPicked.current.customName
            : PITCH_TYPES.find((t) => t.id === lastPicked.current!.type)?.label}
        </button>
      )}

      <div className="flex flex-wrap gap-2">
        {PITCH_TYPES.map((t) => {
          const selected = value === t.id;
          if (t.id === 'custom') {
            return (
              <button
                key={t.id}
                type="button"
                disabled={disabled}
                onClick={handleCustomTap}
                aria-pressed={selected}
                className={[
                  'min-h-tap min-w-tap rounded-pill border-2 px-5 text-body font-medium transition-colors duration-hover ease-brand disabled:cursor-not-allowed disabled:opacity-50',
                  selected
                    ? 'border-indigo-600 bg-indigo-600 text-white'
                    : 'border-indigo-600 bg-transparent text-indigo-600 hover:bg-indigo-100',
                ].join(' ')}
              >
                {savedCustomName.current || t.label}
              </button>
            );
          }
          return (
            <button
              key={t.id}
              type="button"
              disabled={disabled}
              onClick={() => pick(t.id)}
              aria-pressed={selected}
              className={[
                'min-h-tap min-w-tap rounded-pill border-2 px-5 text-body font-medium transition-colors duration-hover ease-brand disabled:cursor-not-allowed disabled:opacity-50',
                selected
                  ? 'border-indigo-600 bg-indigo-600 text-white'
                  : 'border-indigo-600 bg-transparent text-indigo-600 hover:bg-indigo-100',
              ].join(' ')}
            >
              {t.label}
            </button>
          );
        })}
      </div>

      {editingCustom && (
        <div className="flex items-center gap-2">
          <input
            autoFocus
            value={customDraft}
            onChange={(e) => setCustomDraft(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && commitCustomName()}
            placeholder="Name this pitch"
            className="min-h-tap flex-1 rounded-input border border-border-strong bg-surface-1 px-3 text-body text-ink"
          />
          <button
            type="button"
            onClick={commitCustomName}
            className="min-h-tap rounded-pill bg-indigo-600 px-4 text-body font-medium text-white"
          >
            Save
          </button>
        </div>
      )}
    </div>
  );
}
