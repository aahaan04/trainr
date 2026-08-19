import { Link } from '../router';
import { GearIcon, HomeIcon, TargetIcon, TrendIcon } from './icons';

const TABS = [
  { to: '/', label: 'Home', icon: HomeIcon },
  { to: '/live', label: 'Live', icon: TargetIcon },
  { to: '/trends', label: 'Trends', icon: TrendIcon },
  { to: '/settings', label: 'Settings', icon: GearIcon },
] as const;

/** Bottom tab bar. Tap targets already meet `min-h-tap`; sunlight mode grows them further via the CSS var. */
export function TabBar({ activePath }: { activePath: string }) {
  return (
    <nav className="flex border-t border-border bg-surface-1" aria-label="Primary">
      {TABS.map(({ to, label, icon: Icon }) => {
        const active = to === '/' ? activePath === '/' : activePath.startsWith(to);
        return (
          <Link
            key={to}
            to={to}
            className={[
              'flex min-h-tap flex-1 flex-col items-center justify-center gap-0.5 py-2 text-caption font-medium transition-colors duration-hover ease-brand',
              active ? 'text-indigo-600' : 'text-ink-tertiary',
            ].join(' ')}
          >
            <Icon className="h-6 w-6" />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
