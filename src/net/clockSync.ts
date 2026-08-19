/**
 * Cristian's algorithm over the WebRTC data channel (Section 5), plus visual flash
 * refinement. `SyncTransport` abstracts the actual channel so the estimator is
 * testable without a browser; `runCristianSync` drives the ping/pong exchange and
 * `attachPongResponder` is what the *host* runs to answer it.
 */

import { SYNC } from '@/domain/constants';
import type { ConnectionInfo } from './iceStats';

export interface SyncSample {
  /** Initiator clock at ping send. */
  t0: number;
  /** Responder clock at ping receipt / pong send. */
  t1: number;
  /** Initiator clock at pong receipt. */
  t2: number;
}

export interface SyncEstimate {
  /** Responder clock minus initiator clock, in ms: add this to the initiator's time. */
  offsetMs: number;
  /** Half the winning round trip — Cristian's algorithm's own error bound. */
  qualityMs: number;
  rttMs: number;
  sampleCount: number;
  /**
   * The ICE path this measurement actually traveled (see `iceStats.ts`). Optional
   * only because the pure estimators below (`estimateOffsetCristian`, `meanOffset`,
   * `sampleOffset`) work from timing samples alone and have no `RTCPeerConnection`
   * to inspect — they cannot know the path and must not guess it.
   *
   * Any real pairing session DOES have a `RTCPeerConnection` (via
   * `PairedChannel.getConnectionInfo()` in `pairing.ts`) and MUST attach it, e.g.
   * `{ ...estimate, connection: await channel.getConnectionInfo() }`, before the
   * estimate is stored or displayed — see `withConnection` below. A missing
   * `connection` on a displayed estimate should read as "unmeasured", never as
   * "direct"; use `isConnectionSuspect` from `iceStats.ts` on it.
   */
  connection?: ConnectionInfo;
}

/** Attaches a measured ICE path to a sync estimate. The one blessed way to join
 *  the two so the association is never silently dropped between measuring and
 *  displaying. */
export function withConnection(estimate: SyncEstimate, connection: ConnectionInfo): SyncEstimate {
  return { ...estimate, connection };
}

export function sampleOffset(s: SyncSample): { offsetMs: number; rttMs: number } {
  return { offsetMs: s.t1 - (s.t0 + s.t2) / 2, rttMs: s.t2 - s.t0 };
}

/** The min-RTT sample is kept because asymmetric queueing delay biases every other
 *  sample; the fastest round trip is the one least likely to have been delayed. */
export function estimateOffsetCristian(samples: readonly SyncSample[]): SyncEstimate {
  if (samples.length === 0) throw new Error('estimateOffsetCristian needs at least one sample');
  let best = sampleOffset(samples[0]);
  for (let i = 1; i < samples.length; i++) {
    const o = sampleOffset(samples[i]);
    if (o.rttMs < best.rttMs) best = o;
  }
  return { offsetMs: best.offsetMs, qualityMs: best.rttMs / 2, rttMs: best.rttMs, sampleCount: samples.length };
}

/** Plain mean offset, kept only as the baseline the min-RTT estimator is tested against. */
export function meanOffset(samples: readonly SyncSample[]): number {
  return samples.reduce((sum, s) => sum + sampleOffset(s).offsetMs, 0) / samples.length;
}

export interface SyncTransport {
  send(msg: unknown): void;
  /** Registers a handler for inbound messages; returns an unsubscribe function. */
  onMessage(handler: (msg: unknown) => void): () => void;
}

interface PingMsg {
  type: 'ping';
  id: number;
  t0: number;
}
interface PongMsg {
  type: 'pong';
  id: number;
  t0: number;
  t1: number;
}

function isPong(m: unknown): m is PongMsg {
  return typeof m === 'object' && m !== null && (m as { type?: unknown }).type === 'pong';
}
function isPing(m: unknown): m is PingMsg {
  return typeof m === 'object' && m !== null && (m as { type?: unknown }).type === 'ping';
}

/** Host-side responder: answers every ping immediately with its own clock reading. */
export function attachPongResponder(transport: SyncTransport, now: () => number = Date.now): () => void {
  return transport.onMessage((msg) => {
    if (!isPing(msg)) return;
    const pong: PongMsg = { type: 'pong', id: msg.id, t0: msg.t0, t1: now() };
    transport.send(pong);
  });
}

/** Initiator side: runs SYNC.PING_SAMPLES round trips and returns the estimate. */
export function runCristianSync(
  transport: SyncTransport,
  now: () => number = Date.now,
  sampleCount: number = SYNC.PING_SAMPLES,
  timeoutMs = 10_000,
): Promise<SyncEstimate> {
  return new Promise((resolve, reject) => {
    const samples: SyncSample[] = [];
    let nextId = 0;
    let unsub: () => void = () => {};

    const timer = setTimeout(() => {
      unsub();
      reject(new Error(`clock sync timed out after ${samples.length}/${sampleCount} samples`));
    }, timeoutMs);

    const sendNext = () => {
      if (samples.length >= sampleCount) {
        clearTimeout(timer);
        unsub();
        resolve(estimateOffsetCristian(samples));
        return;
      }
      const ping: PingMsg = { type: 'ping', id: nextId++, t0: now() };
      transport.send(ping);
    };

    unsub = transport.onMessage((msg) => {
      if (!isPong(msg)) return;
      const t2 = now();
      samples.push({ t0: msg.t0, t1: msg.t1, t2 });
      sendNext();
    });

    sendNext();
  });
}

/** Offset implied by both devices observing the same host-triggered screen flash. */
export function offsetFromFlash(hostFlashAtMs: number, secondaryObservedAtMs: number): number {
  return hostFlashAtMs - secondaryObservedAtMs;
}

/**
 * Flash observation is typically tighter than a network RTT/2 bound, so prefer it
 * when its assumed confidence beats the network estimate's; otherwise keep Cristian.
 * Serves both as session-start refinement and as the fallback when jitter is bad.
 */
export function refineWithFlash(
  cristian: SyncEstimate,
  flashOffsetMs: number,
  flashConfidenceMs = 5,
): SyncEstimate {
  if (flashConfidenceMs >= cristian.qualityMs) return cristian;
  return { ...cristian, offsetMs: flashOffsetMs, qualityMs: flashConfidenceMs };
}
