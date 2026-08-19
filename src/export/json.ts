/**
 * Per-session JSON export. A straight, ordered dump of the pitch records — this is
 * the machine-readable counterpart to csv.ts, kept lossless rather than flattened.
 */

import type { PitchRecord, Session } from '@/domain/types';

export interface SessionExport {
  session: Session;
  pitches: PitchRecord[];
  exportedAt: string;
}

/** Session-less variant for callers that only have the pitch list on hand. */
export function pitchesToJson(pitches: readonly PitchRecord[]): string {
  return JSON.stringify(
    { pitches: [...pitches].sort((a, b) => a.sequence - b.sequence), exportedAt: new Date().toISOString() },
    null,
    2,
  );
}

export function sessionToJson(session: Session, pitches: readonly PitchRecord[]): string {
  const payload: SessionExport = {
    session,
    pitches: [...pitches].sort((a, b) => a.sequence - b.sequence),
    exportedAt: new Date().toISOString(),
  };
  return JSON.stringify(payload, null, 2);
}

export function downloadJson(session: Session, pitches: readonly PitchRecord[], filename: string): void {
  const json = sessionToJson(session, pitches);
  const blob = new Blob([json], { type: 'application/json;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
