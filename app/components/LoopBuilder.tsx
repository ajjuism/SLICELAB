'use client';

import { useEffect, useRef, useState, type CSSProperties } from 'react';
import type { Slice, StepsPerBar, TimeSignature } from '../types';
import { fmtTime } from '../lib/audio';

const MAX_LAYERS = 6;

const TIME_SIGNATURES: { value: TimeSignature; label: string }[] = [
  { value: '2/4', label: '2/4' },
  { value: '3/4', label: '3/4' },
  { value: '4/4', label: '4/4' },
  { value: '5/4', label: '5/4' },
  { value: '7/4', label: '7/4' },
  { value: '6/8', label: '6/8' },
  { value: '9/8', label: '9/8' },
  { value: '12/8', label: '12/8' },
];

export interface LoopLayerRow {
  pattern: (number | null)[];
  muted: boolean;
  /** 5–100: probability of a hit on each step when using Random / Randomize all. */
  hitRate: number;
  /** Semitones (−24…24): pitch-shift every hit on this layer (sampler-style; changes length vs step). */
  pitchSemitones: number;
}

interface LoopBuilderProps {
  slices: Slice[];
  loopPlaying: boolean;
  /** Current step in the bar while the loop plays (for per-cell highlight). */
  loopPlayheadStep: number | null;
  playingIndex: number | null;
  onPlayLoop: (
    layers: (number | null)[][],
    layerMutes: boolean[],
    layerPitchSemitones: number[],
    bpm: number,
    stepsPerBar: StepsPerBar,
    swingPercent: number,
    timeSignature: TimeSignature,
    trimSamplesToStep: boolean,
  ) => void;
  onDownloadLoopWav: (
    layers: (number | null)[][],
    layerMutes: boolean[],
    layerPitchSemitones: number[],
    bpm: number,
    stepsPerBar: StepsPerBar,
    swingPercent: number,
    timeSignature: TimeSignature,
    trimSamplesToStep: boolean,
  ) => void;
  onStopLoop: () => void;
  onPlaySlice: (slice: Slice) => void;
  hasAudio: boolean;
}

function resizePattern(p: (number | null)[], n: number): (number | null)[] {
  const next = p.slice(0, n);
  while (next.length < n) next.push(null);
  return next;
}

