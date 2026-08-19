import type { InputHTMLAttributes } from 'react';

interface TextFieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
}

export function TextField({ label, id, className = '', ...props }: TextFieldProps) {
  const inputId = id ?? `field-${label.replace(/\s+/g, '-').toLowerCase()}`;
  return (
    <label htmlFor={inputId} className="flex flex-col gap-1">
      <span className="text-label uppercase text-ink-tertiary">{label}</span>
      <input
        id={inputId}
        className={[
          'min-h-tap rounded-input border border-border-strong bg-surface-1 px-3 text-body text-ink',
          'focus:outline-none focus:ring-2 focus:ring-indigo-500',
          className,
        ].join(' ')}
        {...props}
      />
    </label>
  );
}
