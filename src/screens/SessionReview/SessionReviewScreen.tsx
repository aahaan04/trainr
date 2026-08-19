import { useEffect, useMemo, useState } from 'react';
import { db, pitchesForSession } from '@/storage/db';
import type { ClipRecord, PitchRecord, Pitcher, Session } from '@/domain/types';
import { PITCH_TYPE_LABEL, RULE_SETS, confidenceBand } from '@/domain/constants';
import { formatBreak, formatSpeed } from '@/domain/units';
import { useAppStore } from '@/store/appStore';
import { Card } from '@/components/primitives/Card';
import { StatTile } from '@/components/primitives/StatTile';
import { ConfidenceMeter } from '@/components/primitives/ConfidenceMeter';
import { Button } from '@/components/primitives/Button';
import { RibbonLoader } from '@/components/motif/RibbonLoader';
import { SectionDivider } from '@/components/motif/SectionDivider';
import { Optional, PendingPlaceholder } from '@/components/adapters/optional';
import {
  CommandView,
  HeatMap,
  MovementProfile,
  ReleaseScatter,
  SessionSummary,
  VelocityTrend,
  loadStatsExporters,
} from '@/components/adapters/statsAdapter';

function downloadText(filename: string, text: string, mime: string) {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function ClipPlayer({ clip, onClose }: { clip: ClipRecord; onClose: () => void }) {
  const url = useMemo(() => URL.createObjectURL(clip.blob), [clip]);
  useEffect(() => () => URL.revokeObjectURL(url), [url]);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-indigo-900/80 p-4" onClick={onClose}>
      <div className="max-w-lg rounded-card bg-surface-1 p-3 shadow-raised" onClick={(e) => e.stopPropagation()}>
        <video src={url} controls autoPlay className="max-h-[70vh] w-full rounded-input" />
        <div className="mt-2 flex justify-end">
          <Button variant="ghost" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>
    </div>
  );
}

