import { PITCH_TYPES, type PitchTypeId } from '@/domain/constants';
import { Pill } from '@/components/primitives/Pill';

interface PitchTypeRowProps {
  value: PitchTypeId | null;
  onChange: (type: PitchTypeId) => void;
  disabled?: boolean;
  className?: string;
}

/**
 * Local fallback for WS5's `<PitchTypePad/>` (Section 8.7): large pills, indigo
 * outline at rest, filled indigo when selected, never coloured by pitch type.
 * Thumb-reachable along the bottom edge of the live screen.
 */
export function PitchTypeRow({ value, onChange, disabled, className = '' }: PitchTypeRowProps) {
  return (
    <div className={`flex gap-2 overflow-x-auto px-3 py-2 ${className}`}>
      {PITCH_TYPES.filter((t) => t.id !== 'custom').map((t) => (
        <Pill
          key={t.id}
          selected={value === t.id}
          disabled={disabled}
          onClick={() => onChange(t.id)}
          className="shrink-0"
        >
          {t.short}
        </Pill>
      ))}
    </div>
  );
}
