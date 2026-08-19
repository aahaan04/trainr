import { useEffect, useRef } from 'react';

/**
 * Keeps the screen awake while `active` is true (during a live session), since a
 * device on a tripod mid-bullpen must never sleep. Silently no-ops where the Wake
 * Lock API is unsupported — this is a nicety, not a requirement to run.
 */
export function useWakeLock(active: boolean): void {
  const sentinelRef = useRef<WakeLockSentinel | null>(null);

  useEffect(() => {
    if (!active || typeof navigator === 'undefined' || !('wakeLock' in navigator)) return;

    let cancelled = false;

    const request = async () => {
      try {
        const sentinel = await navigator.wakeLock.request('screen');
        if (cancelled) {
          void sentinel.release();
          return;
        }
        sentinelRef.current = sentinel;
      } catch {
        // Permission denied or unsupported in this context; the app still works,
        // it just cannot stop the OS from sleeping.
      }
    };

    void request();

    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible' && !sentinelRef.current) void request();
    };
    document.addEventListener('visibilitychange', onVisibilityChange);

    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVisibilityChange);
      void sentinelRef.current?.release();
      sentinelRef.current = null;
    };
  }, [active]);
}
