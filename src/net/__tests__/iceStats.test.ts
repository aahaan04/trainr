import { describe, expect, it } from 'vitest';
import {
  classifyConnection,
  connectionInfoFromStats,
  extractSelectedCandidatePair,
  isConnectionSuspect,
} from '../iceStats';

/**
 * These fixtures are hand-built `Map`s shaped like the W3C webrtc-stats spec's
 * `RTCStatsReport`. They exercise the PARSING logic only — they do NOT prove
 * anything about what a real `RTCPeerConnection.getStats()` returns on Chrome,
 * Safari, or Firefox. That remains unverified until run against real hardware;
 * see the comments on `findSelectedPairId` in `iceStats.ts` for exactly which
 * browser-specific assumptions are untested.
 */
function makeStatsReport(entries: Record<string, unknown>): RTCStatsReport {
  return new Map(Object.entries(entries)) as unknown as RTCStatsReport;
}

describe('extractSelectedCandidatePair', () => {
  it('resolves a both-host pair via transport.selectedCandidatePairId (Chrome-style)', () => {
    const stats = makeStatsReport({
      transport1: { type: 'transport', id: 'transport1', selectedCandidatePairId: 'pair1' },
      pair1: {
        type: 'candidate-pair',
        id: 'pair1',
        state: 'succeeded',
        nominated: true,
        localCandidateId: 'localA',
        remoteCandidateId: 'remoteA',
      },
      localA: { type: 'local-candidate', id: 'localA', candidateType: 'host' },
      remoteA: { type: 'remote-candidate', id: 'remoteA', candidateType: 'host' },
    });

    expect(extractSelectedCandidatePair(stats)).toEqual({ local: 'host', remote: 'host' });
  });

  it('resolves an srflx pair via the candidate-pair own `selected` flag (Safari-style fallback)', () => {
    const stats = makeStatsReport({
      pair1: {
        type: 'candidate-pair',
        id: 'pair1',
        state: 'succeeded',
        nominated: true,
        selected: true,
        localCandidateId: 'localA',
        remoteCandidateId: 'remoteA',
      },
      localA: { type: 'local-candidate', id: 'localA', candidateType: 'srflx' },
      remoteA: { type: 'remote-candidate', id: 'remoteA', candidateType: 'prflx' },
    });

    expect(extractSelectedCandidatePair(stats)).toEqual({ local: 'srflx', remote: 'prflx' });
  });

  it('resolves a relayed pair', () => {
    const stats = makeStatsReport({
      transport1: { type: 'transport', id: 'transport1', selectedCandidatePairId: 'pair1' },
      pair1: {
        type: 'candidate-pair',
        id: 'pair1',
        state: 'succeeded',
        nominated: true,
        localCandidateId: 'localA',
        remoteCandidateId: 'remoteA',
      },
      localA: { type: 'local-candidate', id: 'localA', candidateType: 'relay' },
      remoteA: { type: 'remote-candidate', id: 'remoteA', candidateType: 'host' },
    });

    expect(extractSelectedCandidatePair(stats)).toEqual({ local: 'relay', remote: 'host' });
  });

  it('falls back to a bare succeeded+nominated pair when neither transport nor selected flag is present', () => {
    const stats = makeStatsReport({
      pair1: {
        type: 'candidate-pair',
        id: 'pair1',
        state: 'succeeded',
        nominated: true,
        localCandidateId: 'localA',
        remoteCandidateId: 'remoteA',
      },
      localA: { type: 'local-candidate', id: 'localA', candidateType: 'host' },
      remoteA: { type: 'remote-candidate', id: 'remoteA', candidateType: 'srflx' },
    });

    expect(extractSelectedCandidatePair(stats)).toEqual({ local: 'host', remote: 'srflx' });
  });

  it('returns null when no pair is nominated (degenerate case: still negotiating or failed)', () => {
    const stats = makeStatsReport({
      pair1: {
        type: 'candidate-pair',
        id: 'pair1',
        state: 'in-progress',
        nominated: false,
        localCandidateId: 'localA',
        remoteCandidateId: 'remoteA',
      },
      localA: { type: 'local-candidate', id: 'localA', candidateType: 'host' },
      remoteA: { type: 'remote-candidate', id: 'remoteA', candidateType: 'host' },
    });

    expect(extractSelectedCandidatePair(stats)).toBeNull();
  });

  it('returns null against a completely empty report', () => {
    expect(extractSelectedCandidatePair(makeStatsReport({}))).toBeNull();
  });

  it('returns null when the pair references a candidate id that is missing from the report', () => {
    const stats = makeStatsReport({
      pair1: {
        type: 'candidate-pair',
        id: 'pair1',
        state: 'succeeded',
        nominated: true,
        localCandidateId: 'localA',
        remoteCandidateId: 'missing',
      },
      localA: { type: 'local-candidate', id: 'localA', candidateType: 'host' },
    });

    expect(extractSelectedCandidatePair(stats)).toBeNull();
  });
});

