import { isConnectionSuspect, type ConnectionInfo } from '@/net/iceStats';

interface ConnectionPathWarningProps {
  /** Result of `PairedChannel.getConnectionInfo()`. `undefined`/`null` renders the
   *  "unmeasured" warning — a session that was never checked is not the same as
   *  one confirmed direct, and must not read as safe by default. */
  connection: ConnectionInfo | null | undefined;
  className?: string;
}

/**
 * Warns when a paired session's measured ICE path is not a confirmed
 * peer-to-peer connection (Task 5). This project ships no TURN server, so a
 * `relayed` classification should not happen — if it does, or if the path
 * couldn't be measured at all, the clock-sync figures from that session are
 * suspect and must be flagged wherever they're shown, not just here.
 *
 * Amber only — this is caution, not a STRIKE/BALL call, so green and coral are
 * off limits (`src/design/tokens.ts`). Renders nothing for `direct-local` or
 * `direct-nat`, since both are genuine peer-to-peer paths.
 */
export function ConnectionPathWarning({ connection, className = '' }: ConnectionPathWarningProps) {
  if (!isConnectionSuspect(connection)) return null;

  const relayed = connection?.classification === 'relayed';

  return (
    <div
      role="status"
      data-connection-class={connection?.classification ?? 'unmeasured'}
      className={[
        'flex items-start gap-2 rounded-input border border-amber-500 bg-amber-100 px-3 py-2',
        'text-caption font-medium text-amber-600',
        className,
      ].join(' ')}
    >
      <span aria-hidden="true">⚠</span>
      <span>
        {relayed
          ? 'This session connected through a relay, not directly. Clock-sync accuracy for this session is not reliable.'
          : 'This session’s connection path could not be confirmed as direct. Treat clock-sync accuracy for this session as unverified.'}
      </span>
    </div>
  );
}

/** Short badge form for inline use next to a sync figure, e.g. in a stat tile. */
export function ConnectionPathBadge({ connection, className = '' }: ConnectionPathWarningProps) {
  if (!isConnectionSuspect(connection)) return null;
  return (
    <span
      role="img"
      aria-label="Sync accuracy suspect: connection path not confirmed direct"
      data-connection-class={connection?.classification ?? 'unmeasured'}
      className={[
        'inline-flex items-center rounded-pill border border-amber-500 bg-amber-100 px-2 py-0.5',
        'text-caption font-medium text-amber-600',
        className,
      ].join(' ')}
    >
      accuracy unconfirmed
    </span>
  );
}
