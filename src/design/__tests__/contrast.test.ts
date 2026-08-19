import { describe, expect, it } from 'vitest';
import { contrastRatio, passesAA } from '../contrast';
import { MUST_NOT_BE_TEXT, TEXT_ON_SURFACE_PAIRS } from '../tokens';
import { ACCEPTANCE } from '@/domain/constants';

describe('design system accessibility', () => {
  it.each(TEXT_ON_SURFACE_PAIRS)('$name clears WCAG AA', ({ fg, bg }) => {
    const ratio = contrastRatio(fg, bg);
    expect(ratio, `${fg} on ${bg} measured ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(
      ACCEPTANCE.MIN_CONTRAST_RATIO,
    );
  });

  // Guards the palette's central discipline: the bright -500 fills and optic yellow
  // are surfaces, not ink. If one of these starts passing, someone has washed out
  // a fill colour and the STRIKE/BALL signal has lost its punch.
  it.each(MUST_NOT_BE_TEXT)('$name is correctly unusable as text', ({ fg, bg }) => {
    expect(passesAA(fg, bg)).toBe(false);
  });

  it('computes known reference ratios correctly', () => {
    expect(contrastRatio('#000000', '#FFFFFF')).toBeCloseTo(21, 5);
    expect(contrastRatio('#FFFFFF', '#FFFFFF')).toBeCloseTo(1, 5);
    expect(contrastRatio('#777777', '#FFFFFF')).toBeCloseTo(4.48, 1);
  });
});
