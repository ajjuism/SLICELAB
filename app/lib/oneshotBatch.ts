import type { Slice } from '../types';
import type { OneshotClipParams, OneshotLayout } from './oneshotBuild';

export const MAX_BATCH_ONESHOTS = 100;

/** Same cap as the main Oneshots “Randomize” mix (2–6 clips). */
export const MAX_ONESHOT_CLIPS = 6;

export function randomInt(min: number, max: number): number {
  return min + Math.floor(Math.random() * (max - min + 1));
}

function shuffleIndices(n: number): number[] {
  const a = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

function shuffleInPlace<T>(arr: T[]): void {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j]!, arr[i]!];
  }
}

function planDedupeKey(layout: OneshotLayout, plan: number[]): string {
  if (layout === 'layer') return [...plan].sort((a, b) => a - b).join(',');
  return plan.join(',');
}

/**
 * Builds up to `maxPlans` **unique** combinations by random sampling (uniform over r-subsets for layer,
 * uniform over r-permutations for sequence). Avoids the lex / round-robin bias toward early indices.
 */
export function generateRandomOneshotPlans(
  includedIndices: number[],
  layout: OneshotLayout,
  maxPlans: number = MAX_BATCH_ONESHOTS,
): number[][] {
  const sorted = [...new Set(includedIndices)].sort((a, b) => a - b);
  if (sorted.length < 2) return [];

  const maxR = Math.min(MAX_ONESHOT_CLIPS, sorted.length);
  const seen = new Set<string>();
  const out: number[][] = [];
  let attempts = 0;
  const maxAttempts = maxPlans * 800;

  while (out.length < maxPlans && attempts < maxAttempts) {
    attempts++;
    const r = randomInt(2, maxR);
    const shuffled = [...sorted];
    shuffleInPlace(shuffled);
    const picked = shuffled.slice(0, r);
    const plan = layout === 'layer' ? [...picked].sort((a, b) => a - b) : picked;
    const key = planDedupeKey(layout, plan);
    if (!seen.has(key)) {
      seen.add(key);
      out.push([...plan]);
    }
  }
  return out;
}

/** Same distribution as main Oneshots Randomize: 2–6 clips, random slice picks from the pool. */
export function randomOneshotClipsFromPool(slices: Slice[]): OneshotClipParams[] {
  const n = slices.length;
  if (n < 2) return [];
  const minRows = 2;
  const maxRows = Math.min(MAX_ONESHOT_CLIPS, n);
  const rowCount = minRows + Math.floor(Math.random() * (maxRows - minRows + 1));
  const sliceIndices = shuffleIndices(n).slice(0, rowCount);
  return randomClipParamsForIndices(slices, sliceIndices);
}

/**
 * Random trim / reverse / gain / offset per clip for fixed slice indices (order = layer stack or sequence order).
 * Matches main Oneshots Randomize; trims are clamped to each slice’s duration.
 */
export function randomClipParamsForIndices(slices: Slice[], indices: number[]): OneshotClipParams[] {
  return indices.map(sliceIndex => {
    const sl = slices[sliceIndex];
    const durMs = sl ? sl.dur * 1000 : 0;
    let trimStartMs = Math.random() < 0.55 ? 0 : randomInt(0, 70);
    let trimEndMs = Math.random() < 0.55 ? 0 : randomInt(0, 70);
    if (durMs > 0 && trimStartMs + trimEndMs > durMs) {
      const scale = durMs / (trimStartMs + trimEndMs);
      trimStartMs = Math.floor(trimStartMs * scale);
      trimEndMs = Math.floor(trimEndMs * scale);
    }
    return {
      sliceIndex,
      reverse: Math.random() < 0.38,
      gain: Math.round((0.45 + Math.random() * 0.95) * 100) / 100,
      startOffsetMs: randomInt(-50, 120),
      trimStartMs,
      trimEndMs,
    };
  });
}

/** Default sequence gap range (ms); negative = overlap. */
export const DEFAULT_SEQUENCE_GAP_MIN_MS = -150;
export const DEFAULT_SEQUENCE_GAP_MAX_MS = 200;

/** Uniform random gap in ms; if min is greater than max they are swapped. */
export function randomSequenceGapMs(
  minMs: number = DEFAULT_SEQUENCE_GAP_MIN_MS,
  maxMs: number = DEFAULT_SEQUENCE_GAP_MAX_MS,
): number {
  let lo = Number.isFinite(minMs) ? Math.round(minMs) : DEFAULT_SEQUENCE_GAP_MIN_MS;
  let hi = Number.isFinite(maxMs) ? Math.round(maxMs) : DEFAULT_SEQUENCE_GAP_MAX_MS;
  if (lo > hi) {
    const t = lo;
    lo = hi;
    hi = t;
  }
  return randomInt(lo, hi);
}

export function formatPlanLabel(sliceNames: string[], layout: OneshotLayout): string {
  if (layout === 'layer') return sliceNames.join(' + ');
  return sliceNames.join(' → ');
}

/** Fisher–Yates shuffle of plan rows (each inner slice-index tuple is copied). */
export function shufflePlanOrder(plans: number[][]): number[][] {
  const copy = plans.map(p => [...p]);
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const a = copy[i]!;
    const b = copy[j]!;
    copy[i] = b;
    copy[j] = a;
  }
  return copy;
}