function generateRandomPattern(
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

/** Tighter cells for high step counts; the row stays horizontally scrollable. */
function loopStepGridMetrics(stepsPerBar: StepsPerBar): {
  colMin: number;
  gap: number;
  labelFs: number;
  cellPad: string;
  minGridPx: number;
} {
  switch (stepsPerBar) {
    case 32:
      return { colMin: 28, gap: 4, labelFs: 7, cellPad: '4px 2px 5px', minGridPx: 32 * 33 };
    case 16:
      return { colMin: 38, gap: 5, labelFs: 8, cellPad: '5px 4px 6px', minGridPx: 16 * 45 };
    default:
      return { colMin: 46, gap: 5, labelFs: 8, cellPad: '5px 4px 6px', minGridPx: 8 * 52 };
  }
}

function beatStrideForSteps(stepsPerBar: StepsPerBar): number {
  switch (stepsPerBar) {
    case 32:
      return 8;
    case 16:
      return 4;
    default:
      return 2;
  }
}

function applyKitToLayers(rows: LoopLayerRow[], pool: Set<number>): LoopLayerRow[] {
  return rows.map(L => ({
    ...L,
    pattern: L.pattern.map(h => (h !== null && pool.has(h) ? h : null)),
  }));
}

const DEFAULT_HIT_RATE = 55;
const PITCH_MIN = -24;
const PITCH_MAX = 24;

function formatPitchSemitones(st: number): string {
  if (st === 0) return '0';
  return st > 0 ? `+${st}` : `${st}`;
}

export function LoopBuilder({
  slices,
  loopPlaying,
  loopPlayheadStep,
  playingIndex,
  onPlayLoop,
  onDownloadLoopWav,
  onStopLoop,
  onPlaySlice,
  hasAudio,
}: LoopBuilderProps) {
  const [bpm, setBpm] = useState(120);
  const [swing, setSwing] = useState(0);
  /** When true, each step plays only ~one step of audio; when false, slices play until they end or the bar ends. */
  const [trimSamplesToStep, setTrimSamplesToStep] = useState(true);
  const [timeSignature, setTimeSignature] = useState<TimeSignature>('4/4');
  const [stepsPerBar, setStepsPerBar] = useState<StepsPerBar>(16);
  const [pool, setPool] = useState<Set<number>>(new Set());
  const [layers, setLayers] = useState<LoopLayerRow[]>([
    { pattern: [], muted: false, hitRate: DEFAULT_HIT_RATE, pitchSemitones: 0 },
  ]);

  const poolRef = useRef(pool);
  const stepsPerBarRef = useRef(stepsPerBar);
  poolRef.current = pool;
  stepsPerBarRef.current = stepsPerBar;

  const loopPlayingRef = useRef(loopPlaying);
  loopPlayingRef.current = loopPlaying;

  /** Reseed every layer using that layer’s hit rate. */
  const randomizeAllLayers = () => {
    if (slices.length === 0) return;
    const kit = poolRef.current;
    const steps = stepsPerBarRef.current;
    setLayers(prev =>
      prev.map(L => ({
        ...L,
        pattern: generateRandomPattern(slices, kit, steps, L.hitRate / 100),
      })),
    );
  };

  useEffect(() => {
    if (slices.length === 0) {
      setPool(new Set());
      setLayers([{ pattern: [], muted: false, hitRate: DEFAULT_HIT_RATE, pitchSemitones: 0 }]);
      return;
    }
    const kit = new Set(slices.map(s => s.index));
    setPool(kit);
    const pat = generateRandomPattern(slices, kit, stepsPerBar, DEFAULT_HIT_RATE / 100);
    setLayers([{ pattern: pat, muted: false, hitRate: DEFAULT_HIT_RATE, pitchSemitones: 0 }]);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only reset on new slice set
  }, [slices]);

  useEffect(() => {
    if (slices.length === 0) return;
    setLayers(prev =>
      prev.map(L => ({ ...L, pattern: resizePattern(L.pattern, stepsPerBar) })),
    );
  }, [stepsPerBar, slices.length]);

  useEffect(() => {
    if (loopPlayingRef.current) onStopLoop();
  }, [layers, bpm, stepsPerBar, swing, timeSignature, onStopLoop]);

  const togglePool = (index: number) => {
    setPool(prev => {
      const n = new Set(prev);
      if (n.has(index)) n.delete(index);
      else n.add(index);
      setLayers(rows => applyKitToLayers(rows, n));
      return n;
    });
  };

  const setStep = (layerIdx: number, stepIdx: number, sliceIndex: number | null) => {
    setLayers(prev => {
      const next = prev.map((L, li) => {
        if (li !== layerIdx) return L;
        const pat = [...L.pattern];
        pat[stepIdx] = sliceIndex;
        return { ...L, pattern: pat };
      });
      return next;
    });
  };

  const toggleMuteLayer = (layerIdx: number) => {
    setLayers(prev =>
      prev.map((L, i) => (i === layerIdx ? { ...L, muted: !L.muted } : L)),
    );
  };

  const randomizeLayer = (layerIdx: number) => {
    const kit = poolRef.current;
    const steps = stepsPerBarRef.current;
    setLayers(prev =>
      prev.map((L, i) =>
        i === layerIdx
          ? { ...L, pattern: generateRandomPattern(slices, kit, steps, L.hitRate / 100) }
          : L,
      ),
    );
  };

  const setLayerHitRate = (layerIdx: number, hitRate: number) => {
    const v = Math.max(5, Math.min(100, Math.round(hitRate)));
    setLayers(prev =>
      prev.map((L, i) => (i === layerIdx ? { ...L, hitRate: v } : L)),
    );
  };

  const setLayerPitch = (layerIdx: number, semitones: number) => {
    const v = Math.max(PITCH_MIN, Math.min(PITCH_MAX, Math.round(semitones)));
    setLayers(prev =>
      prev.map((L, i) => (i === layerIdx ? { ...L, pitchSemitones: v } : L)),
    );
  };

  const clearLayer = (layerIdx: number) => {
    setLayers(prev =>
      prev.map((L, i) =>
        i === layerIdx ? { ...L, pattern: Array.from({ length: stepsPerBar }, () => null) } : L,
      ),
    );
  };

  const addLayer = () => {
    setLayers(prev => {
      if (prev.length >= MAX_LAYERS) return prev;
      return [
        ...prev,
        {
          pattern: Array.from({ length: stepsPerBar }, () => null),
          muted: false,
          hitRate: DEFAULT_HIT_RATE,
          pitchSemitones: 0,
        },
      ];
    });
  };

  const removeLayer = (layerIdx: number) => {
    setLayers(prev => {
      if (prev.length <= 1) return prev;
      return prev.filter((_, i) => i !== layerIdx);
    });
  };

  const kitIds = slices.filter(s => pool.has(s.index)).map(s => s.index);
  const layerPatterns = layers.map(L => L.pattern);
  const layerMutes = layers.map(L => L.muted);
  const layerPitchSemitones = layers.map(L => L.pitchSemitones);
  const stepGrid = loopStepGridMetrics(stepsPerBar);
  const beatStride = beatStrideForSteps(stepsPerBar);
  const hasHits = layers.some(
    (L, i) => !layerMutes[i] && L.pattern.some(x => x !== null),
  );
  const canPlay = kitIds.length > 0 && hasHits;

  const playArgs = () =>
    onPlayLoop(
      layerPatterns,
      layerMutes,
      layerPitchSemitones,
      bpm,
      stepsPerBar,
      swing,
      timeSignature,
      trimSamplesToStep,
    );
  const downloadArgs = () =>
    onDownloadLoopWav(
      layerPatterns,
      layerMutes,
      layerPitchSemitones,
      bpm,
      stepsPerBar,
      swing,
      timeSignature,
      trimSamplesToStep,
    );

  return (
    <div
      className="app-scroll"
      style={{ flex: 1, overflowY: 'auto', padding: 14, minHeight: 0, background: 'var(--bg)' }}
    >
      <div style={{
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        borderRadius: 2,
        padding: '10px 12px',
        marginBottom: 10,
      }}>
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        flexWrap: 'wrap',
        gap: 10,
        marginBottom: 10,
      }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
          <span style={{
            fontSize: 10,
            letterSpacing: 1.5,
            color: 'var(--faint)',
            textTransform: 'uppercase',
            fontFamily: "'IBM Plex Mono', monospace",
          }}>
            Drum beat loop
          </span>
          <span style={{
            fontSize: 8,
            color: 'var(--faint)',
            fontFamily: "'IBM Plex Mono', monospace",
            letterSpacing: 0.15,
          }}>
            transport · meter · export
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <label style={labelStyle} title="Quarter-note BPM. Bar length follows the meter (e.g. 3/4 = three quarter notes).">
            BPM
            <input
              type="range"
              min={60}
              max={180}
              value={bpm}
              onChange={e => setBpm(Number(e.target.value))}
              style={{ width: 90 }}
            />
            <span style={{ color: 'var(--faint)', minWidth: 28 }}>{bpm}</span>
          </label>
          <label style={meterLabelStyle}>
            Meter
            <select
              value={timeSignature}
              onChange={e => setTimeSignature(e.target.value as TimeSignature)}
              style={{ width: 88, flexShrink: 0 }}
            >
              {TIME_SIGNATURES.map(({ value, label }) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </label>
          <label style={labelStyle} title="Delays odd steps (off-beats) for a swung grid">
            Swing
            <input
              type="range"
              min={0}
              max={100}
              value={swing}
              onChange={e => setSwing(Number(e.target.value))}
              style={{ width: 90 }}
            />
            <span style={{ color: 'var(--faint)', minWidth: 32 }}>{swing}%</span>
          </label>
          <button
            type="button"
            disabled={slices.length === 0 || kitIds.length === 0}
            onClick={randomizeAllLayers}
            title="Reseed every layer using each layer’s hit rate (sliders under each layer)"
            style={{
              ...miniBtn,
              opacity: slices.length === 0 || kitIds.length === 0 ? 0.45 : 1,
              cursor: slices.length === 0 || kitIds.length === 0 ? 'not-allowed' : 'pointer',
            }}
          >
            Randomize all
          </button>
          <label
            style={meterLabelStyle}
            title={
              'Steps divide one bar (BPM × meter) into equal slices. More steps → shorter time per step and a faster step rate; bar length and BPM stay the same. ' +
              'To slow the loop, lower BPM. (Classic one-bar step sequencer—not “more steps = longer pattern.”)'
            }
          >
            Steps
            <select
              className="loop-step-select"
              value={stepsPerBar}
              onChange={e => setStepsPerBar(Number(e.target.value) as StepsPerBar)}
              style={{ width: 72, flexShrink: 0, fontSize: 10 }}
            >
              <option value={8}>8</option>
              <option value={16}>16</option>
              <option value={32}>32</option>
            </select>
          </label>
          <label
            style={{
              ...labelStyle,
              cursor: 'pointer',
              flexWrap: 'nowrap',
            }}
            title="On: only the first part of each slice plays, capped at one step (tight drum machine). Off: the slice keeps playing through the rest of the bar (or until the sample ends)."
          >
            <input
              type="checkbox"
              checked={trimSamplesToStep}
              onChange={e => setTrimSamplesToStep(e.target.checked)}
              style={{ accentColor: 'var(--text)', width: 12, height: 12, flexShrink: 0 }}
            />
            Trim to step
          </label>
          {loopPlaying ? (
            <button
              type="button"
              onClick={onStopLoop}
              aria-label="Stop loop"
              title="Stop loop"
              style={playIconBtn(false)}
            >
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden style={{ display: 'block' }}>
                <rect x="2.5" y="2.5" width="7" height="7" stroke="currentColor" strokeWidth="1.25" />
              </svg>
            </button>
          ) : (
            <button
              type="button"
              disabled={!canPlay || !hasAudio}
              onClick={playArgs}
              aria-label="Play loop"
              title="Play loop"
              style={playIconBtn(!(canPlay && hasAudio))}
            >
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden style={{ display: 'block' }}>
                <path
                  d="M2.25 1.75v8.5l7.25-4.25-7.25-4.25z"
                  stroke="currentColor"
                  strokeWidth="1.25"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
          )}
          <button
            type="button"
            disabled={!canPlay || !hasAudio}
            onClick={downloadArgs}
            style={downloadWavBtn(!(canPlay && hasAudio))}
          >
            Download WAV
          </button>
        </div>
      </div>
      </div>

      <p style={{
        fontSize: 8,
        fontFamily: "'IBM Plex Mono', monospace",
        color: 'var(--faint)',
        lineHeight: 1.45,
        marginBottom: 12,
        letterSpacing: 0.1,
        maxWidth: '100%',
      }}>
        Layers stack on the same step; step menus use the kit only. Swing offsets odd steps. Each layer has its own hit rate for Random / Randomize all, and its own pitch (semitones).
        Meter sets bar length. Steps per bar is grid resolution: 8 / 16 / 32 divisions of the same bar—more steps means finer slices (faster step timing), not a longer loop. Uncheck “Trim to step” to let long samples ring out across the bar.
      </p>

      {slices.length === 0 ? (
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 8,
          minHeight: 168,
          padding: '24px 16px',
          color: 'var(--faint)',
          border: '1px dashed var(--border2)',
          borderRadius: 2,
          background: 'var(--surface)',
        }}>
          <span style={{
            fontSize: 9,
            fontFamily: "'IBM Plex Mono', monospace",
            letterSpacing: 2,
            color: 'var(--border2)',
          }}>
            ◇
          </span>
          <p style={{
            fontSize: 9,
            fontFamily: "'IBM Plex Mono', monospace",
            lineHeight: 1.5,
            textAlign: 'center',
            letterSpacing: 0.1,
            margin: 0,
            maxWidth: 240,
          }}>
            {hasAudio
              ? 'Analyze in the sidebar first—layers need slices from the grid.'
              : 'Load and analyze in the sidebar, then return here to sequence layers.'}
          </p>
        </div>
      ) : (
        <>
          <div style={{
            background: 'var(--surface)',
            border: '1px solid var(--border)',
            borderRadius: 2,
            padding: '10px 12px 12px',
            marginBottom: 12,
          }}>
          <div style={{
            fontSize: 10,
            letterSpacing: 1.5,
            color: 'var(--faint)',
            textTransform: 'uppercase',
            fontFamily: "'IBM Plex Mono', monospace",
            marginBottom: 2,
          }}>
            Pattern layers
          </div>
          <p style={{
            margin: '0 0 10px',
            fontSize: 8,
            color: 'var(--faint)',
            fontFamily: "'IBM Plex Mono', monospace",
            letterSpacing: 0.1,
          }}>
            {timeSignature} · {stepsPerBar} steps per bar · stacked voices
          </p>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 0 }}>
            {layers.map((layer, layerIdx) => (
              <div
                key={layerIdx}
                style={{
                  border: '1px solid var(--border)',
                  borderLeft: `3px solid ${layer.muted ? 'var(--border2)' : 'var(--text)'}`,
                  borderRadius: 2,
                  padding: '10px 10px 10px 11px',
                  background: 'var(--bg)',
                  opacity: layer.muted ? 0.72 : 1,
                }}
              >
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  flexWrap: 'wrap',
                  gap: 8,
                  marginBottom: 10,
                }}>
                  <span style={{
                    fontSize: 9,
                    fontFamily: "'IBM Plex Mono', monospace",
                    color: 'var(--muted)',
                    letterSpacing: 1.2,
                    textTransform: 'uppercase' as const,
                    minWidth: 0,
                  }}>
                    Layer
                  </span>
                  <span style={{
                    fontSize: 10,
                    fontFamily: "'IBM Plex Mono', monospace",
                    color: 'var(--text)',
                    border: '1px solid var(--border)',
                    borderRadius: 2,
                    padding: '2px 7px',
                    lineHeight: 1,
                  }}>
                    {layerIdx + 1}
                  </span>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 10, fontFamily: "'IBM Plex Mono', monospace", color: 'var(--muted)' }}>
                    <input
                      type="checkbox"
                      checked={layer.muted}
                      onChange={() => toggleMuteLayer(layerIdx)}
                      style={{ accentColor: 'var(--text)' }}
                    />
                    Mute
                  </label>
                  <button type="button" onClick={() => randomizeLayer(layerIdx)} style={miniBtn}>
                    Random
                  </button>
                  <button type="button" onClick={() => clearLayer(layerIdx)} style={miniBtn}>
                    Clear
                  </button>
                  {layers.length > 1 && (
                    <button type="button" onClick={() => removeLayer(layerIdx)} style={miniBtnDanger}>
                      Remove
                    </button>
                  )}
                  <label
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                      flex: '1 1 160px',
                      minWidth: 0,
                      maxWidth: 280,
                      fontSize: 10,
                      fontFamily: "'IBM Plex Mono', monospace",
                      color: 'var(--muted)',
                    }}
                    title="Chance of a hit on each step when you press Random or Randomize all"
                  >
                    <span style={{ flexShrink: 0 }}>Hit</span>
                    <input
                      type="range"
                      min={5}
                      max={100}
                      step={1}
                      value={layer.hitRate}
                      onChange={e => setLayerHitRate(layerIdx, Number(e.target.value))}
                      style={{ flex: '1 1 48px', minWidth: 48, width: 0 }}
                    />
                    <span style={{ color: 'var(--faint)', minWidth: 30, flexShrink: 0 }}>{layer.hitRate}%</span>
                  </label>
                  <label
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                      flex: '1 1 100%',
                      minWidth: 0,
                      maxWidth: 360,
                      fontSize: 10,
                      fontFamily: "'IBM Plex Mono', monospace",
                      color: 'var(--muted)',
                    }}
                    title="Pitch in semitones for this layer (sampler-style: higher pitch plays faster and shorter within each step)"
                  >
                    <span style={{ flexShrink: 0 }}>Pitch</span>
                    <input
                      type="range"
                      min={PITCH_MIN}
                      max={PITCH_MAX}
                      step={1}
                      value={layer.pitchSemitones}
                      onChange={e => setLayerPitch(layerIdx, Number(e.target.value))}
                      style={{ flex: '1 1 80px', minWidth: 80, width: 0 }}
                    />
                    <span style={{ color: 'var(--faint)', minWidth: 44, flexShrink: 0 }}>
                      {formatPitchSemitones(layer.pitchSemitones)} st
                    </span>
                  </label>
                </div>
                <div className="loop-steps-scroll" style={{ overflowX: 'auto', paddingBottom: 4 }}>
                  <div style={{
                    display: 'grid',
                    gridTemplateColumns: `repeat(${stepsPerBar}, minmax(${stepGrid.colMin}px, 1fr))`,
                    gap: stepGrid.gap,
                    minWidth: stepGrid.minGridPx,
                  }}>
                    {layer.pattern.map((hit, stepIdx) => {
                      const onBeat = stepIdx % beatStride === 0;
                      const isPlayheadHit =
                        loopPlaying &&
                        !layer.muted &&
                        loopPlayheadStep === stepIdx &&
                        hit !== null;
                      return (
                      <div
                        key={stepIdx}
                        style={{
                          display: 'flex',
                          flexDirection: 'column',
                          gap: 3,
                          minWidth: 0,
                          padding: stepGrid.cellPad,
                          borderRadius: 2,
                          background: isPlayheadHit
                            ? 'var(--panel)'
                            : hit !== null
                              ? 'var(--panel)'
                              : 'transparent',
                          boxShadow: isPlayheadHit
                            ? 'var(--shadow-inset-focus)'
                            : onBeat
                              ? 'inset 0 0 0 1px var(--border)'
                              : 'none',
                          transition: 'box-shadow 0.08s ease, background 0.08s ease',
                        }}
                      >
                        <span style={{
                          fontSize: stepGrid.labelFs,
                          color: isPlayheadHit ? 'var(--muted)' : onBeat ? 'var(--text)' : 'var(--faint)',
                          fontFamily: "'IBM Plex Mono', monospace",
                          textAlign: 'center',
                          fontWeight: isPlayheadHit ? 500 : onBeat ? 600 : 400,
                        }}>
                          {stepIdx + 1}
                        </span>
                        <select
                          className="loop-step-select"
                          value={hit === null ? '' : String(hit)}
                          disabled={kitIds.length === 0}
                          onChange={e => {
                            const v = e.target.value;
                            setStep(layerIdx, stepIdx, v === '' ? null : Number(v));
                          }}
                          title={hit === null ? 'Rest' : slices[hit]?.name}
                          style={{
                            width: '100%',
                            cursor: kitIds.length === 0 ? 'not-allowed' : 'pointer',
                          }}
                        >
                          <option value="">—</option>
                          {kitIds.map(id => {
                            const sl = slices[id];
                            if (!sl) return null;
                            return (
                              <option key={id} value={id}>
                                #{id + 1}
                              </option>
                            );
                          })}
                        </select>
                      </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            ))}
          </div>

          <button
            type="button"
            disabled={layers.length >= MAX_LAYERS}
            onClick={addLayer}
            style={{
              ...miniBtn,
              width: '100%',
              marginBottom: 14,
              padding: '8px 12px',
              borderStyle: layers.length >= MAX_LAYERS ? 'solid' : 'dashed',
              opacity: layers.length >= MAX_LAYERS ? 0.45 : 1,
              cursor: layers.length >= MAX_LAYERS ? 'not-allowed' : 'pointer',
            }}
          >
            + Add layer ({layers.length}/{MAX_LAYERS})
          </button>
          </div>

          <div style={{
            background: 'var(--surface)',
            border: '1px solid var(--border)',
            borderRadius: 2,
            padding: '10px 12px 12px',
          }}>
          <div style={{
            fontSize: 10,
            letterSpacing: 1.5,
            color: 'var(--faint)',
            textTransform: 'uppercase',
            fontFamily: "'IBM Plex Mono', monospace",
            marginBottom: 4,
          }}>
            Sound pool
          </div>
          <p style={{
            margin: '0 0 10px',
            fontSize: 8,
            color: 'var(--faint)',
            fontFamily: "'IBM Plex Mono', monospace",
            lineHeight: 1.4,
            letterSpacing: 0.1,
          }}>
            Check slices to include in step menus. Click a card to preview.
          </p>
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(172px, 1fr))',
            gap: 8,
            width: '100%',
          }}>
            {slices.map(s => {
              const inKit = pool.has(s.index);
              const isPlaying = playingIndex === s.index;
              return (
                <div
                  key={s.index}
                  className="kit-slice-card"
                  onClick={() => onPlaySlice(s)}
                  title="Click to preview slice"
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 5,
                    minWidth: 0,
                    maxWidth: '100%',
                    padding: '8px 10px',
                    borderRadius: 2,
                    border: `1px solid ${isPlaying ? 'var(--text)' : 'var(--border)'}`,
                    background: inKit ? 'var(--surface)' : 'var(--bg)',
                    cursor: 'pointer',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, minWidth: 0 }}>
                    <label
                      onClick={e => e.stopPropagation()}
                      onMouseDown={e => e.stopPropagation()}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        cursor: 'pointer',
                        flexShrink: 0,
                        paddingTop: 1,
                      }}
                      title={inKit ? 'In kit — click to exclude' : 'Excluded — click to include'}
                    >
                      <input
                        type="checkbox"
                        checked={inKit}
                        onChange={() => togglePool(s.index)}
                        onClick={e => e.stopPropagation()}
                        style={{
                          width: 13,
                          height: 13,
                          cursor: 'pointer',
                          accentColor: 'var(--text)',
                        }}
                      />
                    </label>
                    <div
                      style={{
                        flex: 1,
                        minWidth: 0,
                        textAlign: 'left',
                        fontFamily: "'IBM Plex Mono', monospace",
                      }}
                    >
                      <span style={{
                        fontSize: 10,
                        color: 'var(--text)',
                        display: '-webkit-box',
                        WebkitLineClamp: 2,
                        WebkitBoxOrient: 'vertical' as const,
                        overflow: 'hidden',
                        lineHeight: 1.35,
                        wordBreak: 'break-word',
                      }}>
                        #{s.index + 1} · {s.name.replace(/\.wav$/i, '')}
                      </span>
                    </div>
                  </div>
                  <span
                    style={{
                      fontSize: 8,
                      color: 'var(--faint)',
                      fontFamily: "'IBM Plex Mono', monospace",
                      paddingLeft: 21,
                      lineHeight: 1.2,
                    }}
                  >
                    {fmtTime(s.dur)}
                    {inKit ? ' · in kit' : ' · off'}
                  </span>
                </div>
              );
            })}
          </div>
          </div>
        </>
      )}
    </div>
  );
}

const labelStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  fontSize: 10,
  fontFamily: "'IBM Plex Mono', monospace",
  color: 'var(--muted)',
};

const meterLabelStyle: CSSProperties = {
  ...labelStyle,
  gap: 6,
};

const miniBtn: CSSProperties = {
  padding: '4px 10px',
  borderRadius: 2,
  border: '1px solid var(--border)',
  background: 'var(--surface)',
  color: 'var(--text)',
  fontFamily: "'IBM Plex Mono', monospace",
  fontSize: 10,
  cursor: 'pointer',
};

const miniBtnDanger: CSSProperties = {
  ...miniBtn,
  borderColor: 'var(--border2)',
  color: 'var(--muted)',
};

function playBtn(disabled: boolean): CSSProperties {
  return {
    padding: '6px 12px',
    borderRadius: 2,
    border: '1px solid var(--text)',
    background: disabled ? 'var(--border)' : 'var(--text)',
    color: disabled ? 'var(--faint)' : 'var(--surface)',
    fontFamily: "'IBM Plex Mono', monospace",
    fontSize: 10,
    cursor: disabled ? 'not-allowed' : 'pointer',
    letterSpacing: 0.5,
  };
}

function playIconBtn(disabled: boolean): CSSProperties {
  return {
    ...playBtn(disabled),
    width: 36,
    height: 32,
    padding: 0,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  };
}

function downloadWavBtn(disabled: boolean): CSSProperties {
  return {
    padding: '6px 12px',
    borderRadius: 2,
    border: '1px solid var(--border)',
    background: disabled ? 'var(--border)' : 'var(--surface)',
    color: disabled ? 'var(--faint)' : 'var(--text)',
    fontFamily: "'IBM Plex Mono', monospace",
    fontSize: 10,
    cursor: disabled ? 'not-allowed' : 'pointer',
    letterSpacing: 0.5,
  };
}
