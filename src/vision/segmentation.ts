/**
 * Segmentation: HSV threshold plus temporal background subtraction, producing a
 * binary foreground mask at half resolution (CAPTURE.MASK_DOWNSCALE).
 *
 * Two implementations share one contract (`Segmenter`):
 *   - `CpuSegmenter` is pure TypeScript over typed arrays. It is what the Node-based
 *     regression suite exercises and MUST be correct on its own.
 *   - `GpuSegmenter` runs the same gate + background model in a WebGL2 fragment
 *     shader (src/vision/shaders/hsvSegment.ts) for real-time use in the browser. It
 *     is a pure accelerator: `createSegmenter` falls back to the CPU path whenever
 *     WebGL2 isn't available (Safari/WebGPU-only, headless test runners, etc).
 *
 * Background model: an O(1)-per-pixel increment/decrement estimator (move the
 * background 1 step toward the current sample every frame) rather than a literal
 * sorted-window median. It converges to the true running median in roughly
 * TRACKING.BACKGROUND_WINDOW frames for a step change, at a fraction of the cost of
 * maintaining real per-pixel history, which matters at 720p60 under an 8ms budget.
 */

import { CAPTURE, HSV_OPENCV_MAX, TRACKING, hsvGateToNormalized } from '@/domain/constants';
import type { HsvGate } from '@/domain/types';
import { FULLSCREEN_QUAD_VERT, FULLSCREEN_TRIANGLE_VERTS } from './shaders/fullscreenQuad';
import { HSV_SEGMENT_FRAG } from './shaders/hsvSegment';

const MOTION_DIFF_THRESHOLD = 20;

