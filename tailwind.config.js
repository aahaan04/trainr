/**
 * The Section 8 tokens ARE the theme. Components use `bg-indigo-600`, `text-green-700`
 * and so on — never arbitrary values like `bg-[#2E3391]`. If a colour is needed that
 * is not in here, the answer is indigo or a neutral, not a new hex.
 */

/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    // Replaces Tailwind's default palette outright, so a stray `bg-blue-500`
    // is a build-visible mistake rather than a silently off-brand colour.
    colors: {
      transparent: 'transparent',
      current: 'currentColor',
      white: '#FFFFFF',
      black: '#000000',

      surface: {
        0: 'var(--surface-0)',
        1: 'var(--surface-1)',
        2: 'var(--surface-2)',
      },
      border: {
        DEFAULT: 'var(--border)',
        strong: 'var(--border-strong)',
      },
      ink: {
        DEFAULT: 'var(--text-primary)',
        secondary: 'var(--text-secondary)',
        tertiary: 'var(--text-tertiary)',
      },
      indigo: {
        100: 'var(--indigo-100)',
        500: 'var(--indigo-500)',
        600: 'var(--indigo-600)',
        700: 'var(--indigo-700)',
        900: 'var(--indigo-900)',
      },
      green: {
        100: 'var(--green-100)',
        400: 'var(--green-400)',
        500: 'var(--green-500)',
        700: 'var(--green-700)',
      },
      coral: {
        100: 'var(--coral-100)',
        500: 'var(--coral-500)',
        700: 'var(--coral-700)',
      },
      amber: {
        100: 'var(--amber-100)',
        500: 'var(--amber-500)',
        600: 'var(--amber-600)',
      },
      optic: {
        DEFAULT: 'var(--optic)',
        glow: 'var(--optic-glow)',
      },
    },

    borderRadius: {
      none: '0',
      input: 'var(--radius-input)',
      DEFAULT: 'var(--radius-input)',
      card: 'var(--radius-card)',
      sheet: 'var(--radius-sheet)',
      pill: 'var(--radius-pill)',
      full: '9999px',
    },

    boxShadow: {
      none: 'none',
      rest: 'var(--elev-rest)',
      raised: 'var(--elev-raised)',
    },

    fontFamily: {
      display: 'var(--font-display)',
      ui: 'var(--font-ui)',
      sans: 'var(--font-ui)',
    },

    fontSize: {
      'display-xl': ['72px', { lineHeight: '0.9', fontWeight: '800' }],
      'display-lg': ['48px', { lineHeight: '0.95', fontWeight: '800' }],
      'display-md': ['32px', { lineHeight: '1.0', fontWeight: '700' }],
      title: ['20px', { lineHeight: '1.3', fontWeight: '600' }],
      body: ['16px', { lineHeight: '1.5', fontWeight: '400' }],
      label: ['13px', { lineHeight: '1.4', fontWeight: '600', letterSpacing: '0.06em' }],
      caption: ['12px', { lineHeight: '1.4', fontWeight: '400' }],
    },

    extend: {
      transitionTimingFunction: {
        DEFAULT: 'var(--ease)',
        brand: 'var(--ease)',
      },
      transitionDuration: {
        hover: '150ms',
        sheet: '250ms',
        call: '400ms',
        orbit: '600ms',
      },
      minWidth: { tap: 'var(--tap-target)' },
      minHeight: { tap: 'var(--tap-target)' },
      keyframes: {
        // Strike gets an overshoot; ball does not. A strike should feel better.
        strikePop: {
          '0%': { transform: 'scale(0.9)', opacity: '0' },
          '60%': { transform: 'scale(1.04)', opacity: '1' },
          '100%': { transform: 'scale(1)', opacity: '1' },
        },
        ballPulse: {
          '0%': { transform: 'scale(0.96)', opacity: '0' },
          '100%': { transform: 'scale(1)', opacity: '1' },
        },
        edgeGlow: {
          '0%, 100%': { opacity: '0' },
          '25%, 60%': { opacity: '1' },
        },
        ribbonDraw: {
          from: { strokeDashoffset: '1' },
          to: { strokeDashoffset: '0' },
        },
      },
      animation: {
        'strike-pop': 'strikePop 400ms var(--ease) both',
        'ball-pulse': 'ballPulse 400ms var(--ease) both',
        'edge-glow': 'edgeGlow 400ms var(--ease) both',
        'ribbon-draw': 'ribbonDraw 1200ms var(--ease) both',
      },
    },
  },
  plugins: [],
};
