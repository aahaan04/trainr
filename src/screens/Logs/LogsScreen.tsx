/**
 * /logs — both ends of the log relay in one screen.
 *
 * Open it on the laptop in "watch" mode and on the phone in "stream" mode, with the
 * same code, and the phone's console appears on the laptop. This is the only
 * observability iOS has once testing moves to a deployed build, because Safari Web
 * Inspector needs a Mac.
 */

import { useMemo, useState } from 'react';
import { Button } from '@/components/primitives/Button';
import { Card } from '@/components/primitives/Card';
import { TextField } from '@/components/primitives/TextField';
import { useLogPublisher, useLogSubscriber } from '@/debug/useLogChannel';
import type { LogLevel } from '@/debug/logRelay';

type Mode = 'watch' | 'stream';

const LEVEL_CLASS: Record<LogLevel, string> = {
  debug: 'text-ink-tertiary',
  info: 'text-ink',
  warn: 'text-amber-600',
  error: 'text-coral-700',
};

export function LogsScreen() {
  const [mode, setMode] = useState<Mode>('watch');
  const [codeInput, setCodeInput] = useState('');
  const [activeCode, setActiveCode] = useState<string | null>(null);

  const watching = useLogSubscriber(mode === 'watch' ? activeCode : null);
  const publishing = useLogPublisher(mode === 'stream' ? activeCode : null);

  const text = useMemo(
    () =>
      watching.entries
        .map((e) => `${new Date(e.ts).toISOString()} [${e.level}] ${e.source}: ${e.message}${e.stack ? `\n${e.stack}` : ''}`)
        .join('\n'),
    [watching.entries],
  );

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4 p-4">
      <header>
        <h1 className="font-display text-display-md">Log relay</h1>
        <p className="text-body text-ink-secondary">
          Stream a device's console to another screen. Open <strong>Watch</strong> on the laptop and{' '}
          <strong>Stream</strong> on the phone, using the same code.
        </p>
      </header>

      <Card>
        <div className="mb-3 flex gap-2">
          <Button variant={mode === 'watch' ? 'primary' : 'secondary'} onClick={() => setMode('watch')}>
            Watch
          </Button>
          <Button variant={mode === 'stream' ? 'primary' : 'secondary'} onClick={() => setMode('stream')}>
            Stream
          </Button>
        </div>

        <TextField
          label="Channel code"
          value={codeInput}
          onChange={(e) => setCodeInput(e.target.value.toUpperCase())}
          placeholder="e.g. DEBUG1"
        />
        <div className="mt-3 flex gap-2">
          <Button onClick={() => setActiveCode(codeInput.trim() || null)} disabled={!codeInput.trim()}>
            {mode === 'watch' ? 'Watch channel' : 'Start streaming'}
          </Button>
          <Button variant="secondary" onClick={() => setActiveCode(null)}>
            Stop
          </Button>
        </div>

        <p className="mt-3 text-caption text-ink-secondary">
          {mode === 'watch' ? watching.reason : publishing.reason}
        </p>
      </Card>

      {mode === 'watch' && (
        <Card>
          <div className="mb-2 flex items-center justify-between">
            <h2 className="font-display text-title">
              Entries ({watching.entries.length}){watching.connected ? '' : ' — not connected'}
            </h2>
            <div className="flex gap-2">
              <Button variant="secondary" onClick={watching.clear}>
                Clear
              </Button>
              <Button variant="secondary" onClick={() => void navigator.clipboard?.writeText(text)}>
                Copy all
              </Button>
            </div>
          </div>
          <div className="max-h-[60vh] overflow-y-auto rounded bg-surface-2 p-2">
            {watching.entries.length === 0 ? (
              <p className="text-caption text-ink-tertiary">
                Nothing yet. Entries appear here as the streaming device logs them.
              </p>
            ) : (
              watching.entries.map((e, i) => (
                <div key={`${e.ts}-${i}`} className="border-b border-border py-1 last:border-0">
                  <div className="flex gap-2 text-caption">
                    <span className="num text-ink-tertiary">{new Date(e.ts).toLocaleTimeString()}</span>
                    <span className="text-ink-tertiary">{e.source}</span>
                    <span className={LEVEL_CLASS[e.level]}>{e.level}</span>
                  </div>
                  <div className={`text-body ${LEVEL_CLASS[e.level]}`}>{e.message}</div>
                  {e.stack && (
                    <pre className="mt-1 overflow-x-auto text-caption text-ink-tertiary">{e.stack}</pre>
                  )}
                </div>
              ))
            )}
          </div>
        </Card>
      )}

      {mode === 'stream' && (
        <Card>
          <h2 className="mb-2 font-display text-title">Streaming</h2>
          <p className="text-body text-ink-secondary">
            {publishing.active
              ? 'This device’s console, errors and unhandled rejections are being sent to the channel above. Leave this tab open, or navigate the app in another tab on the same device — the relay stays attached for this tab only.'
              : 'Not streaming.'}
          </p>
          <Button
            className="mt-3"
            variant="secondary"
            onClick={() => console.error(new Error('Test error from the log relay'))}
          >
            Send a test error
          </Button>
        </Card>
      )}
    </div>
  );
}
