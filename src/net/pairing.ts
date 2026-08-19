/**
 * Session pairing (Section 5): a 6-char spoken-safe code plus a QR payload encoding
 * the same code, then a WebRTC data channel brokered by the signaling server.
 *
 * No video crosses the wire — only `RemoteDetectionPacket`s and sync ping/pongs, a
 * few hundred bytes per pitch, which is what keeps this workable on field wifi.
 *
 * QR *rendering* belongs to the UI workstream; this module only produces the string
 * a QR encoder should encode, plus the code itself.
 */

import { SYNC } from '@/domain/constants';
import type { RemoteDetectionPacket } from '@/domain/types';
import { getConnectionInfo as measureConnectionInfo, type ConnectionInfo } from './iceStats';
import type { SignalingClient } from './signaling';
import type { SyncTransport } from './clockSync';

export function generatePairingCode(
  length: number = SYNC.PAIRING_CODE_LENGTH,
  alphabet: string = SYNC.PAIRING_ALPHABET,
  rng: () => number = Math.random,
): string {
  let code = '';
  for (let i = 0; i < length; i++) {
    code += alphabet[Math.floor(rng() * alphabet.length)];
  }
  return code;
}

/** The string a QR code should encode. Falls back to a bare scheme without a host origin. */
export function pairingPayload(code: string, originUrl?: string): string {
  if (originUrl) return `${originUrl.replace(/\/$/, '')}/join?code=${code}`;
  return `trainr:pair:${code}`;
}

/** Extracts a pairing code from a scanned/typed payload, tolerant of either form. */
export function parsePairingPayload(payload: string): string | null {
  const trimmed = payload.trim();
  const bare = trimmed.match(/^trainr:pair:([A-Z0-9]{6})$/i);
  if (bare) return bare[1].toUpperCase();
  try {
    const url = new URL(trimmed);
    const code = url.searchParams.get('code');
    if (code) return code.toUpperCase();
  } catch {
    // Not a URL; fall through.
  }
  if (/^[A-Z0-9]{6}$/i.test(trimmed)) return trimmed.toUpperCase();
  return null;
}

// ---------------------------------------------------------------------------
// WebRTC data channel
// ---------------------------------------------------------------------------

type SignalPayload =
  | { kind: 'offer'; sdp: RTCSessionDescriptionInit }
  | { kind: 'answer'; sdp: RTCSessionDescriptionInit }
  | { kind: 'ice'; candidate: RTCIceCandidateInit };

type Envelope = { k: 'sync'; m: unknown } | { k: 'det'; p: RemoteDetectionPacket };

export interface PairedChannel extends SyncTransport {
  sendDetection(pkt: RemoteDetectionPacket): void;
  onDetection(handler: (pkt: RemoteDetectionPacket) => void): () => void;
  /**
   * Measures the currently-selected ICE candidate pair (Task 5, `iceStats.ts`) and
   * classifies it as direct or relayed. There is no TURN server configured
   * anywhere in this project, so this exists to VERIFY that assumption held for
   * this particular session rather than to police it — call it once the channel
   * has opened (candidates are still free to renominate later under ICE restart,
   * which this does not track). Callers pair the result with a `SyncEstimate` via
   * `withConnection` in `clockSync.ts` so no offset/quality figure is displayed
   * without knowing what path produced it.
   */
  getConnectionInfo(): Promise<ConnectionInfo>;
  close(): void;
}

