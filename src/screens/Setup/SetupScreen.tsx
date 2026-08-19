import { navigate } from '@/components/router';
import { Optional, PendingPlaceholder } from '@/components/adapters/optional';
import { SetupWizard } from '@/components/adapters/setupWizardAdapter';

/** Routes to WS2's setup wizard (`src/screens/SetupWizard/`), owned entirely by that workstream. */
export function SetupScreen() {
  return (
    <div className="min-h-full">
      <Optional
        component={SetupWizard}
        props={{ onComplete: () => navigate('/'), onCancel: () => navigate('/') }}
        fallback={
          <div className="flex flex-col items-center gap-4 px-4 py-10">
            <PendingPlaceholder
              label="Setup wizard not available yet"
              detail="WS2 (src/screens/SetupWizard) hasn't shipped its entry component. Camera setup and calibration will appear here once it does."
            />
          </div>
        }
      />
    </div>
  );
}