export interface SourceFrame {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

export interface SegmentationResult {
  /** Binary foreground mask, 1 = candidate ball pixel. Row-major, maskWidth x maskHeight. */
  mask: Uint8Array;
  /** OpenCV-convention hue (0-179) per mask pixel, for downstream blob hue stats. */
  hue: Uint8Array;
  maskWidth: number;
  maskHeight: number;
}

export interface Segmenter {
  process(frame: SourceFrame): SegmentationResult;
  reset(): void;
}

/** RGB (0-255 each) -> OpenCV HSV: H 0-179, S 0-255, V 0-255. */
export function rgbToHsvOpenCv(r: number, g: number, b: number): [number, number, number] {
  const rf = r / 255;
  const gf = g / 255;
  const bf = b / 255;
  const max = Math.max(rf, gf, bf);
  const min = Math.min(rf, gf, bf);
  const v = max;
  const d = max - min;
  const s = max <= 1e-9 ? 0 : d / max;
  let h = 0;
  if (d > 1e-9) {
    if (max === rf) h = ((gf - bf) / d) % 6;
    else if (max === gf) h = (bf - rf) / d + 2;
    else h = (rf - gf) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return [h / 2, s * 255, v * 255];
}

function stepToward(oldV: number, target: number, step: number): number {
  if (oldV === target) return oldV;
  const next = oldV + Math.sign(target - oldV) * step;
  if ((target - oldV) * (target - next) < 0) return target; // overshoot guard
  return Math.min(255, Math.max(0, next));
}

/** Box-averages the frame down to mask resolution. Shared by both segmenter paths. */
function boxDownsample(
  frame: SourceFrame,
  downscale: number,
  maskWidth: number,
  maskHeight: number,
  avgOut: Float32Array,
): void {
  const { data, width, height } = frame;
  for (let my = 0; my < maskHeight; my++) {
    const y0 = my * downscale;
    for (let mx = 0; mx < maskWidth; mx++) {
      const x0 = mx * downscale;
      let r = 0;
      let g = 0;
      let b = 0;
      let n = 0;
      for (let dy = 0; dy < downscale; dy++) {
        const y = y0 + dy;
        if (y >= height) break;
        const rowBase = y * width;
        for (let dx = 0; dx < downscale; dx++) {
          const x = x0 + dx;
          if (x >= width) break;
          const i = (rowBase + x) * 4;
          r += data[i];
          g += data[i + 1];
          b += data[i + 2];
          n++;
        }
      }
      const idx = (my * maskWidth + mx) * 3;
      const inv = 1 / Math.max(n, 1);
      avgOut[idx] = r * inv;
      avgOut[idx + 1] = g * inv;
      avgOut[idx + 2] = b * inv;
    }
  }
}

export function hueGateOk(gate: HsvGate, h: number, s: number, v: number): boolean {
  const hOk = gate.hMin <= gate.hMax ? h >= gate.hMin && h <= gate.hMax : h >= gate.hMin || h <= gate.hMax;
  return hOk && s >= gate.sMin && s <= gate.sMax && v >= gate.vMin && v <= gate.vMax;
}

export class CpuSegmenter implements Segmenter {
  private readonly downscale: number;
  private readonly step: number;
  private maskWidth = 0;
  private maskHeight = 0;
  private avgBuf = new Float32Array(0);
  private bgR = new Float32Array(0);
  private bgG = new Float32Array(0);
  private bgB = new Float32Array(0);
  private maskBuf = new Uint8Array(0);
  private hueBuf = new Uint8Array(0);
  private initialized = false;

  constructor(
    private gate: HsvGate,
    downscale: number = CAPTURE.MASK_DOWNSCALE,
    backgroundWindow: number = TRACKING.BACKGROUND_WINDOW,
  ) {
    this.downscale = Math.max(1, Math.round(downscale));
    this.step = 255 / Math.max(1, backgroundWindow);
  }

  setGate(gate: HsvGate): void {
    this.gate = gate;
  }

  reset(): void {
    this.initialized = false;
  }

  private ensureBuffers(maskWidth: number, maskHeight: number): void {
    if (this.maskWidth === maskWidth && this.maskHeight === maskHeight && this.avgBuf.length > 0) return;
    this.maskWidth = maskWidth;
    this.maskHeight = maskHeight;
    const n = maskWidth * maskHeight;
    this.avgBuf = new Float32Array(n * 3);
    this.bgR = new Float32Array(n);
    this.bgG = new Float32Array(n);
    this.bgB = new Float32Array(n);
    this.maskBuf = new Uint8Array(n);
    this.hueBuf = new Uint8Array(n);
    this.initialized = false;
  }

  process(frame: SourceFrame): SegmentationResult {
    const maskWidth = Math.max(1, Math.floor(frame.width / this.downscale));
    const maskHeight = Math.max(1, Math.floor(frame.height / this.downscale));
    this.ensureBuffers(maskWidth, maskHeight);
    boxDownsample(frame, this.downscale, maskWidth, maskHeight, this.avgBuf);

    const n = maskWidth * maskHeight;
    const gate = this.gate;
    // Inlined RGB->HSV rather than calling rgbToHsvOpenCv: that helper returns a
    // fresh 3-element array, and allocating one per mask pixel dominated profiling
    // at 720p (230k pixels/frame) -- this loop is the actual per-frame hot path.
    for (let idx = 0; idx < n; idx++) {
      const r = this.avgBuf[idx * 3];
      const g = this.avgBuf[idx * 3 + 1];
      const b = this.avgBuf[idx * 3 + 2];

      const rf = r / 255;
      const gf = g / 255;
      const bf = b / 255;
      const max = Math.max(rf, gf, bf);
      const min = Math.min(rf, gf, bf);
      const v = max * 255;
      const d = max - min;
      const s = max <= 1e-9 ? 0 : (d / max) * 255;
      let hDeg = 0;
      if (d > 1e-9) {
        if (max === rf) hDeg = ((gf - bf) / d) % 6;
        else if (max === gf) hDeg = (bf - rf) / d + 2;
        else hDeg = (rf - gf) / d + 4;
        hDeg *= 60;
        if (hDeg < 0) hDeg += 360;
      }
      const h = hDeg / 2;
      this.hueBuf[idx] = h;

      if (!this.initialized) {
        this.bgR[idx] = r;
        this.bgG[idx] = g;
        this.bgB[idx] = b;
      }

      const oldR = this.bgR[idx];
      const oldG = this.bgG[idx];
      const oldB = this.bgB[idx];
      const diff = Math.max(Math.abs(r - oldR), Math.abs(g - oldG), Math.abs(b - oldB));

      this.bgR[idx] = stepToward(oldR, r, this.step);
      this.bgG[idx] = stepToward(oldG, g, this.step);
      this.bgB[idx] = stepToward(oldB, b, this.step);

      this.maskBuf[idx] = hueGateOk(gate, h, s, v) && diff > MOTION_DIFF_THRESHOLD ? 1 : 0;
    }
    this.initialized = true;

    return { mask: this.maskBuf, hue: this.hueBuf, maskWidth, maskHeight };
  }
}

// ---------------------------------------------------------------------------
// WebGL2 accelerator. Optional: never a hard dependency (Safari/WebGPU-only
// platforms fall back to CpuSegmenter via `createSegmenter` below). Not exercised
// by the Node regression suite, which has no WebGL2 context; correctness there
// rests on mirroring CpuSegmenter's gate and background-update math exactly.
// ---------------------------------------------------------------------------

function compileShader(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type);
  if (!shader) throw new Error('Failed to allocate WebGL2 shader');
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error(`Shader compile failed: ${log ?? 'unknown error'}`);
  }
  return shader;
}

