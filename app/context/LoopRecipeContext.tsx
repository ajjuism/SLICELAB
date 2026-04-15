'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type { LoopBarVariationMode, LoopLayerRow, Slice, StepsPerBar, TimeSignature } from '../types';
import {
  applyKitToLayers,
  DEFAULT_HIT_RATE,
  generateLayerRandomPattern,
  PITCH_MAX,
  PITCH_MIN,
  resizePattern,
  resolveLayerBarVariation,
} from '../lib/loopPatternUtils';
import {
  buildRecipeFile,
  clampLoopRecipeToSlices,
  parseRecipeFileJson,
  recipeToJsonString,
  type RecipeLoopV1,
} from '../lib/recipe';
import { triggerBlobDownload } from '../lib/projectFolder';

const MAX_LAYERS = 6;

function defaultLayer(totalSteps: number): LoopLayerRow {
  return {
    pattern: Array.from({ length: totalSteps }, () => null),
    muted: false,
    hitRate: DEFAULT_HIT_RATE,
    pitchSemitones: 0,
    barVariationEnabled: false,
    barVariationMode: 'eachBarLight',
  };
}

export interface LoopRecipeContextValue {
  bpm: number;
  setBpm: (n: number) => void;
  swing: number;
  setSwing: (n: number) => void;
  trimSamplesToStep: boolean;
  setTrimSamplesToStep: (v: boolean) => void;
  timeSignature: TimeSignature;
  setTimeSignature: (t: TimeSignature) => void;
  stepsPerBar: StepsPerBar;
  setStepsPerBar: (s: StepsPerBar) => void;
  numBars: number;
  setNumBars: (n: number) => void;
  pool: Set<number>;
  layers: LoopLayerRow[];
  togglePool: (index: number) => void;
  setStep: (layerIdx: number, stepIdx: number, sliceIndex: number | null) => void;
  toggleMuteLayer: (layerIdx: number) => void;
  randomizeLayer: (layerIdx: number) => void;
  randomizeAllLayers: () => void;
  setLayerHitRate: (layerIdx: number, hitRate: number) => void;
  setLayerPitch: (layerIdx: number, semitones: number) => void;
  setLayerBarVariationEnabled: (layerIdx: number, enabled: boolean) => void;
  setLayerBarVariationMode: (layerIdx: number, mode: LoopBarVariationMode) => void;
  clearLayer: (layerIdx: number) => void;
  addLayer: () => void;
  removeLayer: (layerIdx: number) => void;
  exportLoopRecipe: () => void;
  importLoopRecipeFromFile: (file: File) => Promise<void>;
}

const LoopRecipeContext = createContext<LoopRecipeContextValue | null>(null);

interface LoopRecipeProviderProps {
  children: ReactNode;
  slices: Slice[];
  loopPlaying: boolean;
  onStopLoop: () => void;
  onStatus?: (message: string) => void;
}

