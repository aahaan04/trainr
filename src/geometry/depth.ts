/**
 * Monocular depth from apparent ball size (Section 4). The estimate is noisy —
 * pixel-level jitter in the rotated-rect minor axis translates directly into range
 * error, worse at longer range because the ball subtends fewer pixels — so every
 * sample carries a 1-sigma uncertainty for the trajectory fit to weight against.
 */

import { BALL } from '@/domain/constants';
import type { CameraCalibration, Vec2, Vec3 } from '@/domain/types';
import { depthFromDiameterPx, matTransposeMulVec, rodriguesToMatrix, undistort } from '@/vision/camera';

/** Typical sub-pixel centroid/edge noise for a well-segmented blob. */
export const DEFAULT_MINOR_AXIS_SIGMA_PX = 0.75;

export interface MonocularSample {
  position: Vec3;
  depthM: number;
  /** 1-sigma isotropic position uncertainty in metres. */
  sigmaM: number;
}

/**
 * depth = fx*D/px, so d(depth)/d(px) = -depth/px. Propagating a pixel-noise sigma
 * through that derivative gives the depth-noise sigma directly, no linearisation error
 * beyond the usual small-perturbation assumption.
 */
export function depthSigmaM(
  depthM: number,
  minorAxisPx: number,
  minorAxisSigmaPx: number = DEFAULT_MINOR_AXIS_SIGMA_PX,
): number {
  return Math.abs(depthM / Math.max(minorAxisPx, 1)) * minorAxisSigmaPx;
}

/**
 * Reconstructs the world point implied by a single camera's pixel + apparent
 * diameter. `depthM` here is the optical-axis depth (camera-space z), matching
 * `depthFromDiameterPx`'s convention, so the point is built directly from the
 * undistorted normalised ray rather than by walking a unit ray for `depthM` metres.
 */
export function monocularSample(
  cal: CameraCalibration,
  pixel: Vec2,
  minorAxisPx: number,
  minorAxisSigmaPx: number = DEFAULT_MINOR_AXIS_SIGMA_PX,
): MonocularSample {
  const { intrinsics: intr, extrinsics: ext } = cal;
  const depthM = depthFromDiameterPx(intr, BALL.DIAMETER_M, minorAxisPx);
  const u = undistort((pixel.x - intr.cx) / intr.fx, (pixel.y - intr.cy) / intr.fy, intr.k1);
  const camPoint: Vec3 = { x: u.x * depthM, y: u.y * depthM, z: depthM };
  const R = rodriguesToMatrix(ext.rvec);
  const t = ext.tvec;
  const position = matTransposeMulVec(R, {
    x: camPoint.x - t[0],
    y: camPoint.y - t[1],
    z: camPoint.z - t[2],
  });

  const sigmaDepthM = depthSigmaM(depthM, minorAxisPx, minorAxisSigmaPx);
  // Lateral (in-image-plane) uncertainty from ~1px of centroid noise, which grows
  // with range the same way the depth term does.
  const sigmaLateralM = depthM / intr.fx;
  const sigmaM = Math.hypot(sigmaDepthM, sigmaLateralM);

  return { position, depthM, sigmaM };
}
