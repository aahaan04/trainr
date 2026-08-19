/**
 * Supabase Realtime implementation of SignalingTransport.
 *
 * The local relay is a server that knows about rooms; Realtime is a pub/sub bus that
 * does not. The room semantics the rest of the app depends on — "you are the host",
 * "a peer joined", "the peer left", "that code is already in use", "no such
 * session" — are therefore reconstructed on the client from Realtime PRESENCE,
 * while the SDP/ICE payloads ride BROADCAST.
 *
 * Presence is the right primitive for membership because it is the only one that
 * survives a peer vanishing without saying goodbye: a backgrounded iPad or a device
 * that walks out of wifi range never sends a leave message, and a membership scheme
 * built on explicit messages would leave the host waiting forever. Presence expires
 * such a peer on its own.
 *
 * Emitted messages are byte-identical to the relay's, so nothing downstream can tell
 * which transport is underneath.
 */

import { createClient, type RealtimeChannel, type SupabaseClient } from '@supabase/supabase-js';
import type { ServerMessage } from './signaling';
import { channelNameForCode, type SignalingTransport } from './transport';

export type PeerRole = 'host' | 'peer';

interface PresenceState {
  role: PeerRole;
  joinedAt: number;
}

export interface SupabaseTransportOptions {
  url: string;
  anonKey: string;
  /** Injected in tests; otherwise a client is created from url/anonKey. */
  client?: SupabaseClient;
}

let sharedClient: SupabaseClient | null = null;

/**
 * One client per page. Realtime multiplexes channels over a single socket, so
 * creating a client per pairing attempt would open redundant sockets and make the
 * connection-count limits on the free tier bite far sooner than they need to.
 */
export function getSupabaseClient(url: string, anonKey: string): SupabaseClient {
  if (!sharedClient) {
    sharedClient = createClient(url, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      realtime: { params: { eventsPerSecond: 40 } },
    });
  }
  return sharedClient;
}

/** Test seam: drops the memoised client so a test can install its own. */
export function resetSupabaseClient(): void {
  sharedClient = null;
}

export function createSupabaseTransport(opts: SupabaseTransportOptions): SignalingTransport {
  const client = opts.client ?? getSupabaseClient(opts.url, opts.anonKey);

  const messageHandlers = new Set<(msg: ServerMessage) => void>();
  const openHandlers = new Set<() => void>();
  const closeHandlers = new Set<() => void>();

  let channel: RealtimeChannel | null = null;
  let myRole: PeerRole | null = null;
  let closed = false;
  /** Guards against re-emitting peer-joined on every presence resync. */
  let peerPresent = false;
  let announcedMembership = false;

  const emit = (msg: ServerMessage) => {
    for (const h of messageHandlers) h(msg);
  };

  function otherRole(): PeerRole {
    return myRole === 'host' ? 'peer' : 'host';
  }

  /** Flattens Realtime's presence map into the roles currently occupying the room. */
  function rolesPresent(ch: RealtimeChannel): PeerRole[] {
    const state = ch.presenceState<PresenceState>();
    const roles: PeerRole[] = [];
    for (const entries of Object.values(state)) {
      for (const e of entries) {
        if (e.role === 'host' || e.role === 'peer') roles.push(e.role);
      }
    }
    return roles;
  }

  function handlePresenceSync(ch: RealtimeChannel) {
    const roles = rolesPresent(ch);
    const others = roles.filter((r) => r === otherRole()).length;

    if (myRole === 'peer' && !announcedMembership) {
      // The joiner learns whether the session exists purely from whether a host is
      // already present, which is what the relay's room registry used to answer.
      announcedMembership = true;
      if (others > 0) {
        emit({ type: 'joined' });
      } else {
        emit({ type: 'error', message: 'session not found' });
      }
      return;
    }

    if (myRole === 'host') {
      if (!announcedMembership) {
        announcedMembership = true;
        // A second host on the same code is the "code already in use" case.
        if (roles.filter((r) => r === 'host').length > 1) {
          emit({ type: 'error', message: 'code already in use' });
          return;
        }
        emit({ type: 'hosted' });
      }
      if (others > 0 && !peerPresent) {
        peerPresent = true;
        emit({ type: 'peer-joined' });
      } else if (others === 0 && peerPresent) {
        peerPresent = false;
        emit({ type: 'peer-left' });
      }
      return;
    }

    // Joiner watching for the host disappearing mid-session.
    if (myRole === 'peer') {
      if (others > 0) {
        peerPresent = true;
      } else if (peerPresent) {
        peerPresent = false;
        emit({ type: 'peer-left' });
      }
    }
  }

  function connect(code: string, role: PeerRole) {
    myRole = role;
    const ch = client.channel(channelNameForCode(code), {
      config: {
        // self:false so a peer never receives its own broadcast, matching the
        // relay, which only ever forwarded to the OTHER party.
        broadcast: { self: false },
        presence: { key: `${role}-${Math.random().toString(36).slice(2, 10)}` },
      },
    });
    channel = ch;

    ch.on('broadcast', { event: 'signal' }, (payload) => {
      emit({ type: 'signal', payload: (payload as { payload?: { payload?: unknown } }).payload?.payload });
    });
    ch.on('presence', { event: 'sync' }, () => handlePresenceSync(ch));
    ch.on('presence', { event: 'join' }, () => handlePresenceSync(ch));
    ch.on('presence', { event: 'leave' }, () => handlePresenceSync(ch));

    void ch.subscribe(async (status: string) => {
      if (status === 'SUBSCRIBED') {
        for (const h of openHandlers) h();
        await ch.track({ role, joinedAt: Date.now() } satisfies PresenceState);
      } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        emit({
          type: 'error',
          message:
            status === 'TIMED_OUT'
              ? 'Realtime connection timed out. Check the Supabase URL and that Realtime is enabled.'
              : 'Realtime channel error. Check the anon key and the channel authorization policy.',
        });
      } else if (status === 'CLOSED' && !closed) {
        for (const h of closeHandlers) h();
      }
    });
  }

  return {
    host(code) {
      connect(code, 'host');
    },
    join(code) {
      connect(code, 'peer');
    },
    sendSignal(payload) {
      void channel?.send({ type: 'broadcast', event: 'signal', payload: { payload } });
    },
    onMessage(handler) {
      messageHandlers.add(handler);
      return () => messageHandlers.delete(handler);
    },
    onOpen(handler) {
      openHandlers.add(handler);
      return () => openHandlers.delete(handler);
    },
    onClose(handler) {
      closeHandlers.add(handler);
      return () => closeHandlers.delete(handler);
    },
    close() {
      closed = true;
      const ch = channel;
      channel = null;
      if (ch) {
        void ch.untrack().then(() => client.removeChannel(ch));
      }
      for (const h of closeHandlers) h();
    },
  };
}
