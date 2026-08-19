/**
 * The single place the app obtains a signaling transport. Keeps `import.meta.env`
 * out of the transport implementations so both stay unit-testable.
 */

import { createSignalingClient, defaultSignalingUrl } from './signaling';
import { createSupabaseTransport } from './supabaseTransport';
import { selectTransport, type SignalingTransport, type TransportEnv, type TransportSelection } from './transport';

export interface CreatedTransport {
  transport: SignalingTransport | null;
  selection: TransportSelection;
}

export function readTransportEnv(): TransportEnv {
  const env = import.meta.env as unknown as Record<string, string | boolean | undefined>;
  return {
    transport: env.VITE_SIGNALING_TRANSPORT as string | undefined,
    supabaseUrl: env.VITE_SUPABASE_URL as string | undefined,
    supabaseAnonKey: env.VITE_SUPABASE_ANON_KEY as string | undefined,
    dev: !!env.DEV,
  };
}

/**
 * Returns a transport plus the selection reason. `transport` is null when the
 * selected transport is unusable — the caller surfaces `selection.reason` rather
 * than silently substituting the other one, so a misconfigured deploy is legible
 * instead of mysteriously half-working.
 */
export function createTransport(env: TransportEnv = readTransportEnv()): CreatedTransport {
  const selection = selectTransport(env);
  if (!selection.usable) return { transport: null, selection };

  if (selection.kind === 'supabase') {
    return {
      transport: createSupabaseTransport({ url: env.supabaseUrl!, anonKey: env.supabaseAnonKey! }),
      selection,
    };
  }
  return { transport: createSignalingClient(defaultSignalingUrl()), selection };
}
