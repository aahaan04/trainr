import { useState } from 'react';
import { CAMERA_PLACEMENT, TWO_CAMERA_UPGRADES } from '@/domain/constants';
import type { CameraRole } from '@/domain/types';
import { SetupDiagram } from '@/diagram/SetupDiagram';
import { StepFooter } from '../WizardShell';

function PlacementCard({ role }: { role: CameraRole }) {
  const spec = CAMERA_PLACEMENT[role];
  return (
    <div className="space-y-3 rounded-card border border-border bg-surface-1 p-4">
      <div className="flex items-center justify-between">
        <h3 className="text-title text-ink">{spec.label}</h3>
        <span
          className={`rounded-pill px-3 py-1 text-caption font-semibold ${
            spec.required ? 'bg-indigo-100 text-indigo-700' : 'bg-surface-2 text-ink-secondary'
          }`}
        >
          {spec.required ? 'Required' : 'Optional'}
        </span>
      </div>
      <dl className="grid grid-cols-2 gap-2 text-body">
        <div>
          <dt className="text-caption text-ink-tertiary">Distance</dt>
          <dd className="text-ink">
            {spec.distanceFt.min}–{spec.distanceFt.max} ft (ideal {spec.distanceFt.ideal})
          </dd>
        </div>
        <div>
          <dt className="text-caption text-ink-tertiary">Lens height</dt>
          <dd className="text-ink">
            {spec.heightFt.min}–{spec.heightFt.max} ft (ideal {spec.heightFt.ideal})
          </dd>
        </div>
      </dl>
      <p className="text-body text-ink-secondary">{spec.why}</p>
      <ul className="list-disc space-y-1 pl-5 text-body text-ink-secondary">
        {spec.notes.map((n) => (
          <li key={n}>{n}</li>
        ))}
      </ul>
    </div>
  );
}

interface PlacementGuidanceStepProps {
  cameraMode: 'single' | 'dual';
  onBack: () => void;
  onNext: () => void;
}

export function PlacementGuidanceStep({ cameraMode, onBack, onNext }: PlacementGuidanceStepProps) {
  const [diagramOpen, setDiagramOpen] = useState(false);

  return (
    <div className="space-y-6">
      <div className="rounded-card border border-amber-600 bg-amber-100 p-4 text-body text-amber-600">
        <p className="font-semibold">Shooting through chain-link?</p>
        <p>
          Put the lens as close to the mesh as possible so the fence falls out of focus, or shoot through an
          opening. A fence that stays in focus will noticeably degrade ball detection.
        </p>
      </div>

      <PlacementCard role="plate" />
      {cameraMode === 'dual' && <PlacementCard role="side" />}

      {cameraMode === 'single' && (
        <div className="space-y-3 rounded-card border border-border bg-surface-2 p-4">
          <p className="text-title text-ink">What a second camera buys you</p>
          <div className="overflow-x-auto">
            <table className="w-full text-body">
              <thead>
                <tr className="text-left text-caption text-ink-tertiary">
                  <th className="py-1 pr-4">Metric</th>
                  <th className="py-1 pr-4">One camera</th>
                  <th className="py-1">Two cameras</th>
                </tr>
              </thead>
              <tbody>
                {TWO_CAMERA_UPGRADES.map((row) => (
                  <tr key={row.metric} className="border-t border-border">
                    <td className="py-1.5 pr-4 text-ink">{row.metric}</td>
                    <td className="py-1.5 pr-4 text-ink-secondary">{row.single}</td>
                    <td className="py-1.5 text-ink-secondary">{row.dual}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-caption text-ink-tertiary">
            Single-camera mode is fully functional on its own — this just shows the tradeoff plainly.
          </p>
        </div>
      )}

      <button
        type="button"
        onClick={() => setDiagramOpen(true)}
        className="min-h-tap w-full rounded-input border border-indigo-600 px-4 text-body font-semibold text-indigo-600 hover:bg-indigo-100"
      >
        Open the interactive 3D setup diagram
      </button>

      {diagramOpen && <SetupDiagram open onClose={() => setDiagramOpen(false)} />}

      <StepFooter onBack={onBack} onNext={onNext} />
    </div>
  );
}
