/**
 * Section 3 setup wizard entry point. Owned entirely by this workstream; the app
 * shell (src/screens/Setup/SetupScreen.tsx, WS6) only routes to this default
 * export via src/components/adapters/setupWizardAdapter.tsx and never reaches
 * inside it.
 *
 * Step order per spec: camera selection -> placement guidance -> plate corner tap
 * -> ball color sample -> zone setup -> lighting check -> test pitch confirmation.
 * The final step is a hard gate: `computeBlockers` in TestPitchStep.tsx must be
 * empty before `onStart` is reachable, so a session can never begin on a
 * calibration this wizard already knows is bad.
 */

import { useState } from 'react';
import type { CameraRole, CameraSetupRecord } from '@/domain/types';
import { DEFAULT_PITCHING_DISTANCE_FT, DEFAULT_RULE_SET, type RuleSetId } from '@/domain/constants';
import { db, newId } from '@/storage/db';
import { useAppStore } from '@/store/appStore';
import { WizardShell } from './WizardShell';
import type { WizardState, WizardStepId } from './types';
import { CameraSelectionStep } from './steps/CameraSelectionStep';
import { PlacementGuidanceStep } from './steps/PlacementGuidanceStep';
import { PlateCornerTapStep } from './steps/PlateCornerTapStep';
import { BallColorSampleStep } from './steps/BallColorSampleStep';
import { ZoneSetupStep } from './steps/ZoneSetupStep';
import { LightingCheckStep } from './steps/LightingCheckStep';
import { TestPitchStep } from './steps/TestPitchStep';

export interface SetupWizardProps {
  onComplete?: () => void;
  onCancel?: () => void;
}

const INITIAL_STATE: WizardState = {
  setupName: '',
  pitchingDistanceFt: DEFAULT_PITCHING_DISTANCE_FT,
  cameraMode: 'single',
  deviceByRole: {},
  calibrationByRole: {},
  poseUncertaintyM: {},
  hsvGate: null,
  negativeColorSamples: [],
  zone: null,
  lightingAcknowledged: false,
};

export default function SetupWizard({ onComplete, onCancel }: SetupWizardProps) {
  const settings = useAppStore((s) => s.settings);
  const setCameraSetup = useAppStore((s) => s.setCameraSetup);
  const setZone = useAppStore((s) => s.setZone);
  const updateSettings = useAppStore((s) => s.updateSettings);

  const [step, setStep] = useState<WizardStepId>('cameraSelect');
  const [ruleSet, setRuleSet] = useState<RuleSetId>(settings.ruleSet ?? DEFAULT_RULE_SET);
  const [state, setState] = useState<WizardState>({
    ...INITIAL_STATE,
    pitchingDistanceFt: settings.pitchingDistanceFt || DEFAULT_PITCHING_DISTANCE_FT,
  });

  function patch(p: Partial<WizardState>) {
    setState((s) => ({ ...s, ...p }));
  }

  const roles: CameraRole[] = state.cameraMode === 'dual' ? ['plate', 'side'] : ['plate'];

  async function finish() {
    const record: CameraSetupRecord = {
      id: newId(),
      name: state.setupName.trim() || 'Untitled setup',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      pitchingDistanceFt: state.pitchingDistanceFt,
      cameras: state.calibrationByRole,
      hsvGate: state.hsvGate!,
      negativeColorSamples: state.negativeColorSamples,
    };
    await db.cameraSetups.put(record);
    setCameraSetup(record);
    if (state.zone) setZone(state.zone);
    await updateSettings({ ruleSet, pitchingDistanceFt: state.pitchingDistanceFt });
    onComplete?.();
  }

  const cancel = () => onCancel?.();

  return (
    <WizardShell stepId={step} onCancel={cancel}>
      {step === 'cameraSelect' && (
        <CameraSelectionStep
          state={state}
          ruleSet={ruleSet}
          onRuleSetChange={setRuleSet}
          onChange={patch}
          onNext={() => setStep('placement')}
        />
      )}

      {step === 'placement' && (
        <PlacementGuidanceStep cameraMode={state.cameraMode} onBack={() => setStep('cameraSelect')} onNext={() => setStep('plateCorners')} />
      )}

      {step === 'plateCorners' && (
        <PlateCornerTapStep
          roles={roles}
          deviceByRole={state.deviceByRole}
          existing={state.calibrationByRole}
          onRoleCalibrated={(role, calibration, uncertaintyM) =>
            patch({
              calibrationByRole: { ...state.calibrationByRole, [role]: calibration },
              poseUncertaintyM: { ...state.poseUncertaintyM, [role]: uncertaintyM },
            })
          }
          onAllDone={() => setStep('ballColor')}
          onBack={() => setStep('placement')}
        />
      )}

      {step === 'ballColor' && (
        <BallColorSampleStep
          deviceId={state.deviceByRole.plate}
          hsvGate={state.hsvGate}
          negativeSamples={state.negativeColorSamples}
          onChange={(p) =>
            patch({
              ...(p.hsvGate !== undefined ? { hsvGate: p.hsvGate } : {}),
              ...(p.negativeSamples !== undefined ? { negativeColorSamples: p.negativeSamples } : {}),
            })
          }
          onBack={() => setStep('plateCorners')}
          onNext={() => setStep('zone')}
        />
      )}

      {step === 'zone' && (
        <ZoneSetupStep
          deviceId={state.deviceByRole.plate}
          calibration={state.calibrationByRole.plate}
          ruleSet={ruleSet}
          zone={state.zone}
          onChange={(zone) => patch({ zone })}
          onBack={() => setStep('ballColor')}
          onNext={() => setStep('lighting')}
        />
      )}

      {step === 'lighting' && (
        <LightingCheckStep
          deviceId={state.deviceByRole.plate}
          acknowledged={state.lightingAcknowledged}
          onAcknowledge={(v) => patch({ lightingAcknowledged: v })}
          onBack={() => setStep('zone')}
          onNext={() => setStep('testPitch')}
        />
      )}

      {step === 'testPitch' && (
        <TestPitchStep state={state} plateDeviceId={state.deviceByRole.plate} onBack={() => setStep('lighting')} onStart={() => void finish()} />
      )}
    </WizardShell>
  );
}
