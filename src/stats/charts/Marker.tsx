import type { PitchTypeId } from '@/domain/types';
import { PITCH_TYPE_STYLE, markerPath } from './pitchTypeStyle';

export interface MarkerProps {
  typeId: PitchTypeId | null;
  cx: number;
  cy: number;
  r?: number;
  opacity?: number;
}

const UNKNOWN_FILL = 'none';

/** One scatter-plot marker: colour AND shape both carry the pitch-type distinction. */
export function Marker({ typeId, cx, cy, r = 5, opacity = 0.85 }: MarkerProps) {
  const style = typeId ? PITCH_TYPE_STYLE[typeId] : null;
  const fill = style?.fill ?? UNKNOWN_FILL;
  const shape = style?.shape ?? 'ring';

  if (shape === 'ring') {
    return <circle cx={cx} cy={cy} r={r} fill="none" stroke={fill === 'none' ? 'currentColor' : fill} strokeWidth={1.75} opacity={opacity} />;
  }
  if (shape === 'circle') {
    return <circle cx={cx} cy={cy} r={r} fill={fill} opacity={opacity} />;
  }
  return (
    <path d={markerPath(shape, r)} fill={fill} opacity={opacity} transform={`translate(${cx}, ${cy})`} />
  );
}
