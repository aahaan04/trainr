/**
 * Catches a render crash, reports it to the log relay, and shows something a person
 * standing at a tripod can act on.
 *
 * Without this, a React error unmounts the tree and leaves a white screen — on iOS,
 * with no debugger, a white screen carries no information at all. The stack is shown
 * on-device AND pushed to the relay, so the failure survives even if nobody is
 * watching the channel at the time.
 */

import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
  onError?: (error: Error, componentStack: string) => void;
}

interface State {
  error: Error | null;
  componentStack: string | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, componentStack: null };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    this.setState({ componentStack: info.componentStack ?? null });
    // console.error is patched by the relay when attached, so this reaches the
    // laptop as well as the device.
    console.error('React render crash:', error, info.componentStack);
    this.props.onError?.(error, info.componentStack ?? '');
  }

  render(): ReactNode {
    const { error, componentStack } = this.state;
    if (!error) return this.props.children;

    return (
      <div className="mx-auto flex max-w-2xl flex-col gap-4 p-6">
        <h1 className="font-display text-display-md text-coral-700">Something crashed</h1>
        <p className="text-body text-ink-secondary">
          The error below has also been sent to the log channel. Copy it if you are reporting this.
        </p>
        <pre className="overflow-x-auto rounded-card bg-surface-2 p-3 text-caption text-ink">
          {error.name}: {error.message}
          {'\n\n'}
          {error.stack}
          {componentStack ? `\n\nComponent stack:${componentStack}` : ''}
        </pre>
        <div className="flex gap-2">
          <button
            type="button"
            className="min-h-tap rounded-pill bg-indigo-600 px-5 text-white"
            onClick={() => this.setState({ error: null, componentStack: null })}
          >
            Try again
          </button>
          <button
            type="button"
            className="min-h-tap rounded-pill border border-border-strong px-5 text-ink"
            onClick={() => {
              void navigator.clipboard?.writeText(`${error.stack}\n${componentStack ?? ''}`);
            }}
          >
            Copy error
          </button>
        </div>
      </div>
    );
  }
}
