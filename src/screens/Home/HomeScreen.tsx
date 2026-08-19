import { useEffect, useState } from 'react';
import { db, newId, sessionsForPitcher } from '@/storage/db';
import type { Pitcher, Session } from '@/domain/types';
import { RULE_SETS } from '@/domain/constants';
import { useAppStore } from '@/store/appStore';
import { Button } from '@/components/primitives/Button';
import { Card } from '@/components/primitives/Card';
import { Pill } from '@/components/primitives/Pill';
import { TextField } from '@/components/primitives/TextField';
import { SectionDivider } from '@/components/motif/SectionDivider';
import { OnboardingHero } from '@/components/motif/OnboardingHero';
import { navigate } from '@/components/router';

function formatWhen(ms: number): string {
  return new Date(ms).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function AddPitcherForm({ onAdded }: { onAdded: (p: Pitcher) => void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [handedness, setHandedness] = useState<'right' | 'left'>('right');

  if (!open) {
    return (
      <Pill onClick={() => setOpen(true)} aria-label="Add pitcher">
        + Add pitcher
      </Pill>
    );
  }

  return (
    <Card className="flex w-full max-w-sm flex-col gap-3">
      <TextField label="Name" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
      <div className="flex gap-2">
        <Pill selected={handedness === 'right'} onClick={() => setHandedness('right')} type="button">
          Right
        </Pill>
        <Pill selected={handedness === 'left'} onClick={() => setHandedness('left')} type="button">
          Left
        </Pill>
      </div>
      <div className="flex gap-2">
        <Button
          variant="primary"
          disabled={!name.trim()}
          onClick={async () => {
            const pitcher: Pitcher = { id: newId(), name: name.trim(), handedness, createdAt: Date.now() };
            await db.pitchers.put(pitcher);
            onAdded(pitcher);
            setName('');
            setOpen(false);
          }}
        >
          Save
        </Button>
        <Button variant="ghost" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </Card>
  );
}

export function HomeScreen() {
  const pitcher = useAppStore((s) => s.pitcher);
  const setPitcher = useAppStore((s) => s.setPitcher);
  const cameraSetup = useAppStore((s) => s.cameraSetup);
  const settings = useAppStore((s) => s.settings);
  const startSession = useAppStore((s) => s.startSession);

  const [pitchers, setPitchers] = useState<Pitcher[]>([]);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void db.pitchers.toArray().then(setPitchers);
  }, []);

  useEffect(() => {
    if (!pitcher) {
      setSessions([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    void sessionsForPitcher(pitcher.id).then((rows) => {
      setSessions(rows);
      setLoading(false);
    });
  }, [pitcher]);

  const openSession = sessions.find((s) => !s.endedAt);

  const beginNewSession = async () => {
    if (!pitcher) return;
    if (!cameraSetup) {
      navigate('/setup');
      return;
    }
    const session: Session = {
      id: newId(),
      pitcherId: pitcher.id,
      startedAt: Date.now(),
      cameraSetupId: cameraSetup.id,
      cameraMode: cameraSetup.cameras.side ? 'dual' : 'single',
      ruleSet: settings.ruleSet,
      pitchingDistanceFt: settings.pitchingDistanceFt,
      callBeforeMode: false,
    };
    await startSession(session);
    navigate('/live');
  };

  return (
    <div className="flex flex-col gap-6 px-4 py-5">
      {pitchers.length === 0 && (
        <section className="flex flex-col items-center gap-2 text-center">
          <OnboardingHero />
          <h1 className="text-display-md font-display font-bold text-ink">Track every pitch</h1>
          <p className="max-w-sm text-body text-ink-secondary">
            Add a pitcher to get started — velocity, calls and pitch shape from the camera you already have.
          </p>
        </section>
      )}

      <section className="flex flex-col gap-3">
        <h2 className="text-title font-semibold text-ink">Pitcher</h2>
        <div className="flex flex-wrap items-center gap-2">
          {pitchers.map((p) => (
            <Pill key={p.id} selected={pitcher?.id === p.id} onClick={() => setPitcher(p)}>
              {p.name}
            </Pill>
          ))}
          <AddPitcherForm
            onAdded={(p) => {
              setPitchers((prev) => [...prev, p]);
              setPitcher(p);
            }}
          />
        </div>
      </section>

      <SectionDivider />

      <section className="flex flex-col gap-3">
        {openSession ? (
          <Button size="lg" onClick={() => navigate('/live')} disabled={!pitcher}>
            Resume session
          </Button>
        ) : (
          <Button size="lg" onClick={() => void beginNewSession()} disabled={!pitcher}>
            Start new session
          </Button>
        )}
        {!pitcher && <p className="text-caption text-ink-secondary">Pick or add a pitcher to start a session.</p>}
        {pitcher && !cameraSetup && (
          <p className="text-caption text-ink-secondary">No camera setup yet — starting will open setup first.</p>
        )}
      </section>

      <SectionDivider />

      <section className="flex flex-col gap-3">
        <h2 className="text-title font-semibold text-ink">Recent sessions</h2>
        {!pitcher && <p className="text-body text-ink-secondary">Select a pitcher to see their sessions.</p>}
        {pitcher && loading && <p className="text-body text-ink-secondary">Loading...</p>}
        {pitcher && !loading && sessions.length === 0 && (
          <p className="text-body text-ink-secondary">No sessions yet for {pitcher.name}.</p>
        )}
        <div className="flex flex-col gap-2">
          {sessions.map((s) => (
            <Card
              key={s.id}
              className="flex cursor-pointer items-center justify-between hover:shadow-raised"
              onClick={() => navigate(`/session/${s.id}`)}
            >
              <div className="flex flex-col">
                <span className="text-body font-medium text-ink">{formatWhen(s.startedAt)}</span>
                <span className="text-caption text-ink-secondary">
                  {s.cameraMode === 'dual' ? 'Dual camera' : 'Single camera'} -{' '}
                  {RULE_SETS.find((r) => r.id === s.ruleSet)?.label ?? s.ruleSet}
                  {!s.endedAt ? ' - in progress' : ''}
                </span>
              </div>
            </Card>
          ))}
        </div>
      </section>
    </div>
  );
}
