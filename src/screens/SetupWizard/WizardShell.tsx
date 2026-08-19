import type { ReactNode } from 'react';
import { WIZARD_STEPS, type WizardStepId } from './types';

interface WizardShellProps {
  stepId: WizardStepId;
  onCancel: () => void;
  children: ReactNode;
}

/**
 * Self-contained chrome for the wizard: progress dots + cancel. Deliberately not
 * reaching into src/components — WS6 owns shared components, this workstream owns
 * only what's under src/screens/SetupWizard.
 */
export function WizardShell({ stepId, onCancel, children }: WizardShellProps) {
  const index = WIZARD_STEPS.findIndex((s) => s.id === stepId);

  return (
    <div className="flex min-h-full flex-col bg-surface-0">
      <header className="flex items-center justify-between border-b border-border bg-surface-1 px-5 py-4">
        <div>
          <p className="text-label text-ink-secondary">Setup</p>
          <h1 className="font-display text-display-md text-ink">Camera &amp; calibration</h1>
        </div>
        <button
          type="button"
          onClick={onCancel}
          className="flex min-h-tap items-center justify-center rounded-input px-4 text-body text-ink-secondary hover:bg-surface-2"
        >
          Cancel
        </button>
      </header>

      <nav aria-label="Setup progress" className="flex items-center gap-2 overflow-x-auto border-b border-border bg-surface-1 px-5 py-3">
        {WIZARD_STEPS.map((step, i) => (
          <div key={step.id} className="flex items-center gap-2">
            <div
              className={`flex h-7 min-w-7 items-center justify-center rounded-pill px-2 text-caption font-semibold ${
                i < index
                  ? 'bg-indigo-100 text-indigo-700'
                  : i === index
                    ? 'bg-indigo-600 text-white'
                    : 'bg-surface-2 text-ink-tertiary'
              }`}
            >
              {i + 1}
            </div>
            <span className={`whitespace-nowrap text-caption ${i === index ? 'text-ink' : 'text-ink-tertiary'}`}>{step.label}</span>
            {i < WIZARD_STEPS.length - 1 && <span className="mx-1 h-px w-4 bg-border-strong" aria-hidden="true" />}
          </div>
        ))}
      </nav>

      <main className="flex-1 overflow-y-auto px-5 py-6">
        <div className="mx-auto max-w-2xl">{children}</div>
      </main>
    </div>
  );
}

interface StepFooterProps {
  onBack?: () => void;
  onNext?: () => void;
  nextLabel?: string;
  nextDisabled?: boolean;
  nextDisabledReason?: string;
}

export function StepFooter({ onBack, onNext, nextLabel = 'Continue', nextDisabled, nextDisabledReason }: StepFooterProps) {
  return (
    <div className="mt-8 flex items-center justify-between gap-3 border-t border-border pt-5">
      <button
        type="button"
        onClick={onBack}
        disabled={!onBack}
        className="flex min-h-tap items-center rounded-input px-4 text-body text-ink-secondary hover:bg-surface-2 disabled:opacity-0"
      >
        Back
      </button>
      {onNext && (
        <div className="flex flex-col items-end gap-1">
          {nextDisabled && nextDisabledReason && (
            <p className="max-w-xs text-right text-caption text-amber-600">{nextDisabledReason}</p>
          )}
          <button
            type="button"
            onClick={onNext}
            disabled={nextDisabled}
            className="flex min-h-tap items-center rounded-input bg-indigo-600 px-6 text-body font-semibold text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:bg-surface-2 disabled:text-ink-tertiary"
          >
            {nextLabel}
          </button>
        </div>
      )}
    </div>
  );
}
