import { describe, expect, it } from 'vitest';
import {
  ACCESS_STORAGE_KEY,
  clearUnlockFlag,
  isGateEnabled,
  passphraseMatches,
  readUnlockFlag,
  writeUnlockFlag,
  type StorageLike,
} from '../gate';

/** In-memory stand-in for `localStorage`, since vitest here runs under Node, not jsdom. */
function fakeStorage(): StorageLike {
  const map = new Map<string, string>();
  return {
    getItem: (key) => (map.has(key) ? map.get(key)! : null),
    setItem: (key, value) => {
      map.set(key, value);
    },
    removeItem: (key) => {
      map.delete(key);
    },
  };
}

describe('isGateEnabled', () => {
  it('is disabled when the env var is unset', () => {
    expect(isGateEnabled(undefined)).toBe(false);
  });

  it('is disabled when the env var is null', () => {
    expect(isGateEnabled(null)).toBe(false);
  });

  it('is disabled when the env var is an empty string', () => {
    expect(isGateEnabled('')).toBe(false);
  });

  it('is disabled when the env var is whitespace only', () => {
    expect(isGateEnabled('   ')).toBe(false);
  });

  it('is enabled when a real passphrase is configured', () => {
    expect(isGateEnabled('let-us-in')).toBe(true);
  });

  it('is enabled even with surrounding whitespace in the configured value', () => {
    expect(isGateEnabled('  let-us-in  ')).toBe(true);
  });
});

describe('passphraseMatches', () => {
  it('matches an exact candidate', () => {
    expect(passphraseMatches('curveball-42', 'curveball-42')).toBe(true);
  });

  it('rejects a wrong candidate of the same length', () => {
    expect(passphraseMatches('curveball-43', 'curveball-42')).toBe(false);
  });

  it('rejects a candidate of different length without throwing', () => {
    expect(passphraseMatches('short', 'much-longer-passphrase')).toBe(false);
    expect(passphraseMatches('much-longer-candidate', 'short')).toBe(false);
  });

  it('rejects a case-mismatched candidate (comparison is exact)', () => {
    expect(passphraseMatches('Curveball-42', 'curveball-42')).toBe(false);
  });

  it('treats two empty strings as a match', () => {
    expect(passphraseMatches('', '')).toBe(true);
  });

  it('is order-independent (matching is symmetric)', () => {
    const a = 'slider-99';
    const b = 'slider-99';
    expect(passphraseMatches(a, b)).toBe(passphraseMatches(b, a));
  });
});

describe('persistence key handling', () => {
  it('uses a namespaced storage key consistent with the rest of the app', () => {
    expect(ACCESS_STORAGE_KEY).toBe('trainr:access-unlocked');
  });

  it('reports unlocked=false before anything has been written', () => {
    const storage = fakeStorage();
    expect(readUnlockFlag(storage)).toBe(false);
  });

  it('reports unlocked=true after writeUnlockFlag', () => {
    const storage = fakeStorage();
    writeUnlockFlag(storage);
    expect(readUnlockFlag(storage)).toBe(true);
  });

  it('reports unlocked=false again after clearUnlockFlag (sign out)', () => {
    const storage = fakeStorage();
    writeUnlockFlag(storage);
    clearUnlockFlag(storage);
    expect(readUnlockFlag(storage)).toBe(false);
  });

  it('does not treat an unrelated stored value as an unlock flag', () => {
    const storage = fakeStorage();
    storage.setItem(ACCESS_STORAGE_KEY, 'true'); // not the literal expected value
    expect(readUnlockFlag(storage)).toBe(false);
  });

  it('clearing an already-clear flag is a no-op, not an error', () => {
    const storage = fakeStorage();
    expect(() => clearUnlockFlag(storage)).not.toThrow();
    expect(readUnlockFlag(storage)).toBe(false);
  });
});
