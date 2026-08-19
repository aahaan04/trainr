import { useEffect, useState } from 'react';

/**
 * Captures the `beforeinstallprompt` event (Chromium) so Settings can offer an
 * explicit "Install app" action instead of relying on the browser's own, easy-to-
 * miss UI. vite-plugin-pwa (registerType: 'autoUpdate') handles service worker
 * registration and updates on its own — this module only handles the install
 * affordance, which it doesn't provide.
 */
export function useInstallPrompt() {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(
    typeof window !== 'undefined' && window.matchMedia?.('(display-mode: fullscreen), (display-mode: standalone)').matches,
  );

  useEffect(() => {
    const onPrompt = (e: BeforeInstallPromptEvent) => {
      e.preventDefault();
      setDeferred(e);
    };
    const onInstalled = () => {
      setInstalled(true);
      setDeferred(null);
    };
    window.addEventListener('beforeinstallprompt', onPrompt);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  const promptInstall = async (): Promise<void> => {
    if (!deferred) return;
    await deferred.prompt();
    await deferred.userChoice;
    setDeferred(null);
  };

  return { canInstall: !!deferred && !installed, installed, promptInstall };
}
