/** WCAG 2.1 relative luminance and contrast ratio. Used by the CI accessibility check. */

export function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  const n = parseInt(full, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function channelLuminance(c8: number): number {
  const c = c8 / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

export function relativeLuminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex);
  return 0.2126 * channelLuminance(r) + 0.7152 * channelLuminance(g) + 0.0722 * channelLuminance(b);
}

export function contrastRatio(fg: string, bg: string): number {
  const a = relativeLuminance(fg);
  const b = relativeLuminance(bg);
  const [hi, lo] = a > b ? [a, b] : [b, a];
  return (hi + 0.05) / (lo + 0.05);
}

/** AA is 4.5:1 for normal text, 3:1 for large text (>=24px, or >=18.66px bold). */
export function passesAA(fg: string, bg: string, large = false): boolean {
  return contrastRatio(fg, bg) >= (large ? 3 : 4.5);
}
