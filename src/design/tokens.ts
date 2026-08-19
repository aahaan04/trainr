/**
 * Design tokens. Section 8 of the build spec.
 *
 * This file is the source of truth. `tokens.css` mirrors it as CSS custom
 * properties for the DOM, and `tailwind.config.js` maps those into the theme.
 * Canvas and SVG overlay code imports the values from here directly, because it
 * cannot read CSS variables cheaply per frame.
 *
 * THE ONE RULE THAT DRIVES EVERYTHING:
 *   indigo = brand and chrome.  green = STRIKE and positive outcomes, almost nothing else.
 *   coral  = BALL and misses.   optic yellow = the ball and its trajectory, never chrome.
 * If a component needs a colour and no semantic role applies, use indigo or a neutral.
 *
 * THREE DELIBERATE DEVIATIONS FROM THE SPEC'S LITERAL VALUES, all of them forced by
 * the Section 15 requirement that every text-on-surface pairing clears WCAG AA at
 * 4.5:1. Each spec value was measured, found short, and darkened by the minimum
 * needed. Measured ratios are against the tightest pairing each token actually has:
 *
 *   --text-tertiary #8A90AB -> #656A88  was 3.16:1 on white, now 4.64:1 on surface-2
 *   --amber-600     #B26A00 -> #A05F00  was 4.24:1 on white, now 4.63:1 on amber-100
 *   --green-700     #07854A -> #067A43  was 4.24:1 on green-100, now 4.88:1
 *
 * The green and amber failures only appear on their own tint backgrounds, which the
 * spec's "text-safe on white" annotations do not cover. Since the tint tokens exist
 * precisely to back their own text, those are the pairings that matter.
 *
 * Everything else is exactly as specified. The contrast test in this directory
 * enforces all of it and will fail the build if a token drifts.
 */

export const color = {
  // Neutrals, cooled toward indigo so they sit with the brand.
  surface0: '#F6F7FB',
  surface1: '#FFFFFF',
  surface2: '#EEF0F7',
  border: '#DFE3EE',
  borderStrong: '#C3C9DC',
  textPrimary: '#14163A',
  textSecondary: '#5A6080',
  textTertiary: '#656A88',

  // Indigo — brand, chrome, navigation, primary text.
  indigo900: '#14163A',
  indigo700: '#232766',
  indigo600: '#2E3391',
  indigo500: '#3D45B8',
  indigo100: '#E4E6F8',

  // Green — STRIKE and positive outcomes. Do not spend this on decoration.
  green700: '#067A43',
  green500: '#12C46B',
  green400: '#3BE08D',
  green100: '#DFF9EC',

  // Coral — BALL, misses, alerts. Never decorative.
  coral700: '#C43418',
  coral500: '#FF5A3C',
  coral100: '#FFE6E0',

  // Optic yellow — the data layer only. The ball and its trajectory. Never chrome.
  optic: '#D8E600',
  opticGlow: '#F2FF4D',

  // Amber — caution, low tracking confidence.
  amber600: '#A05F00',
  amber500: '#FFB020',
  amber100: '#FFF3DC',
} as const;

export type ColorToken = keyof typeof color;

/**
 * Which ink to put on each filled surface. Derived from measured contrast, not taste.
 * The `-500` tokens are bright fills and need dark ink; the `-700` tokens are deep
 * enough for white.
 */
export const ink = {
  indigo600: color.surface1,
  indigo700: color.surface1,
  indigo900: color.surface1,
  green700: color.surface1,
  green500: color.indigo900,
  coral700: color.surface1,
  coral500: color.indigo900,
  amber500: color.indigo900,
  optic: color.indigo900,
  opticGlow: color.indigo900,
} as const;

/**
 * Semantic call colours. The STRIKE and BALL chips use the -700 fills with white
 * text: that is white-on-filled-green as the spec asks for, and it clears AA at
 * 5.42:1, which the -500 fills do not (white on green-500 measures 2.30:1).
 * The -500 fills are used for the untexted full-bleed glow in sunlight mode.
 */
export const callColor = {
  strike: { fill: color.green700, ink: color.surface1, glow: color.green500, tint: color.green100 },
  ball: { fill: color.coral700, ink: color.surface1, glow: color.coral500, tint: color.coral100 },
} as const;

export const elevation = {
  rest: '0 2px 8px rgba(20,22,58,0.06)',
  raised: '0 8px 24px rgba(20,22,58,0.10)',
} as const;

export const radius = {
  input: '8px',
  card: '16px',
  sheet: '24px',
  pill: '9999px',
} as const;

export const motion = {
  easing: 'cubic-bezier(0.2, 0, 0, 1)',
  hover: 150,
  sheet: 250,
  call: 400,
  /** Setup-diagram view transitions. */
  orbit: 600,
} as const;