export function LoopRecipeProvider({
  children,
  slices,
  loopPlaying,
  onStopLoop,
  onStatus,
}: LoopRecipeProviderProps) {
  const [bpm, setBpm] = useState(120);
  const [swing, setSwing] = useState(0);
  const [trimSamplesToStep, setTrimSamplesToStep] = useState(true);
  const [timeSignature, setTimeSignature] = useState<TimeSignature>('4/4');
  const [stepsPerBar, setStepsPerBar] = useState<StepsPerBar>(16);
  const [numBars, setNumBars] = useState(1);
  const [pool, setPool] = useState<Set<number>>(new Set());
  const [layers, setLayers] = useState<LoopLayerRow[]>([defaultLayer(0)]);

  const poolRef = useRef(pool);
  const stepsPerBarRef = useRef(stepsPerBar);
  const numBarsRef = useRef(numBars);
  poolRef.current = pool;
  stepsPerBarRef.current = stepsPerBar;
  numBarsRef.current = numBars;

  const loopPlayingRef = useRef(loopPlaying);
  loopPlayingRef.current = loopPlaying;

  const pendingLoopRecipeRef = useRef<RecipeLoopV1 | null>(null);

  const randomizeAllLayers = useCallback(() => {
    if (slices.length === 0) return;
    const kit = poolRef.current;
    const spb = stepsPerBarRef.current;
    const bars = numBarsRef.current;
    setLayers(prev =>
      prev.map(L => ({
        ...L,
        pattern: generateLayerRandomPattern(
          slices,
          kit,
          spb,
          bars,
          L.hitRate / 100,
          resolveLayerBarVariation(L, bars),
        ),
      })),
    );
  }, [slices]);

  useEffect(() => {
    if (slices.length === 0) {
      setPool(new Set());
      setLayers([defaultLayer(0)]);
      pendingLoopRecipeRef.current = null;
      return;
    }

    const pending = pendingLoopRecipeRef.current;
    if (pending) {
      const applied = clampLoopRecipeToSlices(pending, slices.length);
      pendingLoopRecipeRef.current = null;
      setBpm(applied.bpm);
      setSwing(applied.swing);
      setTrimSamplesToStep(applied.trimSamplesToStep);
      setTimeSignature(applied.timeSignature);
      setStepsPerBar(applied.stepsPerBar);
      setNumBars(applied.numBars);
      setPool(new Set(applied.pool));
      setLayers(
        applied.layers.length > 0
          ? applied.layers
          : [defaultLayer(applied.stepsPerBar * applied.numBars)],
      );
      onStatus?.('Loaded recipe — pattern applied to your slices.');
      return;
    }

    const kit = new Set(slices.map(s => s.index));
    setPool(kit);
    const bars = numBarsRef.current;
    const pat = generateLayerRandomPattern(
      slices,
      kit,
      stepsPerBarRef.current,
      bars,
      DEFAULT_HIT_RATE / 100,
      'lastBarFill',
    );
    setLayers([
      {
        pattern: pat,
        muted: false,
        hitRate: DEFAULT_HIT_RATE,
        pitchSemitones: 0,
        barVariationEnabled: false,
        barVariationMode: 'eachBarLight',
      },
    ]);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only when slice set identity changes (new analysis)
  }, [slices]);

  useEffect(() => {
    if (slices.length === 0) return;
    const totalSteps = stepsPerBar * numBars;
    setLayers(prev => prev.map(L => ({ ...L, pattern: resizePattern(L.pattern, totalSteps) })));
  }, [stepsPerBar, numBars, slices.length]);

  useEffect(() => {
    if (loopPlayingRef.current) onStopLoop();
  }, [layers, bpm, stepsPerBar, numBars, swing, timeSignature, onStopLoop]);

  const togglePool = useCallback((index: number) => {
    setPool(prev => {
      const n = new Set(prev);
      if (n.has(index)) n.delete(index);
      else n.add(index);
      setLayers(rows => applyKitToLayers(rows, n));
      return n;
    });
  }, []);

  const setStep = useCallback((layerIdx: number, stepIdx: number, sliceIndex: number | null) => {
    setLayers(prev =>
      prev.map((L, li) => {
        if (li !== layerIdx) return L;
        const pat = [...L.pattern];
        pat[stepIdx] = sliceIndex;
        return { ...L, pattern: pat };
      }),
    );
  }, []);

  const toggleMuteLayer = useCallback((layerIdx: number) => {
    setLayers(prev => prev.map((L, i) => (i === layerIdx ? { ...L, muted: !L.muted } : L)));
  }, []);

  const randomizeLayer = useCallback(
    (layerIdx: number) => {
      const kit = poolRef.current;
      const spb = stepsPerBarRef.current;
      const bars = numBarsRef.current;
      setLayers(prev =>
        prev.map((L, i) =>
          i === layerIdx
            ? {
                ...L,
                pattern: generateLayerRandomPattern(
                  slices,
                  kit,
                  spb,
                  bars,
                  L.hitRate / 100,
                  resolveLayerBarVariation(L, bars),
                ),
              }
            : L,
        ),
      );
    },
    [slices],
  );

  const setLayerHitRate = useCallback((layerIdx: number, hitRate: number) => {
    const v = Math.max(5, Math.min(100, Math.round(hitRate)));
    setLayers(prev => prev.map((L, i) => (i === layerIdx ? { ...L, hitRate: v } : L)));
  }, []);

  const setLayerPitch = useCallback((layerIdx: number, semitones: number) => {
    const v = Math.max(PITCH_MIN, Math.min(PITCH_MAX, Math.round(semitones)));
    setLayers(prev => prev.map((L, i) => (i === layerIdx ? { ...L, pitchSemitones: v } : L)));
  }, []);

  const setLayerBarVariationEnabled = useCallback((layerIdx: number, enabled: boolean) => {
    setLayers(prev =>
      prev.map((L, i) => (i === layerIdx ? { ...L, barVariationEnabled: enabled } : L)),
    );
  }, []);

  const setLayerBarVariationMode = useCallback((layerIdx: number, mode: LoopBarVariationMode) => {
    setLayers(prev => prev.map((L, i) => (i === layerIdx ? { ...L, barVariationMode: mode } : L)));
  }, []);

  const clearLayer = useCallback(
    (layerIdx: number) => {
      const totalSteps = stepsPerBar * numBars;
      setLayers(prev =>
        prev.map((L, i) =>
          i === layerIdx ? { ...L, pattern: Array.from({ length: totalSteps }, () => null) } : L,
        ),
      );
    },
    [stepsPerBar, numBars],
  );

  const addLayer = useCallback(() => {
    const totalSteps = stepsPerBar * numBars;
    setLayers(prev => {
      if (prev.length >= MAX_LAYERS) return prev;
      return [...prev, defaultLayer(totalSteps)];
    });
  }, [stepsPerBar, numBars]);

  const removeLayer = useCallback((layerIdx: number) => {
    setLayers(prev => {
      if (prev.length <= 1) return prev;
      return prev.filter((_, i) => i !== layerIdx);
    });
  }, []);

  const exportLoopRecipe = useCallback(() => {
    const loop: RecipeLoopV1 = {
      bpm,
      swing,
      trimSamplesToStep,
      timeSignature,
      stepsPerBar,
      numBars,
      pool: Array.from(pool).sort((a, b) => a - b),
      layers: layers.map(L => ({
        ...L,
        pattern: [...L.pattern],
      })),
    };
    const file = buildRecipeFile(loop);
    const blob = new Blob([recipeToJsonString(file)], { type: 'application/json;charset=utf-8' });
    triggerBlobDownload(blob, 'slicelab-recipe.json');
    onStatus?.('Exported loop recipe (JSON) — no audio included.');
  }, [bpm, swing, trimSamplesToStep, timeSignature, stepsPerBar, numBars, pool, layers, onStatus]);

  const importLoopRecipeFromFile = useCallback(
    async (file: File) => {
      const text = await file.text();
      const parsed = parseRecipeFileJson(text);
      if (!parsed.ok) {
        onStatus?.(`Recipe import: ${parsed.error}`);
        return;
      }
      const raw = parsed.data.loop;

      setBpm(raw.bpm);
      setSwing(raw.swing);
      setTrimSamplesToStep(raw.trimSamplesToStep);
      setTimeSignature(raw.timeSignature);
      setStepsPerBar(raw.stepsPerBar);
      setNumBars(raw.numBars);

      if (slices.length === 0) {
        pendingLoopRecipeRef.current = raw;
        const totalSteps = raw.stepsPerBar * raw.numBars;
        setLayers(
          raw.layers.map(L => ({
            ...L,
            pattern: Array.from({ length: totalSteps }, () => null),
          })),
        );
        setPool(new Set());
        onStatus?.('Recipe loaded — analyze slices to apply the pattern.');
        return;
      }

      const applied = clampLoopRecipeToSlices(raw, slices.length);
      setPool(new Set(applied.pool));
      setLayers(applied.layers);
      onStatus?.('Imported loop recipe.');
    },
    [slices.length, onStatus],
  );

  const value = useMemo(
    (): LoopRecipeContextValue => ({
      bpm,
      setBpm,
      swing,
      setSwing,
      trimSamplesToStep,
      setTrimSamplesToStep,
      timeSignature,
      setTimeSignature,
      stepsPerBar,
      setStepsPerBar,
      numBars,
      setNumBars,
      pool,
      layers,
      togglePool,
      setStep,
      toggleMuteLayer,
      randomizeLayer,
      randomizeAllLayers,
      setLayerHitRate,
      setLayerPitch,
      setLayerBarVariationEnabled,
      setLayerBarVariationMode,
      clearLayer,
      addLayer,
      removeLayer,
      exportLoopRecipe,
      importLoopRecipeFromFile,
    }),
    [
      bpm,
      swing,
      trimSamplesToStep,
      timeSignature,
      stepsPerBar,
      numBars,
      pool,
      layers,
      togglePool,
      setStep,
      toggleMuteLayer,
      randomizeLayer,
      randomizeAllLayers,
      setLayerHitRate,
      setLayerPitch,
      setLayerBarVariationEnabled,
      setLayerBarVariationMode,
      clearLayer,
      addLayer,
      removeLayer,
      exportLoopRecipe,
      importLoopRecipeFromFile,
    ],
  );

  return <LoopRecipeContext.Provider value={value}>{children}</LoopRecipeContext.Provider>;
}

export function useLoopRecipe(): LoopRecipeContextValue {
  const ctx = useContext(LoopRecipeContext);
  if (!ctx) {
    throw new Error('useLoopRecipe must be used within LoopRecipeProvider');
  }
  return ctx;
}
