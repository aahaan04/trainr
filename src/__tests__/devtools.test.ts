import { describe, expect, it } from 'vitest';
import { shouldEnableDevConsole } from '../devtools';

describe('shouldEnableDevConsole', () => {
  it('is off by default so it cannot steal tap targets on the live screen', () => {
    expect(shouldEnableDevConsole('', null)).toBe(false);
  });

  it('turns on with ?debug', () => {
    expect(shouldEnableDevConsole('?debug', null)).toBe(true);
    expect(shouldEnableDevConsole('?debug=1', null)).toBe(true);
  });

  it('stays on once stored, so a reload on the iPad keeps the console', () => {
    expect(shouldEnableDevConsole('', '1')).toBe(true);
  });

  it('?debug=0 wins over the stored preference', () => {
    expect(shouldEnableDevConsole('?debug=0', '1')).toBe(false);
  });
});
