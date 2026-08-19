/**
 * LIVE integration test for the Supabase Realtime transport.
 *
 * This file exists because the `ws://` mixed-content bug reached a state where every
 * unit test passed and pairing was broken on every device. Those tests injected a
 * fake socket, so they proved the message contract and nothing about the wire. A
 * mock cannot tell you that a channel name is rejected by an authorization policy,
 * that presence never syncs, or that the anon key lacks Realtime permission.
 *
 * So this test talks to a REAL Supabase project over a REAL channel and drives the
 * full handshake both ways.
 *
 * It SKIPS when credentials are absent, and the skip is loud rather than silent —
 * a skipped integration test that looks like a pass is how this class of bug
 * survives. When skipped, the Supabase transport is UNVERIFIED and the deployment
 * report must say so.
 *
 * Run with:
 *   SUPABASE_URL=... SUPABASE_ANON_KEY=... npx vitest run src/net/__tests__/supabaseTransport.live.test.ts
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ServerMessage } from '../signaling';
import { createSupabaseTransport, resetSupabaseClient } from '../supabaseTransport';
import type { SignalingTransport } from '../transport';

const URL_ = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_ANON_KEY;
const configured = !!URL_ && !!KEY;

if (!configured) {
  // eslint-disable-next-line no-console
  console.warn(
    '\n  [UNVERIFIED] Supabase live signaling test SKIPPED — SUPABASE_URL / SUPABASE_ANON_KEY not set.\n' +
      '  The Supabase transport has NOT been exercised against a real channel.\n' +
      '  Every other test in src/net uses an injected socket and cannot detect a wire-level fault.\n',
  );
}

/** Node 18 has no global WebSocket; realtime-js needs one. */
async function ensureWebSocket(): Promise<void> {
  if (typeof (globalThis as { WebSocket?: unknown }).WebSocket === 'undefined') {
    const ws = await import('ws');
    (globalThis as { WebSocket?: unknown }).WebSocket = ws.default ?? ws.WebSocket;
  }
}

function collect(t: SignalingTransport): ServerMessage[] {
  const seen: ServerMessage[] = [];
  t.onMessage((m) => seen.push(m));
  return seen;
}

/** Polls until `pred` holds or the timeout expires, so slow networks do not flake. */
async function waitFor(pred: () => boolean, timeoutMs = 15000, label = 'condition'): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (pred()) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`Timed out after ${timeoutMs}ms waiting for ${label}`);
}

describe.skipIf(!configured)('Supabase Realtime transport, against a live channel', () => {
  const code = `T${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
  let host: SignalingTransport;
  let peer: SignalingTransport;
  let hostSeen: ServerMessage[];
  let peerSeen: ServerMessage[];

  beforeAll(async () => {
    await ensureWebSocket();
    resetSupabaseClient();
    host = createSupabaseTransport({ url: URL_!, anonKey: KEY! });
    peer = createSupabaseTransport({ url: URL_!, anonKey: KEY! });
    hostSeen = collect(host);
    peerSeen = collect(peer);
  });

  afterAll(() => {
    host?.close();
    peer?.close();
    resetSupabaseClient();
  });

  it('connects and reports the host as hosted', async () => {
    host.host(code);
    await waitFor(() => hostSeen.some((m) => m.type === 'hosted'), 15000, 'hosted');
    expect(hostSeen.map((m) => m.type)).toContain('hosted');
  });

  it('sees the peer join, from both sides', async () => {
    peer.join(code);
    await waitFor(() => peerSeen.some((m) => m.type === 'joined'), 15000, 'joined');
    await waitFor(() => hostSeen.some((m) => m.type === 'peer-joined'), 15000, 'peer-joined');

    // The joiner must NOT be told the session is missing when a host is present.
    expect(peerSeen.find((m) => m.type === 'error')).toBeUndefined();
  });

  it('relays a signal payload host -> peer', async () => {
    host.sendSignal({ sdp: 'offer-from-host' });
    await waitFor(
      () => peerSeen.some((m) => m.type === 'signal' && (m.payload as { sdp?: string })?.sdp === 'offer-from-host'),
      15000,
      'host->peer signal',
    );
  });

  it('relays a signal payload peer -> host', async () => {
    peer.sendSignal({ sdp: 'answer-from-peer' });
    await waitFor(
      () => hostSeen.some((m) => m.type === 'signal' && (m.payload as { sdp?: string })?.sdp === 'answer-from-peer'),
      15000,
      'peer->host signal',
    );
  });

  it('never echoes a peer its own signal', () => {
    // broadcast self:false. If this regresses, each side answers its own offer and
    // the peer connection negotiation deadlocks in a way that looks like a network
    // fault rather than a config error.
    expect(hostSeen.filter((m) => m.type === 'signal' && (m.payload as { sdp?: string })?.sdp === 'offer-from-host')).toHaveLength(0);
  });

  it('tells the host when the peer leaves', async () => {
    peer.close();
    await waitFor(() => hostSeen.some((m) => m.type === 'peer-left'), 20000, 'peer-left');
  });
});

describe.skipIf(!configured)('a joiner with no host present', () => {
  it('is told the session does not exist', async () => {
    await ensureWebSocket();
    const lonely = createSupabaseTransport({ url: URL_!, anonKey: KEY! });
    const seen = collect(lonely);
    lonely.join(`X${Math.random().toString(36).slice(2, 7).toUpperCase()}`);
    await waitFor(
      () => seen.some((m) => m.type === 'error' && m.message === 'session not found'),
      15000,
      'session not found',
    );
    lonely.close();
  });
});
