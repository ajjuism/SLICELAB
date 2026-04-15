import type { LoopLayerRow, StepsPerBar, TimeSignature } from '../types';

export const SLICELAB_RECIPE_KIND = 'slicelab-recipe' as const;
export const RECIPE_SCHEMA_VERSION = 1 as const;

/** Loop-only preset (no audio). Slice indices in patterns refer to slice order in the user’s analyzed pool. */
export interface RecipeLoopV1 {
  bpm: number;
  swing: number;
  trimSamplesToStep: boolean;
  timeSignature: TimeSignature;
  stepsPerBar: StepsPerBar;
  numBars: number;
  /** Slice indices included in the kit (sound pool). */
  pool: number[];
  layers: LoopLayerRow[];
}

export interface SlicelabRecipeFileV1 {
  kind: typeof SLICELAB_RECIPE_KIND;
  schemaVersion: typeof RECIPE_SCHEMA_VERSION;
  title?: string;
  createdAt?: string;
  /** Primary payload — loop sequencer / transport. */
  loop: RecipeLoopV1;
}

const MAX_LAYERS = 6;
const MAX_LOOP_BARS = 8;

function isStepsPerBar(n: unknown): n is StepsPerBar {
  return n === 8 || n === 16 || n === 32;
}

const TIME_SIGS = new Set<TimeSignature>([
  '2/4',
  '3/4',
  '4/4',
  '5/4',
  '7/4',
  '6/8',
  '9/8',
  '12/8',
]);

function isTimeSignature(n: unknown): n is TimeSignature {
  return typeof n === 'string' && TIME_SIGS.has(n as TimeSignature);
}

function isLoopBarVariationMode(n: unknown): n is LoopLayerRow['barVariationMode'] {
  return n === 'eachBarLight' || n === 'eachBarHeavy' || n === 'fullRandom';
}

function parseLayer(raw: unknown): LoopLayerRow | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  if (!Array.isArray(o.pattern)) return null;
  const pattern = o.pattern.map((x): number | null => {
    if (x === null) return null;
    if (typeof x === 'number' && Number.isInteger(x) && x >= 0) return x;
    return null;
  });
  const muted = Boolean(o.muted);
  const hitRate =
    typeof o.hitRate === 'number' && Number.isFinite(o.hitRate)
      ? Math.max(5, Math.min(100, Math.round(o.hitRate)))
      : 55;
  const pitchSemitones =
    typeof o.pitchSemitones === 'number' && Number.isFinite(o.pitchSemitones)
      ? Math.max(-24, Math.min(24, Math.round(o.pitchSemitones)))
      : 0;
  const barVariationEnabled = Boolean(o.barVariationEnabled);
  const barVariationMode = isLoopBarVariationMode(o.barVariationMode) ? o.barVariationMode : 'eachBarLight';
  return {
    pattern,
    muted,
    hitRate,
    pitchSemitones,
    barVariationEnabled,
    barVariationMode,
  };
}

