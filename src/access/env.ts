/**
 * The single place this module reads `import.meta.env`, following the same
 * pattern as `src/net/createTransport.ts`: keep the env read out of the pure
 * logic and the React wiring so both stay unit-testable without a build-time env
 * shim.
 */

export interface AccessEnv {
  /** import.meta.env.VITE_ACCESS_PASSPHRASE */
  passphrase?: string;
}

export function readAccessEnv(): AccessEnv {
  const env = import.meta.env as unknown as Record<string, string | boolean | undefined>;
  return { passphrase: env.VITE_ACCESS_PASSPHRASE as string | undefined };
}