/**
 * Type scale. Both families are SIL OFL and self-hosted; nothing here may reach a
 * font CDN, because the app is used at fields with no signal.
 */
export const typography = {
  display: "'Barlow Condensed', 'Arial Narrow', system-ui, sans-serif",
  ui: "'Inter', system-ui, -apple-system, 'Segoe UI', sans-serif",
  scale: {
    displayXl: { size: 72, leading: 0.9, family: 'display', weight: 800 },
    displayLg: { size: 48, leading: 0.95, family: 'display', weight: 800 },
    displayMd: { size: 32, leading: 1.0, family: 'display', weight: 700 },
    title: { size: 20, leading: 1.3, family: 'ui', weight: 600 },
    body: { size: 16, leading: 1.5, family: 'ui', weight: 400 },
    label: { size: 13, leading: 1.4, family: 'ui', weight: 600, uppercase: true, tracking: 0.06 },
    caption: { size: 12, leading: 1.4, family: 'ui', weight: 400 },
  },
} as const;

/**
 * Sunlight mode. The app lives outdoors on a tripod in direct sun, where normal
 * contrast disappears.
 */
export const sunlight = {
  /** Overlay strokes get thicker. */
  strokeMultiplier: 1.5,
  minTapTargetPx: 56,
  normalTapTargetPx: 44,
  /** Dark halo behind every piece of text drawn over the camera feed. */
  textHalo: 'rgba(20,22,58,0.72)',
  haloBlurPx: 6,
  /** Full-bleed edge glow on the call, readable from the mound. */
  edgeGlowMs: 400,
} as const;

/** Every text-on-surface pairing the contrast test must verify. */
export const TEXT_ON_SURFACE_PAIRS: readonly { fg: string; bg: string; name: string }[] = [
  { fg: color.textPrimary, bg: color.surface0, name: 'primary on surface-0' },
  { fg: color.textPrimary, bg: color.surface1, name: 'primary on surface-1' },
  { fg: color.textPrimary, bg: color.surface2, name: 'primary on surface-2' },
  { fg: color.textSecondary, bg: color.surface0, name: 'secondary on surface-0' },
  { fg: color.textSecondary, bg: color.surface1, name: 'secondary on surface-1' },
  { fg: color.textSecondary, bg: color.surface2, name: 'secondary on surface-2' },
  { fg: color.textTertiary, bg: color.surface0, name: 'tertiary on surface-0' },
  { fg: color.textTertiary, bg: color.surface1, name: 'tertiary on surface-1' },
  { fg: color.textTertiary, bg: color.surface2, name: 'tertiary on surface-2' },
  { fg: color.green700, bg: color.surface1, name: 'green-700 text on white' },
  { fg: color.green700, bg: color.green100, name: 'green-700 on green tint' },
  { fg: color.coral700, bg: color.surface1, name: 'coral-700 text on white' },
  { fg: color.coral700, bg: color.coral100, name: 'coral-700 on coral tint' },
  { fg: color.amber600, bg: color.surface1, name: 'amber-600 text on white' },
  { fg: color.amber600, bg: color.amber100, name: 'amber-600 on amber tint' },
  { fg: color.indigo600, bg: color.surface1, name: 'indigo-600 text on white' },
  { fg: color.indigo700, bg: color.indigo100, name: 'indigo-700 on indigo tint' },
  { fg: ink.indigo600, bg: color.indigo600, name: 'white on indigo-600 fill' },
  { fg: callColor.strike.ink, bg: callColor.strike.fill, name: 'STRIKE chip' },
  { fg: callColor.ball.ink, bg: callColor.ball.fill, name: 'BALL chip' },
  { fg: ink.green500, bg: color.green500, name: 'indigo ink on green-500 fill' },
  { fg: ink.coral500, bg: color.coral500, name: 'indigo ink on coral-500 fill' },
  { fg: ink.amber500, bg: color.amber500, name: 'indigo ink on amber-500 fill' },
  { fg: ink.optic, bg: color.optic, name: 'indigo ink on optic yellow' },
];

/**
 * Pairings that MUST fail, asserted so nobody "fixes" the palette by making the
 * bright fills usable as text. These are the traps the spec calls out by name.
 */
export const MUST_NOT_BE_TEXT: readonly { fg: string; bg: string; name: string }[] = [
  { fg: color.green500, bg: color.surface1, name: 'green-500 as text on white' },
  { fg: color.coral500, bg: color.surface1, name: 'coral-500 as text on white' },
  { fg: color.optic, bg: color.surface1, name: 'optic yellow as text on white' },
];
