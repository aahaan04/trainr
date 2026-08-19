/**
 * Log relay: streams logs, errors and telemetry off a deployed device to a laptop
 * watching the same channel.
 *
 * There is no debugger for iOS on a Windows laptop. Once testing moves to a
 * deployed build, eruda's in-page console is the only thing left, and an in-page
 * console cannot be read while the device is on a tripod mid-pitch. This relay is
 * the difference between "it failed on the iPhone" and a stack trace with a line
 * number.
 *
 * It rides the same Supabase Realtime transport as pairing, on a separate channel
 * namespace, so it needs no additional infrastructure.
 *
 * Deliberately defensive: the relay must never be able to break the app it is
 * observing. Every send is fire-and-forget, failures are swallowed, and the
 * original console methods are always called first so local behaviour is
 * unchanged even if the relay is dead.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogEntry {
  ts: number;
  level: LogLevel;
  /** Device label so a laptop watching two devices can tell them apart. */
  source: string;
  message: string;
  /** Stack trace for errors, already stringified. */
  stack?: string;
  /** Structured payload for telemetry (frame timings, pipeline stats). */
  data?: unknown;
}

export function channelNameForLogs(sessionCode: string): string {
  return `logs:${sessionCode.trim().toUpperCase()}`;
}

/** Best-effort short device label, so entries are attributable without a UUID. */
export function deviceLabel(ua: string = typeof navigator !== 'undefined' ? navigator.userAgent : ''): string {
  if (/iPad/i.test(ua)) return 'iPad';
  if (/iPhone/i.test(ua)) return 'iPhone';
  if (/Android/i.test(ua)) return 'Android';
  if (/Windows/i.test(ua)) return 'Windows';
  if (/Macintosh/i.test(ua)) return 'Mac';
  return 'device';
}

/**
 * Serialises anything console received into something that survives JSON transport.
 *
 * Errors are the important case: `JSON.stringify(new Error('x'))` is `{}`, which
 * would silently discard the single most useful thing the relay carries.
 */
export function serializeArg(arg: unknown): unknown {
  if (arg instanceof Error) {
    return { __error: true, name: arg.name, message: arg.message, stack: arg.stack };
  }
  if (typeof arg === 'function') return `[Function ${arg.name || 'anonymous'}]`;
  if (typeof arg === 'undefined') return '[undefined]';
  if (typeof arg === 'bigint') return arg.toString();
  if (arg && typeof arg === 'object') {
    try {
      // Round-trip to drop DOM nodes, cyclic refs and other unserialisable values
      // rather than throwing inside a console call.
      return JSON.parse(JSON.stringify(arg));
    } catch {
      return `[Unserialisable ${Object.prototype.toString.call(arg)}]`;
    }
  }
  return arg;
}

export function formatArgs(args: unknown[]): string {
  return args
    .map((a) => {
      if (typeof a === 'string') return a;
      if (a instanceof Error) return `${a.name}: ${a.message}`;
      const s = serializeArg(a);
      return typeof s === 'string' ? s : JSON.stringify(s);
    })
    .join(' ');
}

export interface LogRelayOptions {
  client: SupabaseClient;
  sessionCode: string;
  source?: string;
  /** Entries buffered while the channel is still connecting. */
  maxBuffer?: number;
}

export interface LogRelay {
  send(entry: Omit<LogEntry, 'ts' | 'source'>): void;
  /** Patches console + global error handlers. Returns an undo function. */
  attach(): () => void;
  close(): void;
}

const DEFAULT_MAX_BUFFER = 200;

export function createLogRelay(opts: LogRelayOptions): LogRelay {
  const source = opts.source ?? deviceLabel();
  const maxBuffer = opts.maxBuffer ?? DEFAULT_MAX_BUFFER;
  const channel = opts.client.channel(channelNameForLogs(opts.sessionCode), {
    config: { broadcast: { self: false } },
  });

  let ready = false;
  let closed = false;
  const pending: LogEntry[] = [];

  void channel.subscribe((status: string) => {
    if (status === 'SUBSCRIBED') {
      ready = true;
      // The buffer exists so the earliest entries — module init, the camera
      // request, the first crash — are not lost to the connection handshake, which
      // is exactly the window where the interesting failures happen.
      for (const e of pending.splice(0)) push(e);
    }
  });

  function push(entry: LogEntry): void {
    if (closed) return;
    if (!ready) {
      pending.push(entry);
      if (pending.length > maxBuffer) pending.shift();
      return;
    }
    try {
      void channel.send({ type: 'broadcast', event: 'log', payload: entry });
    } catch {
      // The relay must never break the app it observes.
    }
  }

  return {
    send(entry) {
      push({ ...entry, ts: Date.now(), source });
    },
    attach() {
      const original = {
        log: console.log,
        info: console.info,
        warn: console.warn,
        error: console.error,
        debug: console.debug,
      };

      const wrap = (level: LogLevel, fn: (...a: unknown[]) => void) =>
        (...args: unknown[]) => {
          fn.apply(console, args);
          const err = args.find((a): a is Error => a instanceof Error);
          push({
            ts: Date.now(),
            level,
            source,
            message: formatArgs(args),
            stack: err?.stack,
            data: args.length === 1 ? serializeArg(args[0]) : args.map(serializeArg),
          });
        };

      console.log = wrap('info', original.log);
      console.info = wrap('info', original.info);
      console.warn = wrap('warn', original.warn);
      console.error = wrap('error', original.error);
      console.debug = wrap('debug', original.debug);

      const onError = (ev: ErrorEvent) => {
        push({
          ts: Date.now(),
          level: 'error',
          source,
          message: `Uncaught ${ev.message}`,
          stack: ev.error?.stack ?? `${ev.filename}:${ev.lineno}:${ev.colno}`,
        });
      };
      // Unhandled rejections are otherwise invisible on iOS, and the camera,
      // MediaPipe and pairing paths are almost entirely promise-based.
      const onRejection = (ev: PromiseRejectionEvent) => {
        const r = ev.reason;
        push({
          ts: Date.now(),
          level: 'error',
          source,
          message: `Unhandled rejection: ${r instanceof Error ? `${r.name}: ${r.message}` : String(r)}`,
          stack: r instanceof Error ? r.stack : undefined,
        });
      };

      window.addEventListener('error', onError);
      window.addEventListener('unhandledrejection', onRejection);

      return () => {
        console.log = original.log;
        console.info = original.info;
        console.warn = original.warn;
        console.error = original.error;
        console.debug = original.debug;
        window.removeEventListener('error', onError);
        window.removeEventListener('unhandledrejection', onRejection);
      };
    },
    close() {
      closed = true;
      void opts.client.removeChannel(channel);
    },
  };
}
