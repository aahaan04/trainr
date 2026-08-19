/**
 * Local-first storage. IndexedDB via Dexie is the source of truth so the app works
 * with zero connectivity at a field. Cloud sync is a later phase, not a launch
 * requirement, so nothing here may assume a network.
 */

import Dexie, { type Table } from 'dexie';
import type {
  AppSettings,
  Batter,
  CameraSetupRecord,
  ClipRecord,
  Pitcher,
  PitcherModel,
  PitchRecord,
  Session,
} from '@/domain/types';
import { DEFAULT_PITCHING_DISTANCE_FT, DEFAULT_RULE_SET, STATS } from '@/domain/constants';

export class TrainrDb extends Dexie {
  pitchers!: Table<Pitcher, string>;
  batters!: Table<Batter, string>;
  cameraSetups!: Table<CameraSetupRecord, string>;
  sessions!: Table<Session, string>;
  pitches!: Table<PitchRecord, string>;
  clips!: Table<ClipRecord, string>;
  models!: Table<PitcherModel, string>;
  settings!: Table<AppSettings, string>;

  constructor(name = 'trainr') {
    super(name);
    this.version(1).stores({
      pitchers: 'id, name, createdAt',
      batters: 'id, name, createdAt',
      cameraSetups: 'id, name, updatedAt',
      sessions: 'id, pitcherId, startedAt, cameraSetupId',
      // Compound index on [sessionId+sequence] keeps in-session ordering cheap.
      pitches: 'id, sessionId, timestampMs, labeledType, [sessionId+sequence]',
      clips: 'id, sessionId, pitchId, createdAt',
      models: 'pitcherId, trainedAt',
      settings: 'id',
    });
  }
}

export const db = new TrainrDb();

export const DEFAULT_SETTINGS: AppSettings = {
  id: 'singleton',
  ruleSet: DEFAULT_RULE_SET,
  pitchingDistanceFt: DEFAULT_PITCHING_DISTANCE_FT,
  units: 'imperial',
  sunlightMode: false,
  audioFeedback: true,
  clipRetentionCount: 200,
  commandRadiusM: STATS.DEFAULT_COMMAND_RADIUS_M,
};

export async function loadSettings(): Promise<AppSettings> {
  const found = await db.settings.get('singleton');
  if (found) return { ...DEFAULT_SETTINGS, ...found };
  await db.settings.put(DEFAULT_SETTINGS);
  return DEFAULT_SETTINGS;
}

export async function saveSettings(patch: Partial<AppSettings>): Promise<AppSettings> {
  const next = { ...(await loadSettings()), ...patch, id: 'singleton' as const };
  await db.settings.put(next);
  return next;
}

export const newId = (): string =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

// ---------------------------------------------------------------------------
// Queries used across several workstreams. Kept here so nobody re-implements them.
// ---------------------------------------------------------------------------

export async function pitchesForSession(sessionId: string): Promise<PitchRecord[]> {
  const rows = await db.pitches.where('sessionId').equals(sessionId).toArray();
  return rows.sort((a, b) => a.sequence - b.sequence);
}

export async function sessionsForPitcher(pitcherId: string): Promise<Session[]> {
  const rows = await db.sessions.where('pitcherId').equals(pitcherId).toArray();
  return rows.sort((a, b) => b.startedAt - a.startedAt);
}

/** Every labelled pitch for a pitcher, across sessions. Training data for the classifier. */
export async function labeledPitchesForPitcher(pitcherId: string): Promise<PitchRecord[]> {
  const sessions = await sessionsForPitcher(pitcherId);
  const ids = new Set(sessions.map((s) => s.id));
  const rows = await db.pitches.filter((p) => ids.has(p.sessionId) && p.labeledType !== null).toArray();
  return rows.sort((a, b) => a.timestampMs - b.timestampMs);
}

export async function nextSequence(sessionId: string): Promise<number> {
  const count = await db.pitches.where('sessionId').equals(sessionId).count();
  return count + 1;
}

// ---------------------------------------------------------------------------
// Clip retention — storage is finite and the policy is user-visible.
// ---------------------------------------------------------------------------

export async function storageUsage(): Promise<{ usedBytes: number; quotaBytes: number; clipBytes: number }> {
  const clips = await db.clips.toArray();
  const clipBytes = clips.reduce((n, c) => n + c.bytes, 0);
  let usedBytes = clipBytes;
  let quotaBytes = 0;
  if (typeof navigator !== 'undefined' && navigator.storage?.estimate) {
    const est = await navigator.storage.estimate();
    usedBytes = est.usage ?? clipBytes;
    quotaBytes = est.quota ?? 0;
  }
  return { usedBytes, quotaBytes, clipBytes };
}

/** Drops oldest clips beyond the retention count. Pitch records are never deleted. */
export async function pruneClips(retain: number): Promise<number> {
  const all = await db.clips.orderBy('createdAt').toArray();
  const excess = all.length - retain;
  if (excess <= 0) return 0;
  const doomed = all.slice(0, excess).map((c) => c.id);
  await db.clips.bulkDelete(doomed);
  return doomed.length;
}

/** Deletes a session and everything hanging off it. Used by the settings screen. */
export async function deleteSessionCascade(sessionId: string): Promise<void> {
  await db.transaction('rw', db.sessions, db.pitches, db.clips, async () => {
    await db.clips.where('sessionId').equals(sessionId).delete();
    await db.pitches.where('sessionId').equals(sessionId).delete();
    await db.sessions.delete(sessionId);
  });
}
