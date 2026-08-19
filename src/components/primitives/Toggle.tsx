interface ToggleProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  description?: string;
  id?: string;
}

/** A labelled switch, sized to the sunlight tap target since Settings gets used with gloves on too. */
export function Toggle({ checked, onChange, label, description, id }: ToggleProps) {
  const inputId = id ?? `toggle-${label.replace(/\s+/g, '-').toLowerCase()}`;
  return (
    <label htmlFor={inputId} className="flex min-h-tap w-full cursor-pointer items-center justify-between gap-4 py-2">
      <span className="flex flex-col">
        <span className="text-body font-medium text-ink">{label}</span>
        {description && <span className="text-caption text-ink-secondary">{description}</span>}
      </span>
      <button
        id={inputId}
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={[
          'relative h-8 w-14 shrink-0 rounded-pill transition-colors duration-hover ease-brand',
          checked ? 'bg-indigo-600' : 'bg-border-strong',
        ].join(' ')}
      >
        <span
          className={[
            'absolute top-1 h-6 w-6 rounded-pill bg-white shadow-rest transition-transform duration-hover ease-brand',
            checked ? 'translate-x-7' : 'translate-x-1',
          ].join(' ')}
        />
      </button>
    </label>
  );
}
