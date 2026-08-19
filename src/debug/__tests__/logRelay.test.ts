import { describe, expect, it } from 'vitest';
import { channelNameForLogs, deviceLabel, formatArgs, serializeArg } from '../logRelay';

describe('channelNameForLogs', () => {
  it('namespaces separately from pairing channels', () => {
    expect(channelNameForLogs('ABC123')).toBe('logs:ABC123');
  });

  it('normalises case so a hand-typed code reaches the same channel', () => {
    expect(channelNameForLogs(' abc123 ')).toBe('logs:ABC123');
  });
});

describe('serializeArg', () => {
  /**
   * The case the relay exists for. JSON.stringify(new Error('x')) is '{}', so a
   * naive relay would transmit an empty object for every crash — discarding the one
   * thing worth transmitting.
   */
  it('preserves an Error, which JSON.stringify would flatten to {}', () => {
    const e = new TypeError('bad thing');
    const out = serializeArg(e) as { __error: boolean; name: string; message: string; stack?: string };
    expect(out.__error).toBe(true);
    expect(out.name).toBe('TypeError');
    expect(out.message).toBe('bad thing');
    expect(out.stack).toBeTruthy();
    expect(JSON.stringify(e)).toBe('{}');
  });

  it('survives a cyclic object instead of throwing inside a console call', () => {
    const a: Record<string, unknown> = { name: 'a' };
    a.self = a;
    expect(() => serializeArg(a)).not.toThrow();
    expect(String(serializeArg(a))).toMatch(/Unserialisable/);
  });

  it('renders values JSON drops', () => {
    expect(serializeArg(undefined)).toBe('[undefined]');
    expect(serializeArg(10n)).toBe('10');
    expect(String(serializeArg(function named() {}))).toBe('[Function named]');
  });

  it('passes primitives through untouched', () => {
    expect(serializeArg('x')).toBe('x');
    expect(serializeArg(42)).toBe(42);
    expect(serializeArg(null)).toBe(null);
  });
});

describe('formatArgs', () => {
  it('renders an error as name: message rather than [object Object]', () => {
    expect(formatArgs(['failed:', new RangeError('nope')])).toBe('failed: RangeError: nope');
  });

  it('joins mixed arguments readably', () => {
    expect(formatArgs(['fps', 59.4, { dropped: 2 }])).toBe('fps 59.4 {"dropped":2}');
  });
});

describe('deviceLabel', () => {
  it('distinguishes the three devices under test', () => {
    expect(deviceLabel('Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X)')).toBe('iPad');
    expect(deviceLabel('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)')).toBe('iPhone');
    expect(deviceLabel('Mozilla/5.0 (Windows NT 10.0; Win64; x64)')).toBe('Windows');
  });

  it('falls back rather than throwing on an unknown agent', () => {
    expect(deviceLabel('something else')).toBe('device');
  });
});
