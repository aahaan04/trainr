/**
 * WebGL2 fragment shader: box-downsamples the source frame, converts to HSV, gates
 * against the calibrated colour, and folds in temporal background subtraction so a
 * static yellow object (jersey, bucket) is suppressed while the moving ball is not.
 *
 * Mirrors src/vision/segmentation.ts's CpuSegmenter exactly -- same gate test, same
 * increment/decrement running-median approximation, same motion-diff threshold --
 * so the two paths agree. The CPU path is the one the regression suite exercises;
 * this shader is the optional real-time accelerator for platforms with WebGL2.
 *
 * State (background estimate + previous foreground flag) round-trips through a
 * ping-ponged RGBA8 texture: rgb = running background estimate, a = last mask.
 */
export const HSV_SEGMENT_FRAG = `#version 300 es
precision highp float;
precision highp int;

uniform sampler2D uSource;
uniform sampler2D uPrevState;
uniform ivec2 uSourceSize;
uniform ivec2 uMaskSize;
uniform int uDownscale;
uniform vec3 uGateLo;
uniform vec3 uGateHi;
uniform float uBgStep;
uniform float uMotionThreshold;

in vec2 vUv;
out vec4 fragColor;

vec3 rgbToHsv(vec3 c) {
  vec4 K = vec4(0.0, -1.0 / 3.0, 2.0 / 3.0, -1.0);
  vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g));
  vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r));
  float d = q.x - min(q.w, q.y);
  float e = 1.0e-10;
  float h = abs(q.z + (q.w - q.y) / (6.0 * d + e));
  return vec3(h, d / (q.x + e), q.x);
}

bool inGate(vec3 hsvNorm) {
  bool hOk = uGateLo.x <= uGateHi.x
    ? (hsvNorm.x >= uGateLo.x && hsvNorm.x <= uGateHi.x)
    : (hsvNorm.x >= uGateLo.x || hsvNorm.x <= uGateHi.x);
  return hOk
    && hsvNorm.y >= uGateLo.y && hsvNorm.y <= uGateHi.y
    && hsvNorm.z >= uGateLo.z && hsvNorm.z <= uGateHi.z;
}

void main() {
  ivec2 maskXy = ivec2(vUv * vec2(uMaskSize));
  maskXy = clamp(maskXy, ivec2(0), uMaskSize - ivec2(1));
  ivec2 base = maskXy * uDownscale;

  vec3 sum = vec3(0.0);
  int taps = 0;
  // uDownscale is small (2-4) and uniform per draw; the fixed 4x4 bound keeps the
  // loop statically unrollable while the break skips the unused taps.
  for (int dy = 0; dy < 4; dy++) {
    if (dy >= uDownscale) break;
    for (int dx = 0; dx < 4; dx++) {
      if (dx >= uDownscale) break;
      ivec2 p = min(base + ivec2(dx, dy), uSourceSize - ivec2(1));
      sum += texelFetch(uSource, p, 0).rgb;
      taps++;
    }
  }
  vec3 avg = sum / float(max(taps, 1));

  vec4 prev = texelFetch(uPrevState, maskXy, 0);
  vec3 bg = prev.rgb;
  vec3 dir = sign(avg - bg);
  vec3 newBg = bg + dir * uBgStep;

  float diff = max(max(abs(avg.r - bg.r), abs(avg.g - bg.g)), abs(avg.b - bg.b));
  vec3 hsv = rgbToHsv(avg);
  bool fg = inGate(hsv) && diff > uMotionThreshold;

  fragColor = vec4(newBg, fg ? 1.0 : 0.0);
}
`;