export function parseRecipeFileJson(text: string): { ok: true; data: SlicelabRecipeFileV1 } | { ok: false; error: string } {
  let j: unknown;
  try {
    j = JSON.parse(text);
  } catch {
    return { ok: false, error: 'Not valid JSON.' };
  }
  if (!j || typeof j !== 'object') return { ok: false, error: 'Invalid recipe file.' };
  const root = j as Record<string, unknown>;
  if (root.kind !== SLICELAB_RECIPE_KIND) return { ok: false, error: 'Not a SliceLab recipe (missing kind).' };
  if (root.schemaVersion !== 1) return { ok: false, error: `Unsupported recipe version: ${String(root.schemaVersion)}` };
  const loopRaw = root.loop;
  if (!loopRaw || typeof loopRaw !== 'object') return { ok: false, error: 'Recipe missing loop block.' };
  const L = loopRaw as Record<string, unknown>;

  const bpm =
    typeof L.bpm === 'number' && Number.isFinite(L.bpm) ? Math.max(20, Math.min(300, Math.round(L.bpm))) : 120;
  const swing =
    typeof L.swing === 'number' && Number.isFinite(L.swing) ? Math.max(0, Math.min(100, Math.round(L.swing))) : 0;
  const trimSamplesToStep = L.trimSamplesToStep !== false;
  const timeSignature = isTimeSignature(L.timeSignature) ? L.timeSignature : '4/4';
  const stepsPerBar = isStepsPerBar(L.stepsPerBar) ? L.stepsPerBar : 16;
  const numBarsRaw =
    typeof L.numBars === 'number' && Number.isFinite(L.numBars) ? Math.floor(L.numBars) : 1;
  const numBars = Math.max(1, Math.min(MAX_LOOP_BARS, numBarsRaw));

  const poolRaw = Array.isArray(L.pool) ? L.pool : [];
  const pool = Array.from(
    new Set(
      poolRaw.filter((x): x is number => typeof x === 'number' && Number.isInteger(x) && x >= 0),
    ),
  ).sort((a, b) => a - b);

  const layersRaw = Array.isArray(L.layers) ? L.layers : [];
  const layers: LoopLayerRow[] = [];
  for (const row of layersRaw) {
    const layer = parseLayer(row);
    if (layer) layers.push(layer);
  }
  if (layers.length === 0) {
    layers.push({
      pattern: [],
      muted: false,
      hitRate: 55,
      pitchSemitones: 0,
      barVariationEnabled: false,
      barVariationMode: 'eachBarLight',
    });
  }
  if (layers.length > MAX_LAYERS) layers.length = MAX_LAYERS;

  const totalSteps = stepsPerBar * numBars;
  for (const row of layers) {
    row.pattern = row.pattern.slice(0, totalSteps);
    while (row.pattern.length < totalSteps) row.pattern.push(null);
  }

  const data: SlicelabRecipeFileV1 = {
    kind: SLICELAB_RECIPE_KIND,
    schemaVersion: RECIPE_SCHEMA_VERSION,
    title: typeof root.title === 'string' ? root.title : undefined,
    createdAt: typeof root.createdAt === 'string' ? root.createdAt : undefined,
    loop: {
      bpm,
      swing,
      trimSamplesToStep,
      timeSignature,
      stepsPerBar,
      numBars,
      pool,
      layers,
    },
  };
  return { ok: true, data };
}

/** Clamp pool and pattern indices to existing slice indices [0, sliceCount). */
export function clampLoopRecipeToSlices(loop: RecipeLoopV1, sliceCount: number): RecipeLoopV1 {
  if (sliceCount <= 0) {
    return {
      ...loop,
      pool: [],
      layers: loop.layers.map(L => ({
        ...L,
        pattern: L.pattern.map(() => null),
      })),
    };
  }
  const maxI = sliceCount - 1;
  const pool = loop.pool.filter(i => i >= 0 && i <= maxI);
  const poolSet = new Set(pool.length > 0 ? pool : Array.from({ length: sliceCount }, (_, i) => i));

  const layers = loop.layers.map(L => ({
    ...L,
    pattern: L.pattern.map(h => {
      if (h === null || h === undefined) return null;
      if (h < 0 || h > maxI) return null;
      if (!poolSet.has(h)) return null;
      return h;
    }),
  }));

  return {
    ...loop,
    pool: Array.from(poolSet).sort((a, b) => a - b),
    layers,
  };
}

export function buildRecipeFile(loop: RecipeLoopV1, title?: string): SlicelabRecipeFileV1 {
  return {
    kind: SLICELAB_RECIPE_KIND,
    schemaVersion: RECIPE_SCHEMA_VERSION,
    title,
    createdAt: new Date().toISOString(),
    loop,
  };
}

export function recipeToJsonString(recipe: SlicelabRecipeFileV1): string {
  return `${JSON.stringify(recipe, null, 2)}\n`;
}
