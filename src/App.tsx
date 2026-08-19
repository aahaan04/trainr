import { useEffect } from 'react';
import { useAppStore } from '@/store/appStore';
import { useRoute, matchRoute } from '@/components/router';
import { AppShell } from '@/components/layout/AppShell';
import { RibbonLoader } from '@/components/motif/RibbonLoader';
import { AccessGate } from '@/access/AccessGate';
import { HomeScreen } from '@/screens/Home/HomeScreen';
import { LiveScreen } from '@/screens/Live/LiveScreen';
import { SessionReviewScreen } from '@/screens/SessionReview/SessionReviewScreen';
import { TrendsScreen } from '@/screens/Trends/TrendsScreen';
import { SettingsScreen } from '@/screens/Settings/SettingsScreen';
import { HowItWorksScreen } from '@/screens/HowItWorks/HowItWorksScreen';
import { SetupScreen } from '@/screens/Setup/SetupScreen';
import { DiagnosticsScreen } from '@/screens/Diagnostics/DiagnosticsScreen';
import { LogsScreen } from '@/screens/Logs/LogsScreen';

function AppShellRouter() {
  const path = useRoute();

  if (path === '/live') {
    return (
      <AppShell activePath={path} bare>
        <LiveScreen />
      </AppShell>
    );
  }

  const sessionParams = matchRoute('/session/:id', path);

  let content: JSX.Element;
  if (path === '/') content = <HomeScreen />;
  else if (path === '/setup') content = <SetupScreen />;
  else if (sessionParams) content = <SessionReviewScreen sessionId={sessionParams.id} />;
  else if (path === '/trends') content = <TrendsScreen />;
  else if (path === '/settings') content = <SettingsScreen />;
  else if (path === '/how-it-works') content = <HowItWorksScreen />;
  else if (path === '/diagnostics') content = <DiagnosticsScreen />;
  else if (path === '/logs') content = <LogsScreen />;
  else content = <HomeScreen />;

  return (
    <AppShell activePath={path}>
      {content}
    </AppShell>
  );
}

export default function App() {
  const init = useAppStore((s) => s.init);
  const settingsLoaded = useAppStore((s) => s.settingsLoaded);

  useEffect(() => {
    void init();
  }, [init]);

  return (
    <AccessGate>
      {settingsLoaded ? (
        <AppShellRouter />
      ) : (
        <div className="flex min-h-full items-center justify-center bg-surface-0">
          <RibbonLoader label="Loading Trainr" />
        </div>
      )}
    </AccessGate>
  );
}
