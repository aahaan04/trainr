import type { ConfidenceBand } from '@/domain/constants';
import type { UnitSystem } from '@/domain/units';
import { formatSpeed } from '@/domain/units';
import { ConfidenceMeter } from './ConfidenceMeter';

interface CallReadoutProps {
  result: 'strike' | 'ball';
  speedMps: number | null;
  units: UnitSystem;
  band: ConfidenceBand;
  caveats?: string[];
  className?: string;
}

/**
 * The big call. Strike and ball share this component but never share a look:
 * strike scales up with a slight overshoot (`animate-strike-pop`), ball gets a
 * softer pulse with no overshoot (`animate-ball-pulse`) — a strike should feel
 * better than a ball (Section 8.5). Colour never carries the call alone: the word
 * STRIKE/BALL always renders as text, and a low-confidence call is downgraded in
 * presentation rather than hidden (Section 16).
 *
 * Callers should mount this with `key={pitch.id}` so React remounts it per pitch
 * and the CSS animation replays.
 */
export function CallReadout({ result, speedMps, units, band, caveats = [], className = '' }: CallReadoutProps) {
  const isStrike = result === 'strike';
  const degraded = band !== 'confident';

  return (
    <div className={`flex flex-col items-center gap-3 ${className}`} aria-live="polite">
      <div
        className={[
          'flex items-center justify-center rounded-card px-10 py-6 shadow-raised',
          isStrike ? 'bg-green-700' : 'bg-coral-700',
          isStrike ? 'animate-strike-pop' : 'animate-ball-pulse',
          degraded ? 'opacity-90' : '',
        ].join(' ')}
      >
        <span
          className={[
            'num font-display font-extrabold uppercase tracking-wide text-white',
            degraded ? 'text-display-md' : 'text-display-xl',
          ].join(' ')}
        >
          {isStrike ? 'Strike' : 'Ball'}
        </span>
      </div>

      {speedMps !== null && (
        <span className="num font-display text-display-lg font-extrabold text-ink">
          {formatSpeed(speedMps, units, 0)}
        </span>
      )}

      <ConfidenceMeter band={band} />

      {degraded && caveats.length > 0 && (
        <ul className="max-w-xs text-center text-caption text-ink-secondary">
          {caveats.map((c) => (
            <li key={c}>{c}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
