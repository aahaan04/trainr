import type { HTMLAttributes } from 'react';

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  raised?: boolean;
  padded?: boolean;
}

/** Restrained elevation: indigo-tinted shadows only, never neutral grey. Section 8.5. */
export function Card({ raised = false, padded = true, className = '', ...props }: CardProps) {
  return (
    <div
      className={[
        'rounded-card bg-surface-1',
        raised ? 'shadow-raised' : 'shadow-rest',
        padded ? 'p-4' : '',
        className,
      ].join(' ')}
      {...props}
    />
  );
}
