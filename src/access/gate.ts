/**
 * Pure logic for the shared-passphrase access gate (Task 4).
 *
 * This gate is obscurity, not security — see docs/ACCESS.md for the full
 * reasoning. `VITE_ACCESS_PASSPHRASE` ships in the JS bundle and anyone who views
 * source can read it. Nothing in this module is designed to withstand someone who
 * opens dev tools; it exists only to keep the "wrong link, wrong person" case out
 * of the app, and to make an unprotected production deploy visible rather than
 * silent.
 *
 * Every function here is pure and takes its inputs as arguments — no direct
 * `window`, `localStorage`, or `import.meta.env` reads — so this file is unit
 * testable under plain Node with no jsdom/browser shim. `useAccessGate.ts` is the
 * thin React/browser wiring layered on top; `env.ts` is the one place that reads
 * `import.meta.env`.
 */

/** localStorage key. Namespaced like the rest of the app's client-side flags (see `src/devtools.ts`). */
export const ACCESS_STORAGE_KEY = 'trainr:access-unlocked';

const UNLOCK_VALUE = '1';

/**
 * The gate is enabled only when a non-blank passphrase is configured. An unset or
 * whitespace-only `VITE_ACCESS_PASSPHRASE` means the gate is OPEN — a missing env
 * var must never block local dev — but the caller (`GateStatusBadge`) is
 * responsible for saying so plainly in the UI, so a production deploy that forgot
 * to set the var is an obvious visible state rather than a silent one.
 */
export function isGateEnabled(passphrase: string | undefined | null): boolean {
  return typeof passphrase === 'string' && passphrase.trim().length > 0;
}

/**
 * Compares a candidate against the configured passphrase without an early-exit
 * character loop. This buys essentially nothing — the comparison, the
 * passphrase, and the compiled code are all sitting in the same client-side JS
 * bundle the "attacker" already has open in dev tools — but a naive `input ===
 * expected` is a needless tell, and there is no cost to not writing it that way.
 * Still reveals length via the initial check; hiding that too would mean padding
 * every comparison to a fixed size, which is not worth it for a client-side gate.
 */
export function passphraseMatches(input: string, expected: string): boolean {
  if (input.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) {
    diff |= input.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  return diff === 0;
}

/** Minimal storage contract so persistence logic is testable without a DOM. */
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** True once this device has successfully entered the passphrase and not signed out since. */
export function readUnlockFlag(storage: StorageLike): boolean {
  return storage.getItem(ACCESS_STORAGE_KEY) === UNLOCK_VALUE;
}

/** Persists a successful entry so the iPad does not re-prompt on every load. */
export function writeUnlockFlag(storage: StorageLike): void {
  storage.setItem(ACCESS_STORAGE_KEY, UNLOCK_VALUE);
}

/** Signs this device out, forcing the gate to prompt again next load. */
export function clearUnlockFlag(storage: StorageLike): void {
  storage.removeItem(ACCESS_STORAGE_KEY);
}
