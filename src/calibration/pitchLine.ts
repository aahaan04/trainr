/**
 * The pitch-line axis. Because the world frame is defined directly by the tapped
 * plate model (origin at the back point, +Z toward the pitcher's rubber), the axis
 * itself needs no separate estimation — it's world +Z by construction. What this
 * derives is where along that axis the rubber sits, from the configured pitching
 * distance, so the wizard and diagram can render it.
 */

import type { Vec3 } from '@/domain/types';
import { rubberZ } from '@/domain/constants';

export interface PitchLine {
  rubber: Vec3;
  plateBack: Vec3;
  /** Unit direction from the rubber toward the plate. */
  direction: Vec3;
}

export function pitchLineForDistance(distanceFt: number): PitchLine {
  return {
    rubber: { x: 0, y: 0, z: rubberZ(distanceFt) },
    plateBack: { x: 0, y: 0, z: 0 },
    direction: { x: 0, y: 0, z: 1 },
  };
}
