import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { ConfidenceMeter } from '../primitives/ConfidenceMeter';

describe('ConfidenceMeter', () => {
  it('renders the confident band: full bars, indigo, labelled text', () => {
    const html = renderToStaticMarkup(<ConfidenceMeter band="confident" />);
    expect(html).toContain('data-confidence="confident"');
    expect(html).toContain('Confident');
    expect(html).toContain('bg-indigo-600');
  });

  it('renders the tentative band: two bars, amber, labelled text', () => {
    const html = renderToStaticMarkup(<ConfidenceMeter band="tentative" />);
    expect(html).toContain('data-confidence="tentative"');
    expect(html).toContain('Tentative');
    expect(html).toContain('bg-amber-500');
  });

  it('renders the flagged band: one bar, neutral, labelled text — never hidden', () => {
    const html = renderToStaticMarkup(<ConfidenceMeter band="flagged" />);
    expect(html).toContain('data-confidence="flagged"');
    expect(html).toContain('Flagged');
    // Flagged is not a strike/ball outcome, so it must not borrow the coral "miss" colour.
    expect(html).not.toContain('coral');
  });

  it('derives the band from a raw score when no band is passed', () => {
    const html = renderToStaticMarkup(<ConfidenceMeter score={0.9} />);
    expect(html).toContain('data-confidence="confident"');
  });

  it('always renders text alongside the bars, never colour alone', () => {
    for (const band of ['confident', 'tentative', 'flagged'] as const) {
      const html = renderToStaticMarkup(<ConfidenceMeter band={band} />);
      expect(html).toMatch(/role="img"/);
      expect(html).toContain('aria-label="Tracking confidence:');
    }
  });
});