export function SessionReviewScreen({ sessionId }: { sessionId: string }) {
  const units = useAppStore((s) => s.settings.units);
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [pitcher, setPitcher] = useState<Pitcher | null>(null);
  const [pitches, setPitches] = useState<PitchRecord[]>([]);
  const [clips, setClips] = useState<ClipRecord[]>([]);
  const [openClip, setOpenClip] = useState<ClipRecord | null>(null);

  useEffect(() => {
    void (async () => {
      const s = (await db.sessions.get(sessionId)) ?? null;
      setSession(s);
      if (s) {
        const [p, rows, clipRows] = await Promise.all([
          db.pitchers.get(s.pitcherId),
          pitchesForSession(sessionId),
          db.clips.where('sessionId').equals(sessionId).toArray(),
        ]);
        setPitcher(p ?? null);
        setPitches(rows);
        setClips(clipRows);
      }
    })();
  }, [sessionId]);

  const clipByPitch = useMemo(() => new Map(clips.map((c) => [c.pitchId, c])), [clips]);

  const summary = useMemo(() => {
    if (pitches.length === 0) return null;
    const strikes = pitches.filter((p) => p.call.result === 'strike').length;
    const speeds = pitches.map((p) => p.call.front.speedMps);
    const avg = speeds.reduce((a, b) => a + b, 0) / speeds.length;
    const max = Math.max(...speeds);
    return { count: pitches.length, strikes, strikePct: (strikes / pitches.length) * 100, avg, max };
  }, [pitches]);

  const anyApproximate = pitches.some((p) => p.measurements.breakIsApproximate);

  const exportCsv = async () => {
    const exporters = await loadStatsExporters();
    if (exporters?.exportSessionCsv) {
      downloadText(`session-${sessionId}.csv`, exporters.exportSessionCsv(pitches), 'text/csv');
      return;
    }
    const header = 'sequence,type,result,speedMph,confidence\n';
    const rows = pitches
      .map((p) =>
        [p.sequence, p.labeledType ?? p.predictedType ?? '', p.call.result, formatSpeed(p.call.front.speedMps, units, 1), p.trackingConfidence.toFixed(2)].join(','),
      )
      .join('\n');
    downloadText(`session-${sessionId}.csv`, header + rows, 'text/csv');
  };

  const exportJson = async () => {
    const exporters = await loadStatsExporters();
    const text = exporters?.exportSessionJson ? exporters.exportSessionJson(pitches) : JSON.stringify(pitches, null, 2);
    downloadText(`session-${sessionId}.json`, text, 'application/json');
  };

  if (session === undefined) return <RibbonLoader label="Loading session" />;
  if (session === null) return <p className="p-6 text-body text-ink-secondary">Session not found.</p>;

  return (
    <div className="flex flex-col gap-6 px-4 py-5">
      <header className="flex flex-col gap-1">
        <h1 className="text-title font-semibold text-ink">{pitcher?.name ?? 'Session'}</h1>
        <p className="text-caption text-ink-secondary">
          {new Date(session.startedAt).toLocaleString()} - {session.cameraMode === 'dual' ? 'Dual camera' : 'Single camera'} -{' '}
          {RULE_SETS.find((r) => r.id === session.ruleSet)?.label}
        </p>
      </header>

      {summary && (
        <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatTile label="Pitches" value={String(summary.count)} />
          <StatTile label="Strike %" value={`${summary.strikePct.toFixed(0)}%`} sublabel={`${summary.strikes} strikes`} />
          <StatTile label="Avg velo" value={formatSpeed(summary.avg, units, 0)} />
          <StatTile label="Top velo" value={formatSpeed(summary.max, units, 0)} />
        </section>
      )}

      {anyApproximate && (
        <p className="text-caption text-ink-tertiary">
          Break figures marked * are approximate — single-camera mode measures break less accurately than a
          two-camera setup (Section 16). See "How this works" for detail.
        </p>
      )}

      <SectionDivider />

      <section className="grid gap-4 sm:grid-cols-2">
        <Optional
          component={SessionSummary}
          props={{ pitches }}
          fallback={<PendingPlaceholder label="Session summary" detail="Pending WS5 (src/stats)." />}
        />
        <Optional
          component={HeatMap}
          props={{ pitches }}
          fallback={<PendingPlaceholder label="Zone heat map" detail="Pending WS5 (src/stats)." />}
        />
        <Optional
          component={MovementProfile}
          props={{ pitches }}
          fallback={<PendingPlaceholder label="Movement profile" detail="Pending WS5 (src/stats)." />}
        />
        <Optional
          component={VelocityTrend}
          props={{ pitches }}
          fallback={<PendingPlaceholder label="Velocity trend" detail="Pending WS5 (src/stats)." />}
        />
        <Optional
          component={ReleaseScatter}
          props={{ pitches }}
          fallback={<PendingPlaceholder label="Release scatter" detail="Pending WS5 (src/stats)." />}
        />
        {session.callBeforeMode && (
          <Optional
            component={CommandView}
            props={{ pitches }}
            fallback={<PendingPlaceholder label="Command" detail="Pending WS5 (src/stats)." />}
          />
        )}
      </section>

      <SectionDivider />

      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h2 className="text-title font-semibold text-ink">Pitches</h2>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => void exportCsv()} disabled={pitches.length === 0}>
              Export CSV
            </Button>
            <Button variant="secondary" onClick={() => void exportJson()} disabled={pitches.length === 0}>
              Export JSON
            </Button>
          </div>
        </div>

        <div className="flex flex-col gap-2">
          {pitches.map((p) => {
            const clip = clipByPitch.get(p.id);
            const label = p.labeledType ? PITCH_TYPE_LABEL[p.labeledType] : p.predictedType ? PITCH_TYPE_LABEL[p.predictedType] : 'Unlabeled';
            return (
              <Card key={p.id} className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <span
                    className={[
                      'num rounded-input px-2 py-1 text-caption font-semibold uppercase text-white',
                      p.call.result === 'strike' ? 'bg-green-700' : 'bg-coral-700',
                    ].join(' ')}
                  >
                    {p.call.result}
                  </span>
                  <div className="flex flex-col">
                    <span className="text-body font-medium text-ink">
                      #{p.sequence} - {label}
                    </span>
                    <span className="num text-caption text-ink-secondary">
                      {formatSpeed(p.call.front.speedMps, units, 1)}
                      {p.measurements.breakIsApproximate ? ' - break approx.*' : ` - ${formatBreak(p.measurements.totalBreakM, units)} break`}
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <ConfidenceMeter band={confidenceBand(p.trackingConfidence)} showLabel={false} />
                  {clip && (
                    <Button variant="ghost" size="md" onClick={() => setOpenClip(clip)}>
                      Clip
                    </Button>
                  )}
                </div>
              </Card>
            );
          })}
          {pitches.length === 0 && <p className="text-body text-ink-secondary">No pitches recorded yet.</p>}
        </div>
      </section>

      {openClip && <ClipPlayer clip={openClip} onClose={() => setOpenClip(null)} />}
    </div>
  );
}
