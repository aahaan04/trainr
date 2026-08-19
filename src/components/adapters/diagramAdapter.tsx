/**
 * WS7's `src/diagram/` is complete: `<SetupDiagram/>` and `<TrajectoryRibbon/>`
 * are mounted directly (no glob/lazy indirection needed for a dependency that's
 * actually there). There is no `<SetupDiagramButton/>` export — WS7 shipped the
 * diagram itself plus `SetupDiagram`'s own `onOpenHowThisWorks` hook instead — so
 * this file adds a small trigger button, which is ours to own.
 */
import { useState, type ReactNode } from 'react';
import { SetupDiagram as RealSetupDiagram } from '@/diagram/SetupDiagram';
import { TrajectoryRibbon as RealTrajectoryRibbon, type RibbonPoint } from '@/diagram/TrajectoryRibbon';
import { navigate } from '../router';

export const SetupDiagram = RealSetupDiagram;
export const TrajectoryRibbon = RealTrajectoryRibbon;
export type { RibbonPoint };

interface SetupDiagramButtonProps {
  className?: string;
  children?: ReactNode;
}

export function SetupDiagramButton({ className = '', children = 'View setup diagram' }: SetupDiagramButtonProps) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={[
          'min-h-tap rounded-pill border-2 border-indigo-600 px-4 text-body font-medium text-indigo-600 hover:bg-indigo-100',
          className,
        ].join(' ')}
      >
        {children}
      </button>
      <RealSetupDiagram open={open} onClose={() => setOpen(false)} onOpenHowThisWorks={() => navigate('/how-it-works')} />
    </>
  );
}
