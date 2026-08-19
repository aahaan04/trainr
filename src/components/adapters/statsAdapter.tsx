import type { IntendedPitch, PitchRecord, Session } from '@/domain/types';
import type { PitchTypeId } from '@/domain/constants';
import { lazyFromGlob, type GlobModules } from './optional';

/**
 * WS5 owns `src/stats/` and `src/classify/`. Prop shapes here are our best-effort
 * guess from the domain types and the build spec's component list (Section 8.7,
 * Section 9) — WS5's actual signatures may differ once shipped, in which case a
 * mismatch surfaces as a caught render error and this workstream's placeholder
 * shows instead of a blank screen. Assumes barrels at `src/stats/index.{ts,tsx}`
 * and `src/classify/index.{ts,tsx}`.
 */
const statsModules: GlobModules = import.meta.glob('/src/stats/index.{ts,tsx}');
const classifyModules: GlobModules = import.meta.glob('/src/classify/index.{ts,tsx}');

export interface PitchTypePadProps {
  value: PitchTypeId | null;
  onChange: (type: PitchTypeId, customName?: string) => void;
  disabled?: boolean;
  className?: string;
}

export interface IntentPickerProps {
  value: IntendedPitch | null;
  onChange: (intent: IntendedPitch) => void;
  className?: string;
}

export interface PitchListProps {
  pitches: PitchRecord[];
  className?: string;
}

export interface TrendsProps {
  pitcherId: string;
  sessions: Session[];
  className?: string;
}

export const PitchTypePad = lazyFromGlob<PitchTypePadProps>(classifyModules, 'PitchTypePad');
export const IntentPicker = lazyFromGlob<IntentPickerProps>(classifyModules, 'IntentPicker');

export const SessionSummary = lazyFromGlob<PitchListProps>(statsModules, 'SessionSummary');
export const HeatMap = lazyFromGlob<PitchListProps>(statsModules, 'HeatMap');
export const MovementProfile = lazyFromGlob<PitchListProps>(statsModules, 'MovementProfile');
export const VelocityTrend = lazyFromGlob<PitchListProps>(statsModules, 'VelocityTrend');
export const ReleaseScatter = lazyFromGlob<PitchListProps>(statsModules, 'ReleaseScatter');
export const CommandView = lazyFromGlob<PitchListProps>(statsModules, 'CommandView');
export const TrendsView = lazyFromGlob<TrendsProps>(statsModules, 'TrendsView');

/** Best-effort access to WS5's export functions; callers must treat these as possibly absent. */
export async function loadStatsExporters(): Promise<{
  exportSessionCsv?: (pitches: PitchRecord[]) => string;
  exportSessionJson?: (pitches: PitchRecord[]) => string;
} | null> {
  const paths = Object.keys(statsModules);
  if (paths.length === 0) return null;
  try {
    const mod = (await statsModules[paths[0]]()) as Record<string, unknown>;
    return {
      exportSessionCsv: typeof mod.exportSessionCsv === 'function' ? (mod.exportSessionCsv as never) : undefined,
      exportSessionJson: typeof mod.exportSessionJson === 'function' ? (mod.exportSessionJson as never) : undefined,
    };
  } catch {
    return null;
  }
}
