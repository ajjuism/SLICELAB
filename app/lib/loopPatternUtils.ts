import type { LoopLayerRow, Slice, StepsPerBar } from '../types';

export const DEFAULT_HIT_RATE = 55;
export const PITCH_MIN = -24;
export const PITCH_MAX = 24;

export function resizePattern(p: (number | null)[], n: number): (number | null)[] {
  const next = p.slice(0, n);
  while (next.length < n) next.push(null);
  return next;
}

export function generateRandomPattern(
  slices: Slice[],
  kit: Set<number>,
  steps: number,
  hitChance: number,
): (number | null)[] {
  const ids = slices.map(s => s.index).filter(i => kit.has(i));
  if (ids.length === 0) return Array.from({ length: steps }, () => null);
  const p = Math.max(0, Math.min(1, hitChance));
  return Array.from({ length: steps }, () => {
    if (Math.random() > p) return null;
    return ids[Math.floor(Math.random() * ids.length)]!;
  });
}

function pickDistinctRandomIndices(barLen: number, want: number): number[] {
  const idx = Array.from({ length: barLen }, (_, i) => i);
  for (let i = idx.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [idx[i], idx[j]] = [idx[j], idx[i]];
  }
  return idx.slice(0, Math.min(want, barLen));
}

type LayerBarVariation = 'lastBarFill' | 'eachBarLight' | 'eachBarHeavy' | 'fullRandom';

export function mutateBarInPlace(
  bar: (number | null)[],
  stepsPerBar: number,
  mutationCount: number,
  rollStep: () => number | null,
  ids: number[],
): void {
  for (const i of pickDistinctRandomIndices(stepsPerBar, mutationCount)) {
    let next: number | null;
    let guard = 0;
    do {
      next = rollStep();
      guard++;
    } while (guard < 10 && ids.length > 1 && next === bar[i]);
    bar[i] = next;
  }
}

export function generateLayerRandomPattern(
  slices: Slice[],
  kit: Set<number>,
  stepsPerBar: StepsPerBar,
  numBars: number,
  hitChance: number,
  variation: LayerBarVariation,
): (number | null)[] {
  const ids = slices.map(s => s.index).filter(i => kit.has(i));
  const totalSteps = stepsPerBar * numBars;
  if (ids.length === 0) return Array.from({ length: totalSteps }, () => null);
  if (numBars <= 1) {
    return generateRandomPattern(slices, kit, stepsPerBar, hitChance);
  }

  if (variation === 'fullRandom') {
    return generateRandomPattern(slices, kit, totalSteps, hitChance);
  }

  const p = Math.max(0, Math.min(1, hitChance));
  const rollStep = (): number | null => {
    if (Math.random() > p) return null;
    return ids[Math.floor(Math.random() * ids.length)]!;
  };

  const base = generateRandomPattern(slices, kit, stepsPerBar, hitChance);

  if (variation === 'lastBarFill') {
    const out: (number | null)[] = [];
    for (let b = 0; b < numBars - 1; b++) {
      out.push(...base);
    }
    const lastBar = base.slice();
    const mutationCount = Math.max(2, Math.min(8, Math.round(stepsPerBar * 0.18)));
    mutateBarInPlace(lastBar, stepsPerBar, mutationCount, rollStep, ids);
    out.push(...lastBar);
    return out;
  }

  const lightCount = Math.max(1, Math.min(5, Math.round(stepsPerBar * 0.08)));
  const heavyCount = Math.max(3, Math.min(12, Math.round(stepsPerBar * 0.28)));

  const out: (number | null)[] = [...base];
  const mutCount = variation === 'eachBarHeavy' ? heavyCount : lightCount;

  for (let b = 1; b < numBars; b++) {
    const seg = base.slice();
    mutateBarInPlace(seg, stepsPerBar, mutCount, rollStep, ids);
    out.push(...seg);
  }
  return out;
}

export function resolveLayerBarVariation(L: LoopLayerRow, numBars: number): LayerBarVariation {
  if (numBars <= 1) return 'lastBarFill';
  if (!L.barVariationEnabled) return 'lastBarFill';
  switch (L.barVariationMode) {
    case 'eachBarLight':
      return 'eachBarLight';
    case 'eachBarHeavy':
      return 'eachBarHeavy';
    default:
      return 'fullRandom';
  }
}

export function applyKitToLayers(rows: LoopLayerRow[], pool: Set<number>): LoopLayerRow[] {
  return rows.map(L => ({
    ...L,
    pattern: L.pattern.map(h => (h !== null && pool.has(h) ? h : null)),
  }));
}
