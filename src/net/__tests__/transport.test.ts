import { describe, expect, it } from 'vitest';
import { channelNameForCode, selectTransport } from '../transport';

describe('selectTransport', () => {
  it('defaults to the local relay in dev', () => {
    const s = selectTransport({ dev: true });
    expect(s.kind).toBe('local');
    expect(s.usable).toBe(true);
  });

  it('defaults to Supabase in production when configured', () => {
    const s = selectTransport({ dev: false, supabaseUrl: 'https://x.supabase.co', supabaseAnonKey: 'k' });
    expect(s.kind).toBe('supabase');
    expect(s.usable).toBe(true);
  });

  /**
   * A production build missing its Supabase env vars must report itself unusable
   * rather than quietly falling back to the local relay. The local relay does not
   * exist on Vercel, so that fallback would produce a connection that can never
   * open — the exact failure shape that hid the ws:// bug.
   */
  it('reports unusable, not a silent fallback, when production env vars are missing', () => {
    const s = selectTransport({ dev: false });
    expect(s.kind).toBe('supabase');
    expect(s.usable).toBe(false);
    expect(s.reason).toMatch(/env vars are not set/);
  });

  it('lets an explicit choice win over the environment default', () => {
    expect(selectTransport({ dev: false, transport: 'local' }).kind).toBe('local');
    expect(selectTransport({ dev: true, transport: 'supabase', supabaseUrl: 'u', supabaseAnonKey: 'k' }).kind).toBe(
      'supabase',
    );
  });

  it('marks an explicit supabase choice unusable when its config is absent', () => {
    const s = selectTransport({ dev: true, transport: 'supabase' });
    expect(s.kind).toBe('supabase');
    expect(s.usable).toBe(false);
  });

  it('falls back with a stated reason on an unrecognised value', () => {
    const s = selectTransport({ dev: true, transport: 'carrier-pigeon' });
    expect(s.kind).toBe('local');
    expect(s.reason).toMatch(/Unrecognised/);
  });

  it('is case- and whitespace-insensitive', () => {
    expect(selectTransport({ dev: false, transport: '  LOCAL ' }).kind).toBe('local');
  });
});

describe('channelNameForCode', () => {
  it('namespaces the channel so the authorization policy can match a prefix', () => {
    expect(channelNameForCode('ABC123')).toBe('pair:ABC123');
  });

  /**
   * The pairing code is read aloud and typed by hand, so case must not decide
   * whether two devices land in the same room.
   */
  it('normalises case and surrounding whitespace', () => {
    expect(channelNameForCode('abc123')).toBe('pair:ABC123');
    expect(channelNameForCode('  aBc123  ')).toBe('pair:ABC123');
  });
});
