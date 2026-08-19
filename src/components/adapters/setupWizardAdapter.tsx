import { lazyFromGlob, type GlobModules } from './optional';

/**
 * WS2 owns `src/screens/SetupWizard/`. We only route to it, never edit inside it.
 * Assumes the entry component is the default export of its barrel; falls back to
 * a placeholder screen until that lands.
 */
const modules: GlobModules = import.meta.glob('/src/screens/SetupWizard/index.{ts,tsx}');

export interface SetupWizardProps {
  onComplete?: () => void;
  onCancel?: () => void;
}

export const SetupWizard = lazyFromGlob<SetupWizardProps>(modules, 'default');