function linkProgram(gl: WebGL2RenderingContext, vertSrc: string, fragSrc: string): WebGLProgram {
  const program = gl.createProgram();
  if (!program) throw new Error('Failed to allocate WebGL2 program');
  const vert = compileShader(gl, gl.VERTEX_SHADER, vertSrc);
  const frag = compileShader(gl, gl.FRAGMENT_SHADER, fragSrc);
  gl.attachShader(program, vert);
  gl.attachShader(program, frag);
  gl.linkProgram(program);
  gl.deleteShader(vert);
  gl.deleteShader(frag);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(program);
    gl.deleteProgram(program);
    throw new Error(`Program link failed: ${log ?? 'unknown error'}`);
  }
  return program;
}

interface StateTarget {
  texture: WebGLTexture;
  fbo: WebGLFramebuffer;
}

function createStateTarget(gl: WebGL2RenderingContext, width: number, height: number): StateTarget {
  const texture = gl.createTexture();
  if (!texture) throw new Error('Failed to allocate state texture');
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

  const fbo = gl.createFramebuffer();
  if (!fbo) throw new Error('Failed to allocate state framebuffer');
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  return { texture, fbo };
}

export class GpuSegmenter implements Segmenter {
  private readonly downscale: number;
  private readonly bgStep: number;
  private readonly program: WebGLProgram;
  private readonly vao: WebGLVertexArrayObject;
  private readonly uniforms: Record<string, WebGLUniformLocation | null>;
  private sourceTex: WebGLTexture | null = null;
  private states: [StateTarget, StateTarget] | null = null;
  private ping = 0;
  private sourceWidth = 0;
  private sourceHeight = 0;
  private maskWidth = 0;
  private maskHeight = 0;
  private readBack = new Uint8Array(0);
  private avgBuf = new Float32Array(0);
  private maskBuf = new Uint8Array(0);
  private hueBuf = new Uint8Array(0);

  constructor(
    private readonly gl: WebGL2RenderingContext,
    private gate: HsvGate,
    downscale: number = CAPTURE.MASK_DOWNSCALE,
    backgroundWindow: number = TRACKING.BACKGROUND_WINDOW,
  ) {
    this.downscale = Math.max(1, Math.min(4, Math.round(downscale)));
    this.bgStep = 255 / Math.max(1, backgroundWindow) / 255; // shader works in 0-1 normalized space
    this.program = linkProgram(gl, FULLSCREEN_QUAD_VERT, HSV_SEGMENT_FRAG);

    const vao = gl.createVertexArray();
    if (!vao) throw new Error('Failed to allocate VAO');
    this.vao = vao;
    gl.bindVertexArray(vao);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, FULLSCREEN_TRIANGLE_VERTS, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);

