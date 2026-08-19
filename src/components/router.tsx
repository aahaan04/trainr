import { useSyncExternalStore, type ReactNode } from 'react';

/**
 * A minimal hash router. No routing library dependency (Section: no component
 * library dependency) — the app has seven screens and a couple of param routes,
 * which does not justify pulling in react-router. Paths always start with `#/`.
 */

function subscribe(callback: () => void): () => void {
  window.addEventListener('hashchange', callback);
  return () => window.removeEventListener('hashchange', callback);
}

function getHash(): string {
  const raw = window.location.hash.replace(/^#/, '');
  return raw || '/';
}

export function useRoute(): string {
  return useSyncExternalStore(subscribe, getHash, () => '/');
}

export function navigate(path: string): void {
  window.location.hash = path;
}

interface LinkProps {
  to: string;
  className?: string;
  children: ReactNode;
  onClick?: () => void;
}

export function Link({ to, className, children, onClick }: LinkProps) {
  return (
    <a
      href={`#${to}`}
      className={className}
      onClick={(e) => {
        onClick?.();
        if (getHash() === to) e.preventDefault();
      }}
    >
      {children}
    </a>
  );
}

/** Splits a hash path like "/session/abc123" against a pattern like "/session/:id". */
export function matchRoute(pattern: string, path: string): Record<string, string> | null {
  const patternParts = pattern.split('/').filter(Boolean);
  const pathParts = path.split('/').filter(Boolean);
  if (patternParts.length !== pathParts.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < patternParts.length; i++) {
    const p = patternParts[i];
    const v = pathParts[i];
    if (p.startsWith(':')) params[p.slice(1)] = decodeURIComponent(v);
    else if (p !== v) return null;
  }
  return params;
}
