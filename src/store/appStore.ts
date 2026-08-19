/**
 * Shared app state. Foundation, not UI: capture, calibration, fusion and the UI all
 * read and write this, so it lives here rather than inside any one workstream.
 *
 * Rules for keeping this sane:
 *   - Per-frame data NEVER enters this store. Detections and frames stay in the
 *     worker. Only promoted pitches and settled status land here, or React will
 *     re-render 60 times a second and the pipeline will miss its 8 ms budget.
 *   - Persistence is Dexie's job. This store holds the live view of it.
 */

import { create } from 'zustand';
import type {
  AppSettings,
  CameraCalibration,
  CameraSetupRecord,
  PitchRecord,
  Pitcher,
  Session,
  StrikeZone,
} from '@/domain/types';
import type { CameraRole, HsvGate, PitchTypeId } from '@/domain/constants';
import { DEFAULT_SETTINGS, db, loadSettings, saveSettings } from '@/storage/db';

/** Where the capture + vision pipeline currently is. Drives the live screen's chrome. */
export type PipelineStatus = 'idle' | 'starting' | 'running' | 'degraded' | 'error';

export interface SyncState {
  connected: boolean;
  /** Achieved clock alignment in ms. Shown in the UI and warned on above 20 ms. */
  offsetMs: number | null;
  qualityMs: number | null;
  lastSyncAt: number | null;
}

interface AppState {
  settings: AppSettings;
  settingsLoaded: boolean;

  pitcher: Pitcher | null;
  session: Session | null;
  /** Newest first. The live screen's recent-pitch strip reads the head of this. */
  pitches: PitchRecord[];

  cameraSetup: CameraSetupRecord | null;
  calibrations: Partial<Record<CameraRole, CameraCalibration>>;
  hsvGate: HsvGate | null;
  zone: StrikeZone | null;

  status: PipelineStatus;
  statusDetail: string | null;
  /** Measured processing frame rate, for the performance readout. */
  fps: number;
  /** Null in single-camera mode. */
  sync: SyncState | null;

  /** Set in "call before" mode, cleared once the pitch lands. */
  intendedType: PitchTypeId | null;
  intendedTarget: { x: number; y: number } | null;

  init(): Promise<void>;
  updateSettings(patch: Partial<AppSettings>): Promise<void>;
  setPitcher(p: Pitcher | null): void;
  startSession(s: Session): Promise<void>;
  endSession(): Promise<void>;
  addPitch(p: PitchRecord): Promise<void>;
  relabelPitch(pitchId: string, type: PitchTypeId, customName?: string): Promise<void>;
  setCameraSetup(s: CameraSetupRecord | null): void;
  setCalibration(role: CameraRole, c: CameraCalibration | null): void;
  setHsvGate(g: HsvGate | null): void;
  setZone(z: StrikeZone | null): void;
  setStatus(s: PipelineStatus, detail?: string | null): void;
  setFps(n: number): void;
  setSync(s: SyncState | null): void;
  setIntent(type: PitchTypeId | null, target?: { x: number; y: number } | null): void;
}

export const useAppStore = create<AppState>((set, get) => ({
  settings: DEFAULT_SETTINGS,
  settingsLoaded: false,
  pitcher: null,
  session: null,
  pitches: [],
  cameraSetup: null,
  calibrations: {},
  hsvGate: null,
  zone: null,
  status: 'idle',
  statusDetail: null,
  fps: 0,
  sync: null,
  intendedType: null,
  intendedTarget: null,

  async init() {
    const settings = await loadSettings();
    const pitcher = settings.activePitcherId
      ? ((await db.pitchers.get(settings.activePitcherId)) ?? null)
      : null;
    const cameraSetup = settings.activeCameraSetupId
      ? ((await db.cameraSetups.get(settings.activeCameraSetupId)) ?? null)
      : null;
    set({
      settings,
      settingsLoaded: true,
      pitcher,
      cameraSetup,
      calibrations: cameraSetup?.cameras ?? {},
      hsvGate: cameraSetup?.hsvGate ?? null,
    });
    document.documentElement.dataset.sunlight = String(settings.sunlightMode);
  },

  async updateSettings(patch) {
    const settings = await saveSettings(patch);
    set({ settings });
    if ('sunlightMode' in patch) {
      document.documentElement.dataset.sunlight = String(settings.sunlightMode);
    }
  },

  setPitcher(pitcher) {
    set({ pitcher });
    void saveSettings({ activePitcherId: pitcher?.id });
  },

  async startSession(session) {
    await db.sessions.put(session);
    set({ session, pitches: [], intendedType: null, intendedTarget: null });
  },

  async endSession() {
    const { session } = get();
    if (!session) return;
    const ended = { ...session, endedAt: Date.now() };
    await db.sessions.put(ended);
    set({ session: null, pitches: [] });
  },

  async addPitch(pitch) {
    await db.pitches.put(pitch);
    set((s) => ({ pitches: [pitch, ...s.pitches], intendedType: null, intendedTarget: null }));
  },

  async relabelPitch(pitchId, type, customName) {
    const existing = await db.pitches.get(pitchId);
    if (!existing) return;
    // A manual label is ground truth and is never overwritten by a prediction.
    const next: PitchRecord = { ...existing, labeledType: type, customTypeName: customName };
    await db.pitches.put(next);
    set((s) => ({ pitches: s.pitches.map((p) => (p.id === pitchId ? next : p)) }));
  },

  setCameraSetup(cameraSetup) {
    set({
      cameraSetup,
      calibrations: cameraSetup?.cameras ?? {},
      hsvGate: cameraSetup?.hsvGate ?? null,
    });
    void saveSettings({ activeCameraSetupId: cameraSetup?.id });
  },

  setCalibration(role, c) {
    set((s) => {
      const calibrations = { ...s.calibrations };
      if (c) calibrations[role] = c;
      else delete calibrations[role];
      return { calibrations };
    });
  },

  setHsvGate(hsvGate) {
    set({ hsvGate });
  },
  setZone(zone) {
    set({ zone });
  },
  setStatus(status, statusDetail = null) {
    set({ status, statusDetail });
  },
  setFps(fps) {
    set({ fps });
  },
  setSync(sync) {
    set({ sync });
  },
  setIntent(intendedType, intendedTarget = null) {
    set({ intendedType, intendedTarget });
  },
}));
