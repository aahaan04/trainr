import { confidenceBand, type ConfidenceBand } from '@/domain/constants';

interface ConfidenceMeterProps {
  /** Either pass a raw [0,1] score or a precomputed band; score wins if both are given. */
  score?: number;
  band?: ConfidenceBand;
  className?: string;
  showLabel?: boolean;
}

const BAND_LABEL: Record<ConfidenceBand, string> = {
  confident: 'Confident',
  tentative: 'Tentative',
  flagged: 'Flagged',
};

const BAND_LIT_COUNT: Record<ConfidenceBand, number> = {
  confident: 3,
  tentative: 2,
  flagged: 1,
};

/**
 * A three-bar tracking-confidence meter shown next to every call. Confidence is
 * NEVER hidden for a weak track — it is downgraded in presentation instead
 * (Section 16). Colour never carries this alone: the label text always renders too.
 */
export function ConfidenceMeter({ score, band, className = '', showLabel = true }: ConfidenceMeterProps) {
  const resolved = band ?? confidenceBand(score ?? 0);
  const lit = BAND_LIT_COUNT[resolved];
  const barColor =
    resolved === 'confident' ? 'bg-indigo-600' : resolved === 'tentative' ? 'bg-amber-500' : 'bg-border-strong';

  return (
    <div className={`flex items-center gap-2 ${className}`} data-confidence={resolved}>
      <div className="flex items-end gap-0.5" role="img" aria-label={`Tracking confidence: ${BAND_LABEL[resolved]}`}>
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className={[
              'w-1.5 rounded-full',
              i === 0 ? 'h-2' : i === 1 ? 'h-3' : 'h-4',
              i < lit ? barColor : 'bg-border',
            ].join(' ')}
          />
        ))}
      </div>
      {showLabel && (
        <span
          className={[
            'text-caption font-medium',
            resolved === 'confident' ? 'text-indigo-600' : resolved === 'tentative' ? 'text-amber-600' : 'text-ink-tertiary',
          ].join(' ')}
        >
          {BAND_LABEL[resolved]}
        </span>
      )}
    </div>
  );
}
