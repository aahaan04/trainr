import { useEffect, useState } from 'react';
import { useAppStore } from '@/store/appStore';
import { db, pruneClips, storageUsage } from '@/storage/db';
import type { CameraSetupRecord } from '@/domain/types';
import { PITCHING_DISTANCE_PRESETS, RULE_SETS, type RuleSetId } from '@/domain/constants';
import { Card } from '@/components/primitives/Card';
import { Pill } from '@/components/primitives/Pill';
import { Toggle } from '@/components/primitives/Toggle';
import { Button } from '@/components/primitives/Button';
import { SectionDivider } from '@/components/motif/SectionDivider';
import { useAmbientLight } from '@/components/hooks/useAmbientLight';
import { navigate } from '@/components/router';
import { useInstallPrompt } from '@/pwa/useInstallPrompt';

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(0)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(2)} GB`;
}

export function SettingsScreen() {
  const settings = useAppStore((s) => s.settings);
  const updateSettings = useAppStore((s) => s.updateSettings);
  const cameraSetup = useAppStore((s) => s.cameraSetup);
  const setCameraSetup = useAppStore((s) => s.setCameraSetup);

  const [cameraSetups, setCameraSetups] = useState<CameraSetupRecord[]>([]);
  const [usage, setUsage] = useState<{ usedBytes: number; quotaBytes: number; clipBytes: number } | null>(null);
  const { state: lightState, check: checkAmbientLight } = useAmbientLight();
  const { canInstall, installed, promptInstall } = useInstallPrompt();

  useEffect(() => {
    void db.cameraSetups.toArray().then(setCameraSetups);
    void storageUsage().then(setUsage);
  }, []);

  const refreshUsage = () => void storageUsage().then(setUsage);

  return (
    <div className="flex flex-col gap-6 px-4 py-5">
      <section className="flex flex-col gap-3">
        <h2 className="text-title font-semibold text-ink">Rule set</h2>
        <div className="flex flex-wrap gap-2">
          {RULE_SETS.map((r) => (
            <Pill
              key={r.id}
              selected={settings.ruleSet === r.id}
              onClick={() => void updateSettings({ ruleSet: r.id as RuleSetId })}
            >
              {r.label}
            </Pill>
          ))}
        </div>
        <p className="text-caption text-ink-secondary">
          {RULE_SETS.find((r) => r.id === settings.ruleSet)?.description}
        </p>
      </section>

      <SectionDivider />

      <section className="flex flex-col gap-3">
        <h2 className="text-title font-semibold text-ink">Pitching distance</h2>
        <div className="flex flex-wrap gap-2">
          {PITCHING_DISTANCE_PRESETS.map((d) => (
            <Pill
              key={d.id}
              selected={settings.pitchingDistanceFt === d.feet}
              onClick={() => void updateSettings({ pitchingDistanceFt: d.feet })}
            >
              {d.feet} ft - {d.label}
            </Pill>
          ))}
        </div>
      </section>

      <SectionDivider />

      <section className="flex flex-col gap-1">
        <h2 className="text-title font-semibold text-ink">Units</h2>
        <div className="flex gap-2">
          <Pill selected={settings.units === 'imperial'} onClick={() => void updateSettings({ units: 'imperial' })}>
            Imperial
          </Pill>
          <Pill selected={settings.units === 'metric'} onClick={() => void updateSettings({ units: 'metric' })}>
            Metric
          </Pill>
        </div>
      </section>

      <SectionDivider />

      <section className="flex flex-col">
        <h2 className="mb-1 text-title font-semibold text-ink">Display and feedback</h2>
        <Toggle
          label="Sunlight mode"
          description="Raises contrast, thickens overlays, grows tap targets for outdoor tripod use."
          checked={settings.sunlightMode}
          onChange={(v) => void updateSettings({ sunlightMode: v })}
        />
        {lightState !== 'unsupported' && (
          <div className="flex items-center gap-2 py-1">
            <Button variant="ghost" size="md" onClick={() => void checkAmbientLight()}>
              Suggest from ambient light
            </Button>
            {lightState === 'reading' && <span className="text-caption text-ink-tertiary">Reading...</span>}
            {lightState === 'bright' && <span className="text-caption text-amber-600">Bright — sunlight mode recommended</span>}
            {lightState === 'normal' && <span className="text-caption text-ink-tertiary">Normal light</span>}
            {lightState === 'denied' && <span className="text-caption text-ink-tertiary">Sensor permission denied</span>}
          </div>
        )}
        <Toggle
          label="Audio feedback"
          description="Distinct tones for strike and ball, so you don't have to look at the screen."
          checked={settings.audioFeedback}
          onChange={(v) => void updateSettings({ audioFeedback: v })}
        />
      </section>

      <SectionDivider />

      <section className="flex flex-col gap-3">
        <h2 className="text-title font-semibold text-ink">Camera setups</h2>
        <div className="flex flex-col gap-2">
          {cameraSetups.map((cs) => (
            <Card key={cs.id} className="flex items-center justify-between">
              <div className="flex flex-col">
                <span className="text-body font-medium text-ink">{cs.name}</span>
                <span className="text-caption text-ink-secondary">
                  {cs.cameras.side ? 'Dual camera' : 'Single camera'} - {cs.pitchingDistanceFt} ft
                </span>
              </div>
              <Pill selected={cameraSetup?.id === cs.id} onClick={() => setCameraSetup(cs)}>
                {cameraSetup?.id === cs.id ? 'Active' : 'Use'}
              </Pill>
            </Card>
          ))}
          {cameraSetups.length === 0 && <p className="text-body text-ink-secondary">No camera setups yet.</p>}
        </div>
        <Button variant="secondary" onClick={() => navigate('/setup')}>
          {cameraSetups.length === 0 ? 'Run setup wizard' : 'Add another camera setup'}
        </Button>
      </section>

      <SectionDivider />

      <section className="flex flex-col gap-3">
        <h2 className="text-title font-semibold text-ink">Storage</h2>
        {usage && (
          <>
            <p className="num text-body text-ink">
              {formatBytes(usage.clipBytes)} in clips
              {usage.quotaBytes > 0 && ` - ${formatBytes(usage.usedBytes)} of ${formatBytes(usage.quotaBytes)} used`}
            </p>
            <div className="flex items-center gap-3">
              <label className="flex flex-col gap-1">
                <span className="text-label uppercase text-ink-tertiary">Keep last N clips</span>
                <input
                  type="number"
                  min={0}
                  className="min-h-tap w-28 rounded-input border border-border-strong bg-surface-1 px-3 text-body text-ink"
                  value={settings.clipRetentionCount}
                  onChange={(e) => void updateSettings({ clipRetentionCount: Math.max(0, Number(e.target.value)) })}
                />
              </label>
              <Button
                variant="secondary"
                onClick={async () => {
                  await pruneClips(settings.clipRetentionCount);
                  refreshUsage();
                }}
              >
                Prune now
              </Button>
            </div>
          </>
        )}
      </section>

      <SectionDivider />

      <section className="flex flex-col gap-2">
        <h2 className="text-title font-semibold text-ink">App</h2>
        {installed ? (
          <p className="text-body text-ink-secondary">Installed as an app.</p>
        ) : canInstall ? (
          <Button variant="secondary" onClick={() => void promptInstall()}>
            Install app
          </Button>
        ) : (
          <p className="text-caption text-ink-tertiary">
            Works offline once loaded. Use your browser's "Add to Home Screen" / "Install" option if it doesn't
            appear here.
          </p>
        )}
      </section>
    </div>
  );
}
