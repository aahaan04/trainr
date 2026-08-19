import { describe, expect, it } from 'vitest';
import { SYNC } from '@/domain/constants';
import { generatePairingCode, parsePairingPayload, pairingPayload } from '../pairing';

describe('pairing code generation', () => {
  it('produces a code of the configured length using only the spoken-safe alphabet', () => {
    const code = generatePairingCode();
    expect(code).toHaveLength(SYNC.PAIRING_CODE_LENGTH);
    for (const ch of code) expect(SYNC.PAIRING_ALPHABET.includes(ch)).toBe(true);
    // 0/O/1/I/L are excluded to avoid confusion when read aloud on a field.
    expect(code).not.toMatch(/[01OIL]/);
  });

  it('is deterministic for an injected rng, so pairing is testable without real randomness', () => {
    let i = 0;
    const rng = () => {
      const seq = [0, 0.5, 0.99, 0.1, 0.2, 0.3];
      return seq[i++ % seq.length];
    };
    const code = generatePairingCode(6, SYNC.PAIRING_ALPHABET, rng);
    expect(code).toHaveLength(6);
    // Re-running with the same rng sequence reproduces the same code.
    i = 0;
    expect(generatePairingCode(6, SYNC.PAIRING_ALPHABET, rng)).toBe(code);
  });
});

describe('pairing payload round trip', () => {
  it('round trips a bare-scheme payload back to the code', () => {
    const code = 'AB23CD';
    expect(parsePairingPayload(pairingPayload(code))).toBe(code);
  });

  it('round trips a URL-shaped payload back to the code', () => {
    const code = 'ZZ99KM';
    const payload = pairingPayload(code, 'https://trainr.app');
    expect(payload).toBe('https://trainr.app/join?code=ZZ99KM');
    expect(parsePairingPayload(payload)).toBe(code);
  });

  it('accepts a bare typed-in code with no scheme at all', () => {
    expect(parsePairingPayload('ab23cd')).toBe('AB23CD');
  });

  it('rejects garbage input', () => {
    expect(parsePairingPayload('not a code at all')).toBeNull();
    expect(parsePairingPayload('')).toBeNull();
  });
});
