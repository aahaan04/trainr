import { SYNC } from '@/domain/constants';
import type { SyncState } from '@/store/appStore';

interface SyncBadgeProps {
  sync: SyncState;
}

/** Achieved clock sync quality in two-camera mode, with a plain warning when degraded (Section 16). */
export function SyncBadge({ sync }: SyncBadgeProps) {
  if (!sync.connected) {
    return (
      <div className="over-video rounded-pill bg-coral-700 px-3 py-1 text-caption font-medium text-white">
        Second camera disconnected
      </div>
    );
  }
  const degraded = sync.offsetMs !== null && sync.offsetMs > SYNC.WARN_OFFSET_MS;
  return (
    <div
      className={[
        'over-video rounded-pill px-3 py-1 text-caption font-medium',
        degraded ? 'bg-amber-500 text-indigo-900' : 'bg-indigo-700 text-white',
      ].join(' ')}
    >
      Sync: {sync.offsetMs !== null ? `${sync.offsetMs.toFixed(0)} ms` : 'measuring...'}
      {degraded ? ' — degraded, verify camera placement' : ''}
    </div>
  );
}
