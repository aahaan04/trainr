import { useEffect, useState } from 'react';
import { useAppStore } from '@/store/appStore';
import { sessionsForPitcher } from '@/storage/db';
import type { Session } from '@/domain/types';
import { RibbonLoader } from '@/components/motif/RibbonLoader';
import { Optional, PendingPlaceholder } from '@/components/adapters/optional';
import { TrendsView } from '@/components/adapters/statsAdapter';

export function TrendsScreen() {
  const pitcher = useAppStore((s) => s.pitcher);
  const [sessions, setSessions] = useState<Session[] | null>(null);

  useEffect(() => {
    if (!pitcher) {
      setSessions(null);
      return;
    }
    void sessionsForPitcher(pitcher.id).then(setSessions);
  }, [pitcher]);

  if (!pitcher) {
    return <p className="p-6 text-body text-ink-secondary">Select a pitcher on Home to see trends.</p>;
  }
  if (sessions === null) return <RibbonLoader label="Loading trends" />;

  return (
    <div className="flex flex-col gap-4 px-4 py-5">
      <h1 className="text-title font-semibold text-ink">Trends - {pitcher.name}</h1>
      {sessions.length === 0 ? (
        <p className="text-body text-ink-secondary">No sessions yet. Trends appear across multiple sessions.</p>
      ) : (
        <Optional
          component={TrendsView}
          props={{ pitcherId: pitcher.id, sessions }}
          fallback={
            <PendingPlaceholder
              label="Cross-session trends"
              detail={`${sessions.length} session(s) recorded. Charts pending WS5 (src/stats).`}
            />
          }
        />
      )}
    </div>
  );
}
