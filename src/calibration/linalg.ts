/**
 * Minimal dense linear algebra for the calibration solvers. Every matrix here is
 * at most 9x9 (homography DLT) or 7x7 (pose refinement), so plain Gaussian
 * elimination with partial pivoting is simpler and plenty stable — no need to pull
 * in a linear-algebra dependency for two call sites.
 */

/**
 * Solves A x = b via Gaussian elimination with partial pivoting. Null if singular.
 *
 * The singularity test is RELATIVE to the largest entry in A, not absolute. These
 * systems are normal equations (A^T A), whose entries scale as the square of the
 * input coordinates, so a genuinely rank-deficient system built from pixel
 * coordinates can still show pivots far above any fixed epsilon. An absolute
 * threshold silently returns garbage for exactly the degenerate taps — five
 * collinear plate corners — that calibration most needs to reject.
 */
export function solveLinearSystem(aIn: readonly (readonly number[])[], bIn: readonly number[]): number[] | null {
  const n = bIn.length;
  const a = aIn.map((row) => row.slice());
  const b = bIn.slice();

  let scale = 0;
  for (const row of a) for (const v of row) scale = Math.max(scale, Math.abs(v));
  if (scale === 0) return null;
  const tol = scale * 1e-10;

  for (let col = 0; col < n; col++) {
    let pivotRow = col;
    let pivotVal = Math.abs(a[col][col]);
    for (let r = col + 1; r < n; r++) {
      if (Math.abs(a[r][col]) > pivotVal) {
        pivotVal = Math.abs(a[r][col]);
        pivotRow = r;
      }
    }
    if (pivotVal < tol) return null;
    if (pivotRow !== col) {
      [a[col], a[pivotRow]] = [a[pivotRow], a[col]];
      [b[col], b[pivotRow]] = [b[pivotRow], b[col]];
    }
    const pivot = a[col][col];
    for (let r = col + 1; r < n; r++) {
      const factor = a[r][col] / pivot;
      if (factor === 0) continue;
      for (let c = col; c < n; c++) a[r][c] -= factor * a[col][c];
      b[r] -= factor * b[col];
    }
  }

  const x = new Array(n).fill(0);
  for (let row = n - 1; row >= 0; row--) {
    let sum = b[row];
    for (let c = row + 1; c < n; c++) sum -= a[row][c] * x[c];
    x[row] = sum / a[row][row];
  }
  return x;
}

/** A^T * A for an m x n matrix A, returned as an n x n matrix. */
export function matTMulMat(a: readonly (readonly number[])[]): number[][] {
  const n = a[0].length;
  const out: number[][] = Array.from({ length: n }, () => new Array(n).fill(0));
  for (const row of a) {
    for (let i = 0; i < n; i++) {
      if (row[i] === 0) continue;
      for (let j = 0; j < n; j++) out[i][j] += row[i] * row[j];
    }
  }
  return out;
}

/** A^T * v for an m x n matrix A and length-m vector v. */
export function matTMulVec(a: readonly (readonly number[])[], v: readonly number[]): number[] {
  const n = a[0].length;
  const out = new Array(n).fill(0);
  for (let r = 0; r < a.length; r++) {
    const vr = v[r];
    if (vr === 0) continue;
    for (let c = 0; c < n; c++) out[c] += a[r][c] * vr;
  }
  return out;
}
