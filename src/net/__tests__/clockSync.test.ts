import { describe, expect, it } from 'vitest';
import {
  attachPongResponder,
  estimateOffsetCristian,
  meanOffset,
  offsetFromFlash,
  refineWithFlash,
  runCristianSync,
  sampleOffset,
  type SyncSample,
  type SyncTransport,
} from '../clockSync';

/** Two clocks with a fixed true offset and symmetric-but-jittery one-way latency. */
function makeSimulatedPeers(trueOffsetMs: number, jitterMs: number, rand: () => number) {
  let clientNow = 0;
  const hostNow = () => clientNow + trueOffsetMs;
  const clientClock = () => clientNow;

  let clientHandler: ((msg: unknown) => void) | null = null;
  let hostHandler: ((msg: unknown) => void) | null = null;

  const oneWayDelay = () => Math.max(0, jitterMs * rand());

  const clientTransport: SyncTransport = {
    send(msg) {
      const delay = oneWayDelay();
      clientNow += delay;
      hostHandler?.(msg);
    },
    onMessage(h) {
      clientHandler = h;
      return () => {
        clientHandler = null;
      };
    },
  };
  const hostTransport: SyncTransport = {
    send(msg) {
      const delay = oneWayDelay();
      clientNow += delay;
      clientHandler?.(msg);
    },
    onMessage(h) {
      hostHandler = h;
      return () => {
        hostHandler = null;
      };
    },
  };

  return { clientTransport, hostTransport, clientClock, hostNow };
}

function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('sampleOffset / estimateOffsetCristian', () => {
  it('recovers a clean offset with zero-latency samples exactly', () => {
    const samples: SyncSample[] = [
      { t0: 1000, t1: 1050, t2: 1000 },
      { t0: 2000, t1: 2050, t2: 2000 },
    ];
    const est = estimateOffsetCristian(samples);
    expect(est.offsetMs).toBeCloseTo(50, 6);
    expect(est.rttMs).toBeCloseTo(0, 6);
  });

  it('keeps the minimum-RTT sample even when other samples are noisier', () => {
    const samples: SyncSample[] = [
      { t0: 0, t1: 40, t2: 30 }, // asymmetric, biased offset
      { t0: 0, t1: 50, t2: 100 }, // slow RTT, biased offset
      { t0: 0, t1: 51, t2: 2 }, // near-zero RTT, close to true offset 50
    ];
    const est = estimateOffsetCristian(samples);
    expect(est.rttMs).toBeCloseTo(2, 6);
    expect(est.offsetMs).toBeCloseTo(sampleOffset(samples[2]).offsetMs, 9);
  });

  it('recovers a simulated offset with jitter better via min-RTT than via the mean', () => {
    const trueOffsetMs = 37;
    const rand = mulberry32(7);
    const samples: SyncSample[] = [];
    for (let i = 0; i < 60; i++) {
      const delayOut = rand() * 15;
      const delayBack = rand() * 15;
      const t0 = i * 100;
      const t1 = t0 + delayOut + trueOffsetMs;
      const t2 = t0 + delayOut + delayBack;
      samples.push({ t0, t1, t2 });
    }
    const min = estimateOffsetCristian(samples);
    const mean = meanOffset(samples);
    expect(Math.abs(min.offsetMs - trueOffsetMs)).toBeLessThan(Math.abs(mean - trueOffsetMs));
  });
});

describe('runCristianSync end-to-end over a simulated transport', () => {
  it('converges close to the true offset with jitter present', async () => {
    const trueOffsetMs = 15;
    const rand = mulberry32(99);
    const { clientTransport, hostTransport, clientClock } = makeSimulatedPeers(trueOffsetMs, 6, rand);
    attachPongResponder(hostTransport, () => clientClock() + trueOffsetMs);
    const est = await runCristianSync(clientTransport, clientClock, 50);
    expect(Math.abs(est.offsetMs - trueOffsetMs)).toBeLessThan(6);
    expect(est.sampleCount).toBe(50);
  });

  it('rejects if the responder never answers', async () => {
    const deadTransport: SyncTransport = {
      send() {},
      onMessage() {
        return () => {};
      },
    };
    await expect(runCristianSync(deadTransport, () => 0, 5, 20)).rejects.toThrow();
  });
});

describe('visual flash refinement', () => {
  it('computes offset directly from a shared flash observation', () => {
    expect(offsetFromFlash(1000, 985)).toBe(15);
  });

  it('prefers the flash estimate when it is tighter than the network estimate', () => {
    const cristian = { offsetMs: 40, qualityMs: 25, rttMs: 50, sampleCount: 10 };
    const refined = refineWithFlash(cristian, 12, 3);
    expect(refined.offsetMs).toBe(12);
    expect(refined.qualityMs).toBe(3);
  });

  it('keeps the network estimate when the flash is not tighter', () => {
    const cristian = { offsetMs: 40, qualityMs: 2, rttMs: 4, sampleCount: 10 };
    const refined = refineWithFlash(cristian, 41, 5);
    expect(refined).toEqual(cristian);
  });
});
