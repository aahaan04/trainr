/**
 * ICE candidate-pair inspection (Task 5).
 *
 * There is deliberately NO TURN server configured anywhere in this project
 * (`pairing.ts`'s `DEFAULT_ICE_SERVERS` is STUN-only) — a relayed connection would
 * route pairing traffic through a third party and destroy the Cristian clock-sync
 * measurements in `clockSync.ts`, the same failure mode a tunnel was rejected for
 * during the deployment audit (`docs/DEPLOYMENT_AUDIT.md`). Because nothing here
 * ever plans to add a relay, whether a session ended up relayed anyway (a
 * misconfiguration, or a browser/network quirk) must be MEASURED from
 * `RTCPeerConnection.getStats()` and surfaced, never assumed from the ICE server
 * list.
 *
 * IMPORTANT — verification status: the parsing logic below is exercised only
 * against hand-built `RTCStatsReport`-shaped fixtures in
 * `__tests__/iceStats.test.ts`. Real browsers' `getStats()` output has known
 * inconsistencies (see comments on `findSelectedPairId`) that a fixture cannot
 * catch — this module has NOT been run against a live `RTCPeerConnection` in
 * Chrome, Safari, or Firefox. Treat the browser-compatibility comments as
 * best-effort from the W3C webrtc-stats spec and public bug reports, not as
 * confirmed behavior.
 */

export type CandidateType = 'host' | 'srflx' | 'prflx' | 'relay';

/** Peer-to-peer directness inferred from the selected candidate pair. */
export type ConnectionClass = 'direct-local' | 'direct-nat' | 'relayed' | 'unknown';

export interface SelectedCandidatePair {
  local: CandidateType;
  remote: CandidateType;
}

export interface ConnectionInfo {
  /** Null when no succeeded+nominated pair could be found in the stats report. */
  pair: SelectedCandidatePair | null;
  classification: ConnectionClass;
}

/** Only the fields this module reads off an `RTCStats` dictionary, kept minimal
 *  and untyped-beyond-what's-used because the DOM lib's `RTCStats` union does not
 *  usefully discriminate on `type` the way real reports do. */
interface RawStat {
  type?: string;
  id?: string;
  state?: string;
  nominated?: boolean;
  selected?: boolean;
  selectedCandidatePairId?: string;
  localCandidateId?: string;
  remoteCandidateId?: string;
  candidateType?: string;
}

function asRaw(stat: unknown): RawStat {
  return (stat ?? {}) as RawStat;
}

function normalizeCandidateType(value: unknown): CandidateType | null {
  return value === 'host' || value === 'srflx' || value === 'prflx' || value === 'relay' ? value : null;
}

/**
 * Locates the id of the selected candidate-pair stat, trying strategies in order
 * of how reliable they're documented to be. Browser behavior differs and is only
 * partially verified here:
 *
 * 1. `transport.selectedCandidatePairId` — the standard (webrtc-stats spec) way,
 *    and reportedly what Chrome populates. NOT verified against a real Chrome
 *    build in this task.
 * 2. A `candidate-pair` stat with its own `selected: true` — the older/legacy
 *    field some engines (historically Safari/WebKit, per public WebRTC samples)
 *    set directly on the pair instead of exposing a `transport` stat. NOT
 *    verified against a real Safari build in this task.
 * 3. Fallback: any `candidate-pair` that is `state === 'succeeded'` and
 *    `nominated === true`. This is the spec-guaranteed minimum every conformant
 *    implementation should set, so it is the last resort rather than the first
 *    choice — falling back to it silently would mask a browser that never
 *    reached a nominated pair (e.g. ICE still gathering) as if it were a normal
 *    "found nothing" case, so callers should treat a (1)/(2) miss as worth
 *    logging, not just this fallback firing.
 */
function findSelectedPairId(stats: RTCStatsReport): string | null {
  for (const stat of stats.values()) {
    const raw = asRaw(stat);
    if (raw.type === 'transport' && typeof raw.selectedCandidatePairId === 'string') {
      return raw.selectedCandidatePairId;
    }
  }
  for (const stat of stats.values()) {
    const raw = asRaw(stat);
    if (raw.type === 'candidate-pair' && raw.selected === true) {
      return raw.id ?? null;
    }
  }
  for (const stat of stats.values()) {
    const raw = asRaw(stat);
    if (raw.type === 'candidate-pair' && raw.state === 'succeeded' && raw.nominated === true) {
      return raw.id ?? null;
    }
  }
  return null;
}

/**
 * Resolves the selected candidate pair's local/remote candidate *types* out of a
 * raw `RTCStatsReport`. Returns null for the degenerate case — no pair nominated
 * yet (still negotiating, or negotiation failed) — rather than guessing.
 */
export function extractSelectedCandidatePair(stats: RTCStatsReport): SelectedCandidatePair | null {
  const pairId = findSelectedPairId(stats);
  if (!pairId) return null;

  const pair = asRaw(stats.get(pairId));
  if (!pair.localCandidateId || !pair.remoteCandidateId) return null;

  const localStat = asRaw(stats.get(pair.localCandidateId));
  const remoteStat = asRaw(stats.get(pair.remoteCandidateId));
  const local = normalizeCandidateType(localStat.candidateType);
  const remote = normalizeCandidateType(remoteStat.candidateType);
  if (!local || !remote) return null;

  return { local, remote };
}

/**
 * `direct-local`: both ends are `host` candidates — same LAN, no NAT traversal.
 * `direct-nat`: `srflx`/`prflx` involved on either side but neither is `relay` —
 *   still a genuine peer-to-peer path, just discovered through STUN.
 * `relayed`: either side is `relay` — traffic is passing through a third party.
 *   Since this project ships no TURN server, this should not occur; if it does,
 *   treat it as a signal worth investigating, not routine.
 * `unknown`: no pair could be resolved (degenerate case) — never assume direct.
 */
export function classifyConnection(pair: SelectedCandidatePair | null): ConnectionClass {
  if (!pair) return 'unknown';
  if (pair.local === 'relay' || pair.remote === 'relay') return 'relayed';
  if (pair.local === 'host' && pair.remote === 'host') return 'direct-local';
  return 'direct-nat';
}

/** Convenience: extract + classify in one call against an already-fetched report. */
export function connectionInfoFromStats(stats: RTCStatsReport): ConnectionInfo {
  const pair = extractSelectedCandidatePair(stats);
  return { pair, classification: classifyConnection(pair) };
}

/**
 * Fetches `pc.getStats()` and classifies the result. This is the only function in
 * this module that touches a live `RTCPeerConnection` — it is NOT exercised by
 * the fixture-driven tests, which stop at `connectionInfoFromStats`.
 */
export async function getConnectionInfo(pc: RTCPeerConnection): Promise<ConnectionInfo> {
  const stats = await pc.getStats();
  return connectionInfoFromStats(stats);
}

/** True for anything other than a confirmed peer-to-peer path — relayed sessions
 *  and the degenerate "couldn't tell" case both count, since neither can back an
 *  honest accuracy claim. `direct-nat` is NOT suspect: it is still peer-to-peer. */
export function isConnectionSuspect(info: ConnectionInfo | null | undefined): boolean {
  if (!info) return true;
  return info.classification !== 'direct-local' && info.classification !== 'direct-nat';
}
