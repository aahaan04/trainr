import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Button } from '../primitives/Button';
import { Pill } from '../primitives/Pill';
import { Toggle } from '../primitives/Toggle';
import { CallReadout } from '../primitives/CallReadout';
import { EdgeGlow } from '../primitives/EdgeGlow';

/**
 * Sunlight mode raises `--tap-target` from 44px to 56px and thickens overlay
 * strokes purely via CSS custom properties (tokens.css, foundation, not owned by
 * this workstream). Components can't re-derive that at the React layer without
 * duplicating the foundation — the correct, testable contract for THIS layer is
 * that interactive primitives use the `min-h-tap` / `min-w-tap` utility classes
 * (which read `--tap-target`) instead of a hardcoded pixel size, so the CSS
 * variable swap is all that's needed for them to grow with it.
 */
describe('sunlight-mode tap targets', () => {
  it('Button sizes itself from the shared tap-target token, not a fixed pixel height', () => {
    const html = renderToStaticMarkup(<Button>Start</Button>);
    expect(html).toContain('min-h-tap');
    expect(html).not.toMatch(/height:\s*44px/);
  });

  it('Pill (the pitch-type-style picker) meets the tap-target token on both axes', () => {
    const html = renderToStaticMarkup(<Pill>FB</Pill>);
    expect(html).toContain('min-h-tap');
    expect(html).toContain('min-w-tap');
  });

  it('Toggle (used in Settings, worn with a glove) meets the tap-target token', () => {
    const html = renderToStaticMarkup(<Toggle checked={false} onChange={() => {}} label="Sunlight mode" />);
    expect(html).toContain('min-h-tap');
  });
});

/**
 * Reduced motion is handled globally in tokens.css: any element carrying an
 * `animation-*` still fires the animation-end events React relies on, but its
 * duration is forced to ~0 and its colour change still happens instantly — scale
 * and travel disappear, the outcome doesn't. That only works if components use the
 * Tailwind `animate-*` utility classes rather than driving the same motion from
 * inline styles or JS, which the global override can't reach.
 */
describe('prefers-reduced-motion compatibility', () => {
  it('CallReadout drives its pop/pulse via the animate-* utility classes', () => {
    const strike = renderToStaticMarkup(<CallReadout result="strike" speedMps={26.8} units="imperial" band="confident" />);
    const ball = renderToStaticMarkup(<CallReadout result="ball" speedMps={24.1} units="imperial" band="confident" />);
    expect(strike).toContain('animate-strike-pop');
    expect(ball).toContain('animate-ball-pulse');
    expect(strike).not.toMatch(/style="[^"]*transform/);
    expect(ball).not.toMatch(/style="[^"]*transform/);
  });

  it('EdgeGlow drives the full-bleed flash via the animate-edge-glow utility class', () => {
    const html = renderToStaticMarkup(<EdgeGlow result="strike" />);
    expect(html).toContain('animate-edge-glow');
  });

  it('EdgeGlow renders nothing without a call, so nothing animates before one exists', () => {
    const html = renderToStaticMarkup(<EdgeGlow result={null} />);
    expect(html).toBe('');
  });

  it('EdgeGlow colours strike green and ball coral, matching the call it replays', () => {
    const strike = renderToStaticMarkup(<EdgeGlow result="strike" />);
    const ball = renderToStaticMarkup(<EdgeGlow result="ball" />);
    expect(strike).toContain('--green-500');
    expect(ball).toContain('--coral-500');
  });
});
