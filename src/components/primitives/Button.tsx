import { forwardRef, type ButtonHTMLAttributes } from 'react';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
type Size = 'md' | 'lg';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
}

const VARIANT_CLASSES: Record<Variant, string> = {
  primary: 'bg-indigo-600 text-white shadow-rest hover:bg-indigo-700 active:bg-indigo-900',
  secondary: 'bg-surface-1 text-indigo-600 border border-border-strong hover:bg-indigo-100',
  ghost: 'bg-transparent text-ink-secondary hover:bg-surface-2',
  danger: 'bg-coral-700 text-white hover:opacity-90',
};

const SIZE_CLASSES: Record<Size, string> = {
  md: 'px-4 text-body font-medium min-h-tap',
  lg: 'px-6 text-title font-semibold min-h-tap',
};

/**
 * The one button primitive. Every screen composes from this rather than styling
 * raw <button> elements, so tap targets and sunlight-mode sizing stay consistent.
 */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'primary', size = 'md', className = '', disabled, ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      disabled={disabled}
      className={[
        'inline-flex items-center justify-center gap-2 rounded-pill transition-colors duration-hover ease-brand',
        'disabled:cursor-not-allowed disabled:opacity-50',
        VARIANT_CLASSES[variant],
        SIZE_CLASSES[size],
        className,
      ].join(' ')}
      {...props}
    />
  );
});
