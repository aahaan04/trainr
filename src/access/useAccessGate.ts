import { useCallback, useMemo, useState } from 'react';
import { clearUnlockFlag, isGateEnabled, passphraseMatches, readUnlockFlag, writeUnlockFlag } from './gate';
import { readAccessEnv } from './env';

export interface AccessGateState {
  /** Whether a passphrase is configured for this build at all. */
  enabled: boolean;
  /** Whether this device may proceed past the gate. Always true when `enabled` is false. */
  unlocked: boolean;
  /** Tries a candidate passphrase. Persists and unlocks on a match; returns whether it matched. */
  attempt: (input: string) => boolean;
  /** Clears this device's stored unlock flag and re-locks it. */
  signOut: () => void;
}

/**
 * React wiring around the pure functions in `gate.ts`. Reads the passphrase once
 * per mount (env vars don't change at runtime) and mirrors the persisted unlock
 * flag into component state so `AccessGate` re-renders on sign-in/sign-out.
 */
export function useAccessGate(): AccessGateState {
  const passphrase = useMemo(() => readAccessEnv().passphrase, []);
  const enabled = useMemo(() => isGateEnabled(passphrase), [passphrase]);

  const [unlocked, setUnlocked] = useState<boolean>(() => !enabled || readUnlockFlag(window.localStorage));

  const attempt = useCallback(
    (input: string): boolean => {
      if (!enabled) return true;
      const ok = passphraseMatches(input, passphrase ?? '');
      if (ok) {
        writeUnlockFlag(window.localStorage);
        setUnlocked(true);
      }
      return ok;
    },
    [enabled, passphrase],
  );

  const signOut = useCallback(() => {
    clearUnlockFlag(window.localStorage);
    setUnlocked(false);
  }, []);

  return { enabled, unlocked, attempt, signOut };
}
