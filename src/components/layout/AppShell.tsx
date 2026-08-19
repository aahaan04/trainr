import type { ReactNode } from 'react';
import { useAppStore } from '@/store/appStore';
import { Link } from '../router';
import { RibbonMark } from '../motif/RibbonMark';
import { InfoIcon, SunIcon } from './icons';
import { TabBar } from './TabBar';

interface AppShellProps {
  activePath: string;
  children: ReactNode;
  /** Live session owns the whole screen — no header/tab chrome competing with the feed. */
  bare?: boolean;
}

export function AppShell({ activePath, children, bare = false }: AppShellProps) {
  const sunlightMode = useAppStore((s) => s.settings.sunlightMode);
  const updateSettings = useAppStore((s) => s.updateSettings);

  if (bare) {
    return <div className="fixed inset-0 bg-indigo-900">{children}</div>;
  }

  return (
    <div className="flex min-h-full flex-col">
      <header className="flex min-h-tap items-center justify-between gap-3 bg-indigo-900 px-4 py-2">
        <Link to="/" className="flex items-center gap-2">
          <RibbonMark className="h-8 w-14" tone="onDark" title="Trainr" />
          <span className="text-title font-semibold text-white">Trainr</span>
        </Link>
        <div className="flex items-center gap-1">
          <button
            type="button"
            aria-pressed={sunlightMode}
            aria-label="Toggle sunlight mode"
            onClick={() => void updateSettings({ sunlightMode: !sunlightMode })}
            className={[
              'flex min-h-tap min-w-tap items-center justify-center rounded-pill transition-colors duration-hover ease-brand',
              sunlightMode ? 'bg-amber-500 text-indigo-900' : 'text-indigo-100 hover:bg-indigo-700',
            ].join(' ')}
          >
            <SunIcon className="h-5 w-5" />
          </button>
          <Link
            to="/how-it-works"
            aria-label="How this works and where it is wrong"
            className="flex min-h-tap min-w-tap items-center justify-center rounded-pill text-indigo-100 hover:bg-indigo-700"
          >
            <InfoIcon className="h-5 w-5" />
          </Link>
        </div>
      </header>
      <main className="flex-1 overflow-y-auto bg-surface-0 pb-4">{children}</main>
      <TabBar activePath={activePath} />
    </div>
  );
}
