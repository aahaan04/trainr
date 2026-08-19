/**
 * On-device console for iOS, loaded in dev builds only.
 *
 * Safari Web Inspector needs a Mac. This project is developed on Windows, so there
 * is NO first-class way to see the iPad's console, and an iPad with no console is
 * an iPad you cannot debug. Eruda draws a console, network log and element
 * inspector inside the page itself, which is strictly worse than Web Inspector —
 * it cannot set breakpoints, it cannot profile, and it competes with the app for
 * the main thread — but it does show thrown errors and log output, which is the
 * difference between "the camera failed" and "the camera failed with
 * NotAllowedError at frameSource.ts:41".
 *
 * Enabled by `?debug` on the URL or by localStorage, so it is off by default even
 * in dev: it steals touch targets, and the live screen is full of large ones.
 * Never included in a production build — the dynamic import sits behind
 * `import.meta.env.DEV`, so Rollup drops it entirely.
 */

const STORAGE_KEY = 'trainr:debug-console';

export function shouldEnableDevConsole(search: string, stored: string | null): boolean {
  const params = new URLSearchParams(search);
  if (params.has('debug')) return params.get('debug') !== '0';
  return stored === '1';
}

export async function initDevConsole(): Promise<void> {
  // Previously dev-only. It is now available in production too, because all device
  // testing has moved to the deployed build and there is still no debugger for iOS
  // on a Windows laptop — gating the only remaining observability to dev would
  // remove it at exactly the moment it becomes the only thing there is.
  //
  // It stays opt-in behind `?debug`, so it costs a normal visitor nothing: the
  // eruda chunk is dynamically imported and never fetched unless asked for. The
  // access gate is the thing keeping strangers out, not this flag.
  let stored: string | null = null;
  try {
    stored = localStorage.getItem(STORAGE_KEY);
  } catch {
    stored = null;
  }
  if (!shouldEnableDevConsole(window.location.search, stored)) return;

  try {
    localStorage.setItem(STORAGE_KEY, '1');
  } catch {
    // Private browsing; the query param still works for this page load.
  }

  const eruda = (await import('eruda')).default;
  eruda.init();
  // Unhandled rejections are otherwise invisible on iOS, and the camera and
  // MediaPipe paths are almost entirely promise-based.
  window.addEventListener('unhandledrejection', (e) => {
    console.error('Unhandled rejection:', e.reason);
  });
  console.info('[trainr] on-device console enabled. Append ?debug=0 to disable.');
}
