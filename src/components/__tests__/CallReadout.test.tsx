import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { CallReadout } from '../primitives/CallReadout';

describe('CallReadout', () => {
  it('renders the word STRIKE, not just a colour, for a strike call', () => {
    const html = renderToStaticMarkup(
      <CallReadout result="strike" speedMps={26.8} units="imperial" band="confident" />,
    );
    expect(html).toContain('Strike');
    expect(html).not.toContain('Ball');
  });

  it('renders the word BALL, not just a colour, for a ball call', () => {
    const html = renderToStaticMarkup(<CallReadout result="ball" speedMps={24.1} units="imperial" band="confident" />);
    expect(html).toContain('Ball');
    expect(html).not.toContain('Strike');
  });

  it('uses the asymmetric animation classes: strike overshoots, ball does not', () => {
    const strikeHtml = renderToStaticMarkup(
      <CallReadout result="strike" speedMps={26.8} units="imperial" band="confident" />,
    );
    const ballHtml = renderToStaticMarkup(<CallReadout result="ball" speedMps={24.1} units="imperial" band="confident" />);
    expect(strikeHtml).toContain('animate-strike-pop');
    expect(ballHtml).toContain('animate-ball-pulse');
    expect(strikeHtml).not.toContain('animate-ball-pulse');
    expect(ballHtml).not.toContain('animate-strike-pop');
  });

  it('never hides a low-confidence call: the word and the caveats still render', () => {
    const html = renderToStaticMarkup(
      <CallReadout
        result="ball"
        speedMps={24.1}
        units="imperial"
        band="flagged"
        caveats={['Track quality is too low to trust this call; treat it as provisional.']}
      />,
    );
    expect(html).toContain('Ball');
    expect(html).toContain('Flagged');
    expect(html).toContain('too low to trust');
  });

  it('carries the call in text, not colour alone: velocity is tabular-numeral text', () => {
    const html = renderToStaticMarkup(<CallReadout result="strike" speedMps={26.8} units="imperial" band="confident" />);
    expect(html).toContain('class="num');
  });
});
