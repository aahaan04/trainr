import { Button } from '@/components/primitives/Button';
import { useRoute } from '@/components/router';

interface GateStatusBadgeProps {
  enabled: boolean;
  onSignOut?: () => void;
}

/**
 * A small, persistent corner affordance rendered over the unlocked app.
 *
 * When the gate is disabled (no `VITE_ACCESS_PASSPHRASE` set), this is the only
 * thing telling anyone that this deploy is wide open — silence there is exactly
 * the failure mode Task 4 exists to avoid, so it stays visible rather than being
 * a one-time toast. When the gate is enabled and unlocked, it doubles as the
 * sign-out control (requirement: "include a way to sign out").
 *
 * Hidden on `/live`, which is a bare full-screen camera view with its own touch
 * targets for in-game use — an overlay there would compete with pitch capture.
 * The gate itself still applies to `/live` (a locked device shows GateScreen
 * instead of ever reaching it); this only affects the badge once unlocked.
 */
export function GateStatusBadge({ enabled, onSignOut }: GateStatusBadgeProps) {
  const path = useRoute();
  if (path === '/live') return null;

  if (!enabled) {
    return (
      <div
        role="status"
        className="fixed bottom-2 left-2 z-50 max-w-[85vw] rounded-pill bg-indigo-100 px-3 py-1 text-caption text-indigo-700 shadow-rest"
      >
        Access gate disabled — VITE_ACCESS_PASSPHRASE is not set
      </div>
    );
  }

  if (!onSignOut) return null;

  return (
    <div className="fixed bottom-2 left-2 z-50">
      <Button
        type="button"
        variant="ghost"
        size="md"
        className="bg-surface-1 shadow-rest"
        onClick={onSignOut}
      >
        Sign out
      </Button>
    </div>
  );
}
