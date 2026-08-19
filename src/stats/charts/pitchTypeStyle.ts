/**
 * Categorical styling for pitch types in scatter charts (Section 8.7): the one
 * legitimate exception to the semantic palette, but still off-limits are green
 * (STRIKE), coral (BALL) and optic yellow (the ball/trajectory). Drawn from the
 * indigo family plus neutrals, and paired with a distinct marker SHAPE per type so
 * nothing here is colour-only.
 */

import { color } from '@/design/tokens';
import type { PitchTypeId } from '@/domain/types';

export type MarkerShape = 'circle' | 'square' | 'triangleUp' | 'triangleDown' | 'diamond' | 'cross' | 'ring' | 'star';

export interface PitchTypeStyle {
  fill: string;
  shape: MarkerShape;
}

export const PITCH_TYPE_STYLE: Record<PitchTypeId, PitchTypeStyle> = {
  fastball: { fill: color.indigo600, shape: 'circle' },
  changeup: { fill: color.indigo900, shape: 'square' },
  drop: { fill: color.textSecondary, shape: 'triangleDown' },
  rise: { fill: color.indigo500, shape: 'triangleUp' },
  curve: { fill: color.textTertiary, shape: 'diamond' },
  screw: { fill: color.indigo700, shape: 'cross' },
  dropCurve: { fill: color.indigo600, shape: 'ring' },
  custom: { fill: color.borderStrong, shape: 'star' },
};

/** SVG path/shape markup for a marker centred at (0,0), sized to fit roughly a 2*r box. */
export function markerPath(shape: MarkerShape, r: number): string {
  switch (shape) {
    case 'square':
      return `M ${-r} ${-r} H ${r} V ${r} H ${-r} Z`;
    case 'triangleUp':
      return `M 0 ${-r} L ${r} ${r} L ${-r} ${r} Z`;
    case 'triangleDown':
      return `M 0 ${r} L ${r} ${-r} L ${-r} ${-r} Z`;
    case 'diamond':
      return `M 0 ${-r} L ${r} 0 L 0 ${r} L ${-r} 0 Z`;
    case 'cross': {
      const w = r * 0.34;
      return [
        `M ${-w} ${-r} H ${w} V ${-w} H ${r} V ${w} H ${w} V ${r} H ${-w} V ${w} H ${-r} V ${-w} H ${-w} Z`,
      ].join(' ');
    }
    case 'star': {
      const points: string[] = [];
      for (let i = 0; i < 10; i++) {
        const rad = i % 2 === 0 ? r : r * 0.45;
        const angle = (Math.PI / 5) * i - Math.PI / 2;
        points.push(`${(Math.cos(angle) * rad).toFixed(2)} ${(Math.sin(angle) * rad).toFixed(2)}`);
      }
      return `M ${points.join(' L ')} Z`;
    }
    case 'ring':
    case 'circle':
    default:
      return '';
  }
}
