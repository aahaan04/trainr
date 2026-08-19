import type { SVGProps } from 'react';

/** Small stroke icon set for the tab bar. No icon library dependency — five glyphs don't need one. */
const base: SVGProps<SVGSVGElement> = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
};

export function HomeIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base} {...props}>
      <path d="M3 11.5 12 4l9 7.5" />
      <path d="M5.5 10v9a1 1 0 0 0 1 1H10v-6h4v6h3.5a1 1 0 0 0 1-1v-9" />
    </svg>
  );
}

export function TargetIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base} {...props}>
      <circle cx="12" cy="12" r="8" />
      <circle cx="12" cy="12" r="4" />
      <circle cx="12" cy="12" r="0.5" fill="currentColor" />
    </svg>
  );
}

export function TrendIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base} {...props}>
      <path d="M4 19V9M11 19V5M18 19v-7" />
      <path d="M3 19h18" />
    </svg>
  );
}

export function GearIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base} {...props}>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 13a7.6 7.6 0 0 0 0-2l2-1.5-2-3.5-2.4.7a7.7 7.7 0 0 0-1.7-1L14.8 3h-4l-.5 2.7a7.7 7.7 0 0 0-1.7 1l-2.4-.7-2 3.5L6.2 11a7.6 7.6 0 0 0 0 2l-2 1.5 2 3.5 2.4-.7a7.7 7.7 0 0 0 1.7 1l.5 2.7h4l.5-2.7a7.7 7.7 0 0 0 1.7-1l2.4.7 2-3.5-2-1.5Z" />
    </svg>
  );
}

export function SunIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base} {...props}>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1" />
    </svg>
  );
}

export function InfoIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base} {...props}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v6M12 8v.01" />
    </svg>
  );
}
