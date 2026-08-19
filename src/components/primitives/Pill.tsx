import type { ButtonHTMLAttributes } from 'react';

interface PillProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  selected?: boolean;
}

/**
 * Large selectable pill. Indigo outline at rest, filled indigo when selected —
 * NEVER coloured by category, since colour is spoken for by the strike/ball
 * semantics. Used for pitch-type-style pickers that this workstream owns; WS5's
 * actual `<PitchTypePad />` is mounted separately (Section 8.7).
 */
export function Pill({ selected = false, className = '', ...props }: PillProps) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      className={[
        'min-h-tap min-w-tap rounded-pill border-2 px-5 text-body font-medium transition-colors duration-hover ease-brand',
        selected
          ? 'border-indigo-600 bg-indigo-600 text-white'
          : 'border-indigo-600 bg-transparent text-indigo-600 hover:bg-indigo-100',
        className,
      ].join(' ')}
      {...props}
    />
  );
}
