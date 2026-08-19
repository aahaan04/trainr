import type { CameraCalibration, CameraRole, HsvGate, PlateCornerName, StrikeZone, Vec2 } from '@/domain/types';

export type WizardStepId = 'cameraSelect' | 'placement' | 'plateCorners' | 'ballColor' | 'zone' | 'lighting' | 'testPitch';

export const WIZARD_STEPS: { id: WizardStepId; label: string }[] = [
  { id: 'cameraSelect', label: 'Cameras' },
  { id: 'placement', label: 'Placement' },
  { id: 'plateCorners', label: 'Plate corners' },
  { id: 'ballColor', label: 'Ball colour' },
  { id: 'zone', label: 'Strike zone' },
  { id: 'lighting', label: 'Lighting' },
  { id: 'testPitch', label: 'Confirm' },
];

export interface WizardState {
  setupName: string;
  pitchingDistanceFt: number;
  cameraMode: 'single' | 'dual';
  deviceByRole: Partial<Record<CameraRole, string>>;
  calibrationByRole: Partial<Record<CameraRole, CameraCalibration>>;
  poseUncertaintyM: Partial<Record<CameraRole, number>>;
  hsvGate: HsvGate | null;
  negativeColorSamples: HsvGate[];
  zone: StrikeZone | null;
  lightingAcknowledged: boolean;
}

export type TappedCorners = Record<PlateCornerName, Vec2>;
