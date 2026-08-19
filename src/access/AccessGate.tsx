import type { ReactNode } from 'react';
import { useAccessGate } from './useAccessGate';
import { GateScreen } from '@/screens/Gate/GateScreen';
import { GateStatusBadge } from '@/screens/Gate/GateStatusBadge';

interface AccessGateProps {
  children: ReactNode;
}

/**
 * Wraps the whole app shell, including the debug `/diagnostics` route — it is a
 * normal route in the same bundle (see docs/DEPLOYMENT_AUDIT.md finding 0), not a
 * separately gated one. Renders the passphrase prompt in place of `children`
 * until this device is unlocked; renders `children` plus a small status/sign-out
 * affordance once it is (or immediately, with a "disabled" affordance, when no
 * passphrase is configured).
 */
export function AccessGate({ children }: AccessGateProps) {
  const gate = useAccessGate();

  if (gate.enabled && !gate.unlocked) {
    return <GateScreen onAttempt={gate.attempt} />;
  }

  return (
    <>
      {children}
      <GateStatusBadge enabled={gate.enabled} onSignOut={gate.enabled ? gate.signOut : undefined} />
    </>
  );
}
