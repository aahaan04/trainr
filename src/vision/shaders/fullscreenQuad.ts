/**
 * Trivial fullscreen-triangle vertex shader shared by every segmentation pass.
 * Draws a single oversized triangle rather than a two-triangle quad so there is no
 * shared-edge seam to worry about.
 */
export const FULLSCREEN_QUAD_VERT = `#version 300 es
layout(location = 0) in vec2 aPos;
out vec2 vUv;

void main() {
  vUv = aPos * 0.5 + 0.5;
  gl_Position = vec4(aPos, 0.0, 1.0);
}
`;

/** Clip-space positions for one oversized triangle covering [-1,1]^2. */
export const FULLSCREEN_TRIANGLE_VERTS = new Float32Array([-1, -1, 3, -1, -1, 3]);