    this.uniforms = {};
    for (const name of [
      'uSource',
      'uPrevState',
      'uSourceSize',
      'uMaskSize',
      'uDownscale',
      'uGateLo',
      'uGateHi',
      'uBgStep',
      'uMotionThreshold',
    ]) {
      this.uniforms[name] = gl.getUniformLocation(this.program, name);
    }
  }

  setGate(gate: HsvGate): void {
    this.gate = gate;
  }

  reset(): void {
    const { gl } = this;
    if (this.states) {
      for (const s of this.states) {
        gl.bindFramebuffer(gl.FRAMEBUFFER, s.fbo);
        gl.clearColor(0, 0, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT);
      }
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }
    this.ping = 0;
  }

  private ensureTargets(sourceWidth: number, sourceHeight: number): void {
    if (this.sourceWidth === sourceWidth && this.sourceHeight === sourceHeight && this.sourceTex) return;
    const { gl } = this;
    this.sourceWidth = sourceWidth;
    this.sourceHeight = sourceHeight;
    this.maskWidth = Math.max(1, Math.floor(sourceWidth / this.downscale));
    this.maskHeight = Math.max(1, Math.floor(sourceHeight / this.downscale));

    this.sourceTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.sourceTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, sourceWidth, sourceHeight, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    this.states = [
      createStateTarget(gl, this.maskWidth, this.maskHeight),
      createStateTarget(gl, this.maskWidth, this.maskHeight),
    ];
    this.ping = 0;

    const n = this.maskWidth * this.maskHeight;
    this.readBack = new Uint8Array(n * 4);
    this.avgBuf = new Float32Array(n * 3);
    this.maskBuf = new Uint8Array(n);
    this.hueBuf = new Uint8Array(n);
  }

  process(frame: SourceFrame): SegmentationResult {
    const { gl } = this;
    this.ensureTargets(frame.width, frame.height);
    if (!this.sourceTex || !this.states) throw new Error('GpuSegmenter not initialized');

    gl.bindTexture(gl.TEXTURE_2D, this.sourceTex);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, frame.width, frame.height, gl.RGBA, gl.UNSIGNED_BYTE, frame.data);

    const prev = this.states[this.ping];
    const next = this.states[1 - this.ping];

    gl.bindFramebuffer(gl.FRAMEBUFFER, next.fbo);
    gl.viewport(0, 0, this.maskWidth, this.maskHeight);
    gl.useProgram(this.program);
    gl.bindVertexArray(this.vao);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.sourceTex);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, prev.texture);

    gl.uniform1i(this.uniforms.uSource, 0);
    gl.uniform1i(this.uniforms.uPrevState, 1);
    gl.uniform2i(this.uniforms.uSourceSize, frame.width, frame.height);
    gl.uniform2i(this.uniforms.uMaskSize, this.maskWidth, this.maskHeight);
    gl.uniform1i(this.uniforms.uDownscale, this.downscale);
    const { lo, hi } = hsvGateToNormalized(this.gate);
    gl.uniform3f(this.uniforms.uGateLo, lo[0], lo[1], lo[2]);
    gl.uniform3f(this.uniforms.uGateHi, hi[0], hi[1], hi[2]);
    gl.uniform1f(this.uniforms.uBgStep, this.bgStep);
    gl.uniform1f(this.uniforms.uMotionThreshold, MOTION_DIFF_THRESHOLD / HSV_OPENCV_MAX.v);

    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.readPixels(0, 0, this.maskWidth, this.maskHeight, gl.RGBA, gl.UNSIGNED_BYTE, this.readBack);

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.bindVertexArray(null);
    this.ping = 1 - this.ping;

    const n = this.maskWidth * this.maskHeight;
    for (let i = 0; i < n; i++) {
      this.maskBuf[i] = this.readBack[i * 4 + 3] > 127 ? 1 : 0;
    }
    // Hue is recomputed CPU-side from a fresh box-downsample: cheap relative to the
    // segmentation pass the GPU just did, and keeps blob hue stats bit-identical to
    // CpuSegmenter's regardless of which mask path produced the foreground flags.
    boxDownsample(frame, this.downscale, this.maskWidth, this.maskHeight, this.avgBuf);
    for (let i = 0; i < n; i++) {
      const [h] = rgbToHsvOpenCv(this.avgBuf[i * 3], this.avgBuf[i * 3 + 1], this.avgBuf[i * 3 + 2]);
      this.hueBuf[i] = h;
    }

    return { mask: this.maskBuf, hue: this.hueBuf, maskWidth: this.maskWidth, maskHeight: this.maskHeight };
  }
}

export interface CreateSegmenterOptions {
  gate: HsvGate;
  downscale?: number;
  backgroundWindow?: number;
  /** Injectable for tests / explicit GPU opt-in; auto-detected when omitted. */
  gl?: WebGL2RenderingContext | null;
}

function detectWebGL2(): WebGL2RenderingContext | null {
  if (typeof OffscreenCanvas === 'undefined') return null;
  try {
    const canvas = new OffscreenCanvas(2, 2);
    const gl = canvas.getContext('webgl2');
    return (gl as WebGL2RenderingContext | null) ?? null;
  } catch {
    return null;
  }
}

/** Picks the GPU path when WebGL2 is available, otherwise the CPU fallback. */
export function createSegmenter(opts: CreateSegmenterOptions): Segmenter {
  const gl = opts.gl !== undefined ? opts.gl : detectWebGL2();
  if (gl) {
    try {
      return new GpuSegmenter(gl, opts.gate, opts.downscale, opts.backgroundWindow);
    } catch {
      // Fall through to CPU on any shader/context failure.
    }
  }
  return new CpuSegmenter(opts.gate, opts.downscale, opts.backgroundWindow);
}