describe('classifyConnection', () => {
  it('classifies both-host as direct-local', () => {
    expect(classifyConnection({ local: 'host', remote: 'host' })).toBe('direct-local');
  });

  it('classifies srflx/prflx involvement as direct-nat', () => {
    expect(classifyConnection({ local: 'srflx', remote: 'host' })).toBe('direct-nat');
    expect(classifyConnection({ local: 'host', remote: 'prflx' })).toBe('direct-nat');
    expect(classifyConnection({ local: 'srflx', remote: 'prflx' })).toBe('direct-nat');
  });

  it('classifies any relay involvement as relayed, even one-sided', () => {
    expect(classifyConnection({ local: 'relay', remote: 'host' })).toBe('relayed');
    expect(classifyConnection({ local: 'host', remote: 'relay' })).toBe('relayed');
    expect(classifyConnection({ local: 'relay', remote: 'relay' })).toBe('relayed');
  });

  it('classifies the degenerate no-pair case as unknown', () => {
    expect(classifyConnection(null)).toBe('unknown');
  });
});

describe('connectionInfoFromStats', () => {
  it('bundles extraction and classification for a relayed session', () => {
    const stats = makeStatsReport({
      transport1: { type: 'transport', id: 'transport1', selectedCandidatePairId: 'pair1' },
      pair1: {
        type: 'candidate-pair',
        id: 'pair1',
        state: 'succeeded',
        nominated: true,
        localCandidateId: 'localA',
        remoteCandidateId: 'remoteA',
      },
      localA: { type: 'local-candidate', id: 'localA', candidateType: 'host' },
      remoteA: { type: 'remote-candidate', id: 'remoteA', candidateType: 'relay' },
    });

    expect(connectionInfoFromStats(stats)).toEqual({
      pair: { local: 'host', remote: 'relay' },
      classification: 'relayed',
    });
  });

  it('reports unknown with a null pair when nothing is nominated', () => {
    expect(connectionInfoFromStats(makeStatsReport({}))).toEqual({ pair: null, classification: 'unknown' });
  });
});

describe('isConnectionSuspect', () => {
  it('is not suspect for direct-local or direct-nat', () => {
    expect(isConnectionSuspect({ pair: { local: 'host', remote: 'host' }, classification: 'direct-local' })).toBe(
      false,
    );
    expect(isConnectionSuspect({ pair: { local: 'srflx', remote: 'host' }, classification: 'direct-nat' })).toBe(
      false,
    );
  });

  it('is suspect for relayed', () => {
    expect(isConnectionSuspect({ pair: { local: 'relay', remote: 'host' }, classification: 'relayed' })).toBe(true);
  });

  it('is suspect for unknown, and for missing info entirely (unmeasured is never assumed safe)', () => {
    expect(isConnectionSuspect({ pair: null, classification: 'unknown' })).toBe(true);
    expect(isConnectionSuspect(null)).toBe(true);
    expect(isConnectionSuspect(undefined)).toBe(true);
  });
});
