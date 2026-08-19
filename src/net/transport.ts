/**
 * Signaling transport abstraction (Task 1).
 *
 * Two implementations, one contract:
 *   - `local`    the Node wss:// relay in server/signaling.mjs. Dev default.
 *   - `supabase` Supabase Realtime broadcast. Production default, because Vercel's
 *                serverless functions cannot hold a persistent socket, so the relay
 *                has nowhere to live there.
 *
 * The message contract is UNCHANGED. Pairing, Cristian clock sync and detection
 * relay all sit on top of `ServerMessage`/`ClientMessage` and must not be able to
 * tell which transport is underneath. This is a transport swap and nothing else.
 */

import type { ServerMessage } from './signaling';

/**
 * Identical in shape to the original `SignalingClient`, which was already the right
 * abstraction — it just had exactly one implementation. Named separately so call
 * sites express "any transport" rather than "the websocket one".
 */
export interface SignalingTransport {
  host(code: string): void;
  join(code: string): void;
  sendSignal(payload: unknown): void;
  onMessage(handler: (msg: ServerMessage) => void): () => void;
  onOpen(handler: () => void): () => void;
  onClose(handler: () => void): () => void;
  close(): void;
}

export type TransportKind = 'local' | 'supabase';

export interface TransportEnv {
  /** import.meta.env.VITE_SIGNALING_TRANSPORT */
  transport?: string;
  /** import.meta.env.VITE_SUPABASE_URL */
  supabaseUrl?: string;
  /** import.meta.env.VITE_SUPABASE_ANON_KEY */
  supabaseAnonKey?: string;
  /** import.meta.env.DEV */
  dev?: boolean;
}

export interface TransportSelection {
  kind: TransportKind;
  reason: string;
  /** False when the chosen transport cannot actually run with this config. */
  usable: boolean;
}

/**
 * Chooses a transport from env, defaulting to Supabase in production and local in
 * dev, and reports WHY. The reason string is surfaced in the pairing UI and the
 * diagnostics export: silently falling back to a transport the user did not expect
 * is how a pairing failure becomes unexplainable.
 *
 * An explicit VITE_SIGNALING_TRANSPORT always wins, including when it selects
 * something unusable — a misconfigured deploy should say so loudly rather than
 * quietly using the other transport and appearing to work locally.
 */
export function selectTransport(env: TransportEnv): TransportSelection {
  const explicit = env.transport?.trim().toLowerCase();
  const haveSupabase = !!env.supabaseUrl && !!env.supabaseAnonKey;

  if (explicit === 'local') {
    return { kind: 'local', reason: 'VITE_SIGNALING_TRANSPORT=local', usable: true };
  }
  if (explicit === 'supabase') {
    return {
      kind: 'supabase',
      reason: haveSupabase
        ? 'VITE_SIGNALING_TRANSPORT=supabase'
        : 'VITE_SIGNALING_TRANSPORT=supabase, but VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY are missing',
      usable: haveSupabase,
    };
  }
  if (explicit && explicit.length > 0) {
    return {
      kind: env.dev ? 'local' : 'supabase',
      reason: `Unrecognised VITE_SIGNALING_TRANSPORT="${explicit}"; falling back to the ${env.dev ? 'dev' : 'production'} default`,
      usable: env.dev ? true : haveSupabase,
    };
  }

  if (env.dev) {
    return { kind: 'local', reason: 'dev default: local wss:// relay', usable: true };
  }
  return {
    kind: 'supabase',
    reason: haveSupabase
      ? 'production default: Supabase Realtime'
      : 'production default is Supabase Realtime, but its env vars are not set',
    usable: haveSupabase,
  };
}

/**
 * Maps a pairing code to a Realtime channel name.
 *
 * Normalised so the same code typed in different cases reaches the same channel —
 * the code is read aloud and typed by hand, so case is not meaningful. Prefixed so
 * pairing channels occupy their own namespace and the authorization policy can
 * match on that prefix.
 */
export function channelNameForCode(code: string): string {
  return `pair:${code.trim().toUpperCase()}`;
}
