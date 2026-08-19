/**
 * Every affordance that dragging/pinching/scrolling the canvas offers, duplicated
 * as real buttons — Section 15's "fully operable by keyboard alone" requirement.
 * Arrow-key/+/- handling itself lives in SetupDiagram so it works regardless of
 * which element inside the sheet has focus; these buttons call the same
 * `onStep`/`onSnap` callbacks so both paths are provably identical.
 */

import type { UnitSystem } from '@/domain/units';
import type { OrbitAction } from './project';

export type SnapTarget = 'top' | '3d' | 'cameraA';

interface DiagramControlsProps {
  onSnap: (target: SnapTarget) => void;
  onStep: (action: OrbitAction) => void;
  cameraMode: 'single' | 'dual';
  onCameraModeChange: (mode: 'single' | 'dual') => void;
  units: UnitSystem;
  onUnitsChange: (units: UnitSystem) => void;
}

function ControlButton({
  onClick,
  label,
  children,
}: {
  onClick: () => void;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className="flex min-h-tap min-w-tap items-center justify-center rounded-input border border-border bg-surface-1 text-title text-ink transition-colors duration-hover hover:bg-surface-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-indigo-600"
    >
      {children}
    </button>
  );
}

export function DiagramControls({
  onSnap,
  onStep,
  cameraMode,
  onCameraModeChange,
  units,
  onUnitsChange,
}: DiagramControlsProps) {
  return (
    <div className="space-y-4">
      <div>
        <p className="mb-2 text-label text-ink-secondary">View</p>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => onSnap('top')}
            className="min-h-tap rounded-pill bg-indigo-600 px-4 text-body font-semibold text-white transition-colors duration-hover hover:bg-indigo-700"
          >
            Top down
          </button>
          <button
            type="button"
            onClick={() => onSnap('3d')}
            className="min-h-tap rounded-pill bg-indigo-600 px-4 text-body font-semibold text-white transition-colors duration-hover hover:bg-indigo-700"
          >
            3D view
          </button>
          <button
            type="button"
            onClick={() => onSnap('cameraA')}
            className="min-h-tap rounded-pill bg-indigo-600 px-4 text-body font-semibold text-white transition-colors duration-hover hover:bg-indigo-700"
          >
            Camera A view
          </button>
        </div>
      </div>

      <div>
        <p className="mb-2 text-label text-ink-secondary">Rotate &amp; zoom</p>
        <div className="grid grid-cols-3 gap-2" style={{ maxWidth: 176 }}>
          <div />
          <ControlButton label="Rotate up" onClick={() => onStep('rotateUp')}>
            ↑
          </ControlButton>
          <div />
          <ControlButton label="Rotate left" onClick={() => onStep('rotateLeft')}>
            ←
          </ControlButton>
          <ControlButton label="Zoom in" onClick={() => onStep('zoomIn')}>
            +
          </ControlButton>
          <ControlButton label="Rotate right" onClick={() => onStep('rotateRight')}>
            →
          </ControlButton>
          <div />
          <ControlButton label="Rotate down" onClick={() => onStep('rotateDown')}>
            ↓
          </ControlButton>
          <ControlButton label="Zoom out" onClick={() => onStep('zoomOut')}>
            −
          </ControlButton>
        </div>
      </div>

      <div className="flex items-center justify-between">
        <span className="text-label text-ink-secondary">Cameras</span>
        <div role="group" aria-label="Camera mode" className="flex overflow-hidden rounded-pill border border-border">
          <button
            type="button"
            aria-pressed={cameraMode === 'single'}
            onClick={() => onCameraModeChange('single')}
            className={`min-h-tap px-3 text-body ${cameraMode === 'single' ? 'bg-indigo-600 text-white' : 'bg-surface-1 text-ink'}`}
          >
            One
          </button>
          <button
            type="button"
            aria-pressed={cameraMode === 'dual'}
            onClick={() => onCameraModeChange('dual')}
            className={`min-h-tap px-3 text-body ${cameraMode === 'dual' ? 'bg-indigo-600 text-white' : 'bg-surface-1 text-ink'}`}
          >
            Two
          </button>
        </div>
      </div>

      <div className="flex items-center justify-between">
        <span className="text-label text-ink-secondary">Units</span>
        <div role="group" aria-label="Units" className="flex overflow-hidden rounded-pill border border-border">
          <button
            type="button"
            aria-pressed={units === 'imperial'}
            onClick={() => onUnitsChange('imperial')}
            className={`min-h-tap px-3 text-body ${units === 'imperial' ? 'bg-indigo-600 text-white' : 'bg-surface-1 text-ink'}`}
          >
            ft / in
          </button>
          <button
            type="button"
            aria-pressed={units === 'metric'}
            onClick={() => onUnitsChange('metric')}
            className={`min-h-tap px-3 text-body ${units === 'metric' ? 'bg-indigo-600 text-white' : 'bg-surface-1 text-ink'}`}
          >
            metres
          </button>
        </div>
      </div>
    </div>
  );
}