function wrapDataChannel(channel: RTCDataChannel, pc: RTCPeerConnection, extraCleanup: () => void): PairedChannel {
  const syncHandlers = new Set<(msg: unknown) => void>();
  const detHandlers = new Set<(pkt: RemoteDetectionPacket) => void>();

  channel.onmessage = (ev: MessageEvent) => {
    if (typeof ev.data !== 'string') return;
    let env: Envelope;
    try {
      env = JSON.parse(ev.data) as Envelope;
    } catch {
      return;
    }
    if (env.k === 'sync') for (const h of syncHandlers) h(env.m);
    else if (env.k === 'det') for (const h of detHandlers) h(env.p);
  };

  return {
    send(msg) {
      channel.send(JSON.stringify({ k: 'sync', m: msg } satisfies Envelope));
    },
    onMessage(handler) {
      syncHandlers.add(handler);
      return () => syncHandlers.delete(handler);
    },
    sendDetection(pkt) {
      channel.send(JSON.stringify({ k: 'det', p: pkt } satisfies Envelope));
    },
    onDetection(handler) {
      detHandlers.add(handler);
      return () => detHandlers.delete(handler);
    },
    getConnectionInfo() {
      return measureConnectionInfo(pc);
    },
    close() {
      extraCleanup();
      channel.close();
    },
  };
}

export interface PairingOptions {
  iceServers?: RTCIceServer[];
  rtcFactory?: (config: RTCConfiguration) => RTCPeerConnection;
}

const DEFAULT_ICE_SERVERS: RTCIceServer[] = [{ urls: 'stun:stun.l.google.com:19302' }];

function makePeerConnection(opts: PairingOptions): RTCPeerConnection {
  const config: RTCConfiguration = { iceServers: opts.iceServers ?? DEFAULT_ICE_SERVERS };
  return opts.rtcFactory ? opts.rtcFactory(config) : new RTCPeerConnection(config);
}

/** Host side: waits for the secondary to join the room, then offers the data channel. */
export function hostPairing(signaling: SignalingClient, opts: PairingOptions = {}): Promise<PairedChannel> {
  const pc = makePeerConnection(opts);
  const channel = pc.createDataChannel('trainr', { ordered: true });

  pc.onicecandidate = (ev) => {
    if (ev.candidate) signaling.sendSignal({ kind: 'ice', candidate: ev.candidate.toJSON() } satisfies SignalPayload);
  };

  const unsubSignal = signaling.onMessage((msg) => {
    if (msg.type !== 'signal') return;
    const payload = msg.payload as SignalPayload;
    if (payload.kind === 'answer') void pc.setRemoteDescription(payload.sdp);
    else if (payload.kind === 'ice') void pc.addIceCandidate(payload.candidate);
  });

  return new Promise((resolve, reject) => {
    const unsubJoined = signaling.onMessage((msg) => {
      if (msg.type !== 'peer-joined') return;
      unsubJoined();
      void (async () => {
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        signaling.sendSignal({ kind: 'offer', sdp: offer } satisfies SignalPayload);
      })();
    });

    channel.onopen = () => resolve(wrapDataChannel(channel, pc, () => { unsubSignal(); pc.close(); }));
    channel.onerror = () => reject(new Error('pairing data channel failed to open'));
  });
}

/** Secondary side: joins the room, answers the host's offer, waits for the channel. */
export function joinPairing(signaling: SignalingClient, opts: PairingOptions = {}): Promise<PairedChannel> {
  const pc = makePeerConnection(opts);

  pc.onicecandidate = (ev) => {
    if (ev.candidate) signaling.sendSignal({ kind: 'ice', candidate: ev.candidate.toJSON() } satisfies SignalPayload);
  };

  return new Promise((resolve, reject) => {
    let unsubSignal: () => void = () => {};
    pc.ondatachannel = (ev) => {
      const channel = ev.channel;
      channel.onopen = () => resolve(wrapDataChannel(channel, pc, () => { unsubSignal(); pc.close(); }));
      channel.onerror = () => reject(new Error('pairing data channel failed to open'));
    };

    unsubSignal = signaling.onMessage((msg) => {
      if (msg.type !== 'signal') return;
      const payload = msg.payload as SignalPayload;
      if (payload.kind === 'offer') {
        void (async () => {
          await pc.setRemoteDescription(payload.sdp);
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          signaling.sendSignal({ kind: 'answer', sdp: answer } satisfies SignalPayload);
        })();
      } else if (payload.kind === 'ice') {
        void pc.addIceCandidate(payload.candidate);
      }
    });
  });
}
