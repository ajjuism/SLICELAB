/**
 * Magnitude of cascaded digital peaking biquads (same cookbook form as Web Audio).
 */

function peakingStageDbAt(
  fHz: number,
  sampleRate: number,
  f0Hz: number,
  gainDb: number,
  Q: number,
): number {
  if (!(fHz > 0) || !(sampleRate > 0) || !(f0Hz > 0) || !(Q > 0)) return 0;

  const w0 = (2 * Math.PI * f0Hz) / sampleRate;
  const w = (2 * Math.PI * fHz) / sampleRate;
  /** Web Audio peaking cookbook: A = 10^(G/40) (linear amplitude term), not sqrt — sqrt would halve the dB at fc. */
  const A = Math.pow(10, gainDb / 40);
  const sinW0 = Math.sin(w0);
  const alpha = sinW0 / (2 * Q);

  let b0 = 1 + alpha * A;
  let b1 = -2 * Math.cos(w0);
  let b2 = 1 - alpha * A;
  const a0 = 1 + alpha / A;
  let a1 = -2 * Math.cos(w0);
  let a2 = 1 - alpha / A;

  b0 /= a0;
  b1 /= a0;
  b2 /= a0;
  a1 /= a0;
  a2 /= a0;

  const cw = Math.cos(w);
  const sw = Math.sin(w);
  const c2w = Math.cos(2 * w);
  const s2w = Math.sin(2 * w);

  const numRe = b0 + b1 * cw + b2 * c2w;
  const numIm = -b1 * sw - b2 * s2w;
  const denRe = 1 + a1 * cw + a2 * c2w;
  const denIm = -a1 * sw - a2 * s2w;

  const denMag = Math.hypot(denRe, denIm);
  if (denMag < 1e-30) return 0;
  const numMag = Math.hypot(numRe, numIm);
  return 20 * (Math.log(numMag / denMag) / Math.LN10);
}

/**
 * Combined magnitude (dB) of peaking stages in series at fHz: product of linear mags.
 */
export function cascadedPeakingDbAt(
  fHz: number,
  sampleRate: number,
  centerHz: readonly number[],
  gainsDb: readonly number[],
  Q: number,
): number {
  let sumDb = 0;
  const n = centerHz.length;
  for (let i = 0; i < n; i++) {
    sumDb += peakingStageDbAt(fHz, sampleRate, centerHz[i]!, gainsDb[i] ?? 0, Q);
  }
  return sumDb;
}

/** `count` frequencies from fLo to fHi inclusive, evenly spaced in log(f). */
export function logSpaceHz(fLo: number, fHi: number, count: number): number[] {
  if (count < 1) return [];
  if (count === 1) return [fLo];
  const lo = Math.log(fLo);
  const hi = Math.log(fHi);
  const out: number[] = [];
  for (let i = 0; i < count; i++) {
    const t = i / (count - 1);
    out.push(Math.exp(lo + t * (hi - lo)));
  }
  return out;
}
