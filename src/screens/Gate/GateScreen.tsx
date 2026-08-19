import { useState, type FormEvent } from 'react';
import { Button } from '@/components/primitives/Button';
import { Card } from '@/components/primitives/Card';
import { TextField } from '@/components/primitives/TextField';
import { RibbonMark } from '@/components/motif/RibbonMark';

interface GateScreenProps {
  /** Returns whether the candidate matched. Caller (useAccessGate) persists on a match. */
  onAttempt: (input: string) => boolean;
}

/**
 * The passphrase entry screen. Shown in place of the whole app shell whenever the
 * gate is enabled and this device has not unlocked it yet. Deliberately plain —
 * this is not a security boundary, it's a doormat, and it says so.
 */
export function GateScreen({ onAttempt }: GateScreenProps) {
  const [value, setValue] = useState('');
  const [failed, setFailed] = useState(false);

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (value.length === 0) return;
    const ok = onAttempt(value);
    if (!ok) {
      setFailed(true);
      setValue('');
    }
  }

  return (
    <div className="flex min-h-full items-center justify-center bg-surface-0 p-4">
      <Card raised className="w-full max-w-sm">
        <div className="mb-4 flex flex-col items-center gap-2 text-center">
          <RibbonMark className="h-10 w-16" tone="onLight" />
          <h1 className="text-title font-semibold text-ink">Trainr access</h1>
          <p className="text-caption text-ink-secondary">
            Enter the passphrase to continue. This only keeps out people who
            weren&apos;t sent the link — it isn&apos;t a login and it isn&apos;t
            security. See docs/ACCESS.md.
          </p>
        </div>
        <form onSubmit={handleSubmit} className="flex flex-col gap-3" noValidate>
          <TextField
            label="Passphrase"
            type="password"
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
            autoFocus
            value={value}
            onChange={(e) => {
              setValue(e.target.value);
              if (failed) setFailed(false);
            }}
          />
          {failed && (
            <p role="alert" className="text-caption text-indigo-700">
              That didn&apos;t match. Try again.
            </p>
          )}
          <Button type="submit" size="lg" disabled={value.length === 0}>
            Enter
          </Button>
        </form>
      </Card>
    </div>
  );
}
