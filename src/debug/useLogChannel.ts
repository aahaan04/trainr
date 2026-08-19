/**
 * Both halves of the log relay, as hooks.
 *
 * `useLogPublisher` runs on the device under test and streams its console into a
 * channel. `useLogSubscriber` runs on the laptop and watches that channel. Same
 * Supabase client, same Realtime infrastructure as pairing, different namespace.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { getSupabaseClient } from '@/net/supabaseTransport';
import { readTransportEnv } from '@/net/createTransport';
import { channelNameForLogs, createLogRelay, type LogEntry, type LogRelay } from './logRelay';

function clientOrNull() {
  const env = readTransportEnv();
  if (!env.supabaseUrl || !env.supabaseAnonKey) return null;
  return getSupabaseClient(env.supabaseUrl, env.supabaseAnonKey);
}

export interface PublisherState {
  active: boolean;
  reason: string;
}

/** Device side: patches console and streams to `logs:CODE`. */
export function useLogPublisher(code: string | null): PublisherState {
  const relayRef = useRef<LogRelay | null>(null);
  const [state, setState] = useState<PublisherState>({ active: false, reason: 'not started' });

  useEffect(() => {
    if (!code) {
      setState({ active: false, reason: 'no channel code' });
      return;
    }
    const client = clientOrNull();
    if (!client) {
      setState({ active: false, reason: 'Supabase env vars are not set, so logs cannot be relayed' });
      return;
    }

    const relay = createLogRelay({ client, sessionCode: code });
    relayRef.current = relay;
    const detach = relay.attach();
    setState({ active: true, reason: `streaming to ${channelNameForLogs(code)}` });
    // Announces itself so the laptop sees something immediately and can tell the
    // channel is live rather than merely quiet.
    relay.send({ level: 'info', message: `log relay attached (${navigator.userAgent})` });

    return () => {
      detach();
      relay.close();
      relayRef.current = null;
      setState({ active: false, reason: 'stopped' });
    };
  }, [code]);

  return state;
}

export interface SubscriberState {
  entries: LogEntry[];
  connected: boolean;
  reason: string;
  clear: () => void;
}

const MAX_ENTRIES = 1000;

/** Laptop side: watches `logs:CODE` and accumulates entries. */
export function useLogSubscriber(code: string | null): SubscriberState {
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const [connected, setConnected] = useState(false);
  const [reason, setReason] = useState('not started');

  const clear = useCallback(() => setEntries([]), []);

  useEffect(() => {
    setEntries([]);
    if (!code) {
      setReason('enter a channel code');
      setConnected(false);
      return;
    }
    const client = clientOrNull();
    if (!client) {
      setReason('Supabase env vars are not set');
      setConnected(false);
      return;
    }

    const channel = client.channel(channelNameForLogs(code), { config: { broadcast: { self: false } } });
    channel.on('broadcast', { event: 'log' }, (msg) => {
      const entry = (msg as { payload?: LogEntry }).payload;
      if (!entry) return;
      setEntries((prev) => {
        const next = [...prev, entry];
        return next.length > MAX_ENTRIES ? next.slice(next.length - MAX_ENTRIES) : next;
      });
    });

    void channel.subscribe((status: string) => {
      setConnected(status === 'SUBSCRIBED');
      setReason(
        status === 'SUBSCRIBED'
          ? `watching ${channelNameForLogs(code)}`
          : status === 'TIMED_OUT'
            ? 'timed out — check the Supabase URL and that Realtime is enabled'
            : status === 'CHANNEL_ERROR'
              ? 'channel error — check the anon key and the authorization policy'
              : status,
      );
    });

    return () => {
      void client.removeChannel(channel);
      setConnected(false);
    };
  }, [code]);

  return { entries, connected, reason, clear };
}
