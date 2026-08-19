import { Component, Suspense, lazy, type ComponentType, type ReactNode } from 'react';

/**
 * Mounts components exported by other, in-progress workstreams without ever
 * breaking this workstream's build. `import.meta.glob` is Vite's own mechanism
 * for an import that legitimately may match zero files: unlike a literal
 * `import()`, it resolves at build time to whatever exists on disk right now and
 * simply returns an empty map when the target module doesn't exist yet, rather
 * than failing the Rollup build. Once the owning workstream adds the file, the
 * next build picks it up with no change needed here.
 */
export type GlobModules = Record<string, () => Promise<unknown>>;

/**
 * Searches every module a glob matched (not just the first) for the named export,
 * since a workstream may ship several files rather than a single barrel and we
 * don't know its internal layout in advance.
 */
export function lazyFromGlob<P extends object>(modules: GlobModules, exportName: string): ComponentType<P> | null {
  const paths = Object.keys(modules);
  if (paths.length === 0) return null;
  // React.lazy's return type is invariant in its props, so it does not assign to
  // ComponentType<P> even though it renders identically. The cast is the narrow fix.
  return lazy(async () => {
    for (const path of paths) {
      const mod = (await modules[path]()) as Record<string, unknown>;
      const Comp = mod[exportName];
      if (typeof Comp === 'function') return { default: Comp as ComponentType<P> };
    }
    throw new Error(`Expected export "${exportName}" was not found in any of: ${paths.join(', ')}`);
  }) as unknown as ComponentType<P>;
}

interface BoundaryState {
  failed: boolean;
}

/** Catches both "module resolved but export missing" and any runtime error the mounted component throws. */
export class OptionalBoundary extends Component<{ fallback: ReactNode; children: ReactNode }, BoundaryState> {
  state: BoundaryState = { failed: false };
  static getDerivedStateFromError(): BoundaryState {
    return { failed: true };
  }
  componentDidCatch(): void {
    // Intentionally silent: the fallback placeholder communicates the missing
    // dependency, and this is expected during parallel development.
  }
  render(): ReactNode {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

interface OptionalProps<P> {
  component: ComponentType<P> | null;
  fallback: ReactNode;
  loading?: ReactNode;
  props?: P;
}

/** Renders `component` if the owning workstream has shipped it, else a clearly-labelled fallback. */
export function Optional<P extends object>({ component, fallback, loading, props }: OptionalProps<P>) {
  if (!component) return <>{fallback}</>;
  const Comp = component;
  return (
    <OptionalBoundary fallback={fallback}>
      <Suspense fallback={loading ?? fallback}>
        <Comp {...(props as P)} />
      </Suspense>
    </OptionalBoundary>
  );
}

/** A consistent visual treatment for "this piece is owned by another workstream and isn't built yet." */
export function PendingPlaceholder({ label, detail }: { label: string; detail?: string }) {
  return (
    <div className="flex min-h-[8rem] flex-col items-center justify-center gap-1 rounded-card border border-dashed border-border-strong bg-surface-2 p-6 text-center">
      <span className="text-label uppercase text-ink-tertiary">{label}</span>
      {detail && <span className="max-w-xs text-caption text-ink-tertiary">{detail}</span>}
    </div>
  );
}
