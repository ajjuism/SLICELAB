'use client';

import { useCallback, useEffect, useState, type CSSProperties } from 'react';
import type { Slice } from '../types';
import { bufferToWav } from '../lib/audio';
import { buildOneshotComposite, type OneshotClipParams, type OneshotLayout } from '../lib/oneshotBuild';
import { useProjectOptional } from '../context/ProjectContext';
import { triggerBlobDownload } from '../lib/projectFolder';
import { OneshotClipWaveform, OneshotCompositeWaveform } from './OneshotWaveforms';
import { Knob } from './Knob';

const mono: CSSProperties['fontFamily'] = "'IBM Plex Mono', monospace";

function defaultClips(slices: Slice[]): OneshotClipParams[] {
  if (slices.length < 2) return [];
  return [
    {
      sliceIndex: 0,
      reverse: false,
      gain: 1,
      startOffsetMs: 0,
      trimStartMs: 0,
      trimEndMs: 0,
    },
    {
      sliceIndex: Math.min(1, slices.length - 1),
      reverse: false,
      gain: 1,
      startOffsetMs: 0,
      trimStartMs: 0,
      trimEndMs: 0,
    },
  ];
}

function randomInt(min: number, max: number): number {
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

function randomOneshotClips(slices: Slice[]): OneshotClipParams[] {
  const n = slices.length;
  const minRows = 2;
  const maxRows = Math.min(6, n);
  const rowCount = minRows + Math.floor(Math.random() * (maxRows - minRows + 1));
  const sliceIndices = shuffleIndices(n).slice(0, rowCount);

  return sliceIndices.map(sliceIndex => ({
    sliceIndex,
    reverse: Math.random() < 0.38,
    gain: Math.round((0.45 + Math.random() * 0.95) * 100) / 100,
    startOffsetMs: randomInt(-50, 120),
    trimStartMs: Math.random() < 0.55 ? 0 : randomInt(0, 70),
    trimEndMs: Math.random() < 0.55 ? 0 : randomInt(0, 70),
  }));
}

function randomOneshotSettings(slices: Slice[]): {
  layout: OneshotLayout;
  sequenceGapMs: number;
  clips: OneshotClipParams[];
} {
  return {
    layout: Math.random() < 0.5 ? 'layer' : 'sequence',
    sequenceGapMs: randomInt(-150, 200),
    clips: randomOneshotClips(slices),
  };
}

const inp: CSSProperties = {
  padding: '3px 6px',
  fontSize: 9,
  fontFamily: mono,
  border: '1px solid var(--border)',
  borderRadius: 2,
  background: 'var(--surface)',
  color: 'var(--text)',
  width: '100%',
  minWidth: 0,
};

interface OneshotsModeProps {
  slices: Slice[];
  audioBuffer: AudioBuffer | null;
  ensureAudioContext: () => Promise<AudioContext>;
  onStopOtherAudio: () => void;
  playOneshotPreview: (buffer: AudioBuffer) => void;
  playSlice: (slice: Slice) => void;
}

export function OneshotsMode({
  slices,
  audioBuffer,
  ensureAudioContext,
  onStopOtherAudio,
  playOneshotPreview,
  playSlice,
}: OneshotsModeProps) {
  const project = useProjectOptional();
  const [layout, setLayout] = useState<OneshotLayout>('layer');
  const [sequenceGapMs, setSequenceGapMs] = useState(0);
  const [clips, setClips] = useState<OneshotClipParams[]>([]);

  useEffect(() => {
    if (slices.length < 2) {
      setClips([]);
      return;
    }
    setClips(prev => {
      if (prev.length === 0) return defaultClips(slices);
      return prev.map(c => ({
        ...c,
        sliceIndex: Math.min(Math.max(0, c.sliceIndex), slices.length - 1),
      }));
    });
  }, [slices]);

  const canBuild = slices.length >= 2 && clips.length >= 2 && audioBuffer !== null;

  const updateClip = useCallback((i: number, patch: Partial<OneshotClipParams>) => {
    setClips(prev => prev.map((c, j) => (j === i ? { ...c, ...patch } : c)));
  }, []);

  const addClip = useCallback(() => {
    setClips(prev => [
      ...prev,
      {
        sliceIndex: 0,
        reverse: false,
        gain: 1,
        startOffsetMs: 0,
        trimStartMs: 0,
        trimEndMs: 0,
      },
    ]);
  }, []);

  const removeClip = useCallback((i: number) => {
    setClips(prev => (prev.length <= 2 ? prev : prev.filter((_, j) => j !== i)));
  }, []);

  const randomize = useCallback(() => {
    const s = randomOneshotSettings(slices);
    setLayout(s.layout);
    setSequenceGapMs(s.sequenceGapMs);
    setClips(s.clips);
  }, [slices]);

  const build = useCallback(async () => {
    if (!audioBuffer || !canBuild) return null;
    const ctx = await ensureAudioContext();
    return buildOneshotComposite(audioBuffer, slices, clips, layout, sequenceGapMs, ctx);
  }, [audioBuffer, slices, clips, layout, sequenceGapMs, ensureAudioContext, canBuild]);

  const onPreview = useCallback(async () => {
    onStopOtherAudio();
    const buf = await build();
    if (buf && buf.length > 0) playOneshotPreview(buf);
  }, [build, onStopOtherAudio, playOneshotPreview]);

  const onExport = useCallback(async () => {
    const buf = await build();
    if (!buf || buf.length === 0) return;
    const wav = bufferToWav(buf);
    const blob = new Blob([wav], { type: 'audio/wav' });
    let saved = false;
    if (project?.hasProjectFolder) {
      saved = await project.trySaveOneshot(blob);
    }
    if (!saved) {
      triggerBlobDownload(blob, 'slicelab_oneshot.wav');
    }
  }, [build, project]);

  const onPlaySourceSlice = useCallback(
    (sliceIndex: number) => {
      const s = slices[sliceIndex];
      if (!s) return;
      onStopOtherAudio();
      playSlice(s);
    },
    [slices, onStopOtherAudio, playSlice],
  );

  if (slices.length < 2) {
    return (
      <div
        style={{
          flex: 1,
          minHeight: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 24,
          color: 'var(--muted)',
          fontSize: 13,
          textAlign: 'center',
          fontFamily: "'IBM Plex Sans', sans-serif",
        }}
      >
        Need at least two slices — analyze or apply slices first, then combine them here.
      </div>
    );
  }

  return (
    <div
      className="app-scroll"
      style={{
        flex: 1,
        minHeight: 0,
        overflow: 'auto',
        padding: '10px 14px 12px',
        display: 'flex',
        flexDirection: 'column',
        gap: 0,
        background: 'var(--bg)',
      }}
    >
      <div
        style={{
          marginBottom: 10,
          paddingBottom: 8,
          borderBottom: '1px solid var(--border)',
          display: 'flex',
          flexDirection: 'column',
          gap: 6,
        }}
      >
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'center',
            columnGap: 10,
            rowGap: 4,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, flexWrap: 'wrap' }}>
            <span
              style={{
                fontSize: 10,
                letterSpacing: 1.2,
                color: 'var(--faint)',
                textTransform: 'uppercase',
                fontFamily: mono,
              }}
            >
              Oneshots
            </span>
            <span style={{ fontSize: 7, color: 'var(--faint)', fontFamily: mono }}>combine · trim · reverse · export</span>
          </div>
          <p
            style={{
              margin: 0,
              fontSize: 10,
              lineHeight: 1.35,
              color: 'var(--muted)',
              flex: '1 1 200px',
              minWidth: 0,
            }}
          >
            <strong style={{ color: 'var(--text)', fontWeight: 500 }}>Play</strong> = raw slice; cards = processed preview.
          </p>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexShrink: 0, marginLeft: 'auto' }}>
            <button
              type="button"
              onClick={randomize}
              title="Random layout, slice picks, gap, trims, offsets, reverse, gain"
              style={{
                padding: '4px 9px',
                borderRadius: 2,
                border: '1px solid var(--border2)',
                background: 'var(--panel)',
                color: 'var(--text)',
                fontFamily: mono,
                fontSize: 10,
                cursor: 'pointer',
              }}
            >
              Randomize
            </button>
            <button
              type="button"
              onClick={() => void onPreview()}
              disabled={!canBuild}
              style={{
                padding: '4px 9px',
                fontSize: 10,
                border: '1px solid var(--text)',
                borderRadius: 2,
                background: canBuild ? 'var(--text)' : 'var(--border)',
                color: canBuild ? 'var(--surface)' : 'var(--faint)',
                cursor: canBuild ? 'pointer' : 'not-allowed',
                fontFamily: mono,
              }}
            >
              Preview
            </button>
            <button
              type="button"
              onClick={() => void onExport()}
              disabled={!canBuild}
              style={{
                padding: '4px 9px',
                fontSize: 10,
                border: '1px solid var(--border2)',
                borderRadius: 2,
                background: canBuild ? 'var(--surface)' : 'var(--panel)',
                color: canBuild ? 'var(--text)' : 'var(--faint)',
                cursor: canBuild ? 'pointer' : 'not-allowed',
                fontFamily: mono,
              }}
            >
              Export WAV
            </button>
          </div>
        </div>

        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'center',
            gap: 8,
            rowGap: 6,
          }}
        >
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6, rowGap: 4 }}>
            <span
              style={{
                fontSize: 10,
                letterSpacing: 1,
                color: 'var(--faint)',
                textTransform: 'uppercase',
                fontFamily: mono,
              }}
            >
              Mix
            </span>
            <span style={{ fontSize: 7, color: 'var(--faint)', fontFamily: mono }}>layout · gap · clips</span>
            <span style={{ fontSize: 9, color: 'var(--muted)', fontFamily: mono }}>Layout</span>
            <button
              type="button"
              onClick={() => setLayout('layer')}
              style={{
                padding: '4px 9px',
                borderRadius: 2,
                border: '1px solid',
                borderColor: layout === 'layer' ? 'var(--text)' : 'var(--border)',
                background: layout === 'layer' ? 'var(--text)' : 'var(--surface)',
                color: layout === 'layer' ? 'var(--surface)' : 'var(--muted)',
                fontFamily: mono,
                fontSize: 10,
                cursor: 'pointer',
              }}
            >
              Layer
            </button>
            <button
              type="button"
              onClick={() => setLayout('sequence')}
              style={{
                padding: '4px 9px',
                borderRadius: 2,
                border: '1px solid',
                borderColor: layout === 'sequence' ? 'var(--text)' : 'var(--border)',
                background: layout === 'sequence' ? 'var(--text)' : 'var(--surface)',
                color: layout === 'sequence' ? 'var(--surface)' : 'var(--muted)',
                fontFamily: mono,
                fontSize: 10,
                cursor: 'pointer',
              }}
            >
              Sequence
            </button>
            {layout === 'sequence' ? (
              <label
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 5,
                  padding: '3px 7px',
                  background: 'var(--surface)',
                  border: '1px solid var(--border)',
                  borderRadius: 2,
                  fontSize: 9,
                  color: 'var(--muted)',
                }}
              >
                <span style={{ fontFamily: mono }}>Gap</span>
                <input
                  type="number"
                  value={sequenceGapMs}
                  onChange={e => setSequenceGapMs(Number(e.target.value) || 0)}
                  style={{
                    ...inp,
                    width: 56,
                    background: 'var(--panel)',
                  }}
                />
                <span style={{ fontSize: 7, color: 'var(--faint)', fontFamily: mono }}>ms · − overlap</span>
              </label>
            ) : null}
            <button
              type="button"
              onClick={addClip}
              title="Add another slice to the composite"
              style={{
                padding: '4px 9px',
                fontSize: 10,
                border: '1px solid var(--border2)',
                borderRadius: 2,
                background: 'var(--surface)',
                color: 'var(--text)',
                cursor: 'pointer',
                fontFamily: mono,
              }}
            >
              + Add clip
            </button>
          </div>
          {audioBuffer ? (
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 2,
                flex: '0 1 320px',
                minWidth: 160,
                maxWidth: 380,
                marginLeft: 'auto',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                <span
                  style={{
                    fontSize: 9,
                    letterSpacing: 0.8,
                    color: 'var(--faint)',
                    textTransform: 'uppercase',
                    fontFamily: mono,
                  }}
                >
                  Output
                </span>
                <span style={{ fontSize: 7, color: 'var(--faint)', fontFamily: mono }}>preview · export</span>
              </div>
              <OneshotCompositeWaveform
                source={audioBuffer}
                slices={slices}
                clips={clips}
                layout={layout}
                sequenceGapMs={sequenceGapMs}
                canBuild={canBuild}
                ensureAudioContext={ensureAudioContext}
              />
            </div>
          ) : null}
        </div>
      </div>

      <div
        style={{
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          borderRadius: 2,
          padding: 8,
          marginBottom: 10,
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 8,
            marginBottom: 8,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
            <span
              style={{
                fontSize: 10,
                letterSpacing: 1.2,
                color: 'var(--faint)',
                textTransform: 'uppercase',
                fontFamily: mono,
              }}
            >
              Clips
            </span>
            <span style={{ fontSize: 8, color: 'var(--faint)', fontFamily: mono }}>{clips.length} in mix</span>
          </div>
        </div>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
            gap: 8,
          }}
        >
          {clips.map((clip, i) => (
            <div
              key={i}
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 6,
                padding: 8,
                background: 'var(--surface)',
                border: '1px solid var(--border)',
                borderRadius: 2,
                minWidth: 0,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 4 }}>
                <span
                  style={{
                    fontSize: 8,
                    fontFamily: mono,
                    letterSpacing: 0.5,
                    color: 'var(--muted)',
                    border: '1px solid var(--border)',
                    borderRadius: 2,
                    padding: '2px 5px',
                    lineHeight: 1,
                  }}
                >
                  #{String(i + 1).padStart(2, '0')}
                </span>
                <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  {clip.reverse ? (
                    <span
                      style={{
                        fontSize: 7,
                        fontFamily: mono,
                        letterSpacing: 0.6,
                        textTransform: 'uppercase',
                        color: 'var(--muted)',
                        border: '1px solid var(--border2)',
                        padding: '1px 4px',
                        borderRadius: 2,
                        lineHeight: 1,
                      }}
                    >
                      rev
                    </span>
                  ) : null}
                  {clips.length > 2 ? (
                    <button
                      type="button"
                      onClick={() => removeClip(i)}
                      style={{
                        padding: '2px 6px',
                        fontSize: 8,
                        border: '1px solid var(--border)',
                        borderRadius: 2,
                        background: 'transparent',
                        color: 'var(--muted)',
                        cursor: 'pointer',
                        fontFamily: mono,
                      }}
                    >
                      ×
                    </button>
                  ) : null}
                </div>
              </div>

              {audioBuffer ? (
                <OneshotClipWaveform
                  source={audioBuffer}
                  slices={slices}
                  clip={clip}
                  ensureAudioContext={ensureAudioContext}
                />
              ) : null}

              <div style={{ display: 'flex', gap: 6, alignItems: 'flex-end', minWidth: 0 }}>
                <label
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 3,
                    fontSize: 8,
                    color: 'var(--faint)',
                    fontFamily: mono,
                    flex: 1,
                    minWidth: 0,
                  }}
                >
                  Slice
                  <select
                    value={clip.sliceIndex}
                    onChange={e => {
                      const nextIdx = Number(e.target.value);
                      const sl = slices[nextIdx];
                      const d = (sl?.dur ?? 0) * 1000;
                      let ts = clip.trimStartMs;
                      let te = clip.trimEndMs;
                      if (d > 0 && ts + te > d) {
                        const scale = d / (ts + te);
                        ts = Math.floor(ts * scale);
                        te = Math.floor(te * scale);
                      }
                      updateClip(i, { sliceIndex: nextIdx, trimStartMs: ts, trimEndMs: te });
                    }}
                    style={{ ...inp, padding: '4px 6px' }}
                  >
                    {slices.map((s, idx) => (
                      <option key={idx} value={idx}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  type="button"
                  onClick={() => onPlaySourceSlice(clip.sliceIndex)}
                  title="Raw source (no trim / reverse / gain)"
                  style={{
                    padding: '4px 8px',
                    fontSize: 8,
                    border: '1px solid var(--border)',
                    borderRadius: 2,
                    background: 'var(--panel)',
                    color: 'var(--muted)',
                    cursor: 'pointer',
                    fontFamily: mono,
                    flexShrink: 0,
                    height: 26,
                    marginBottom: 0,
                  }}
                >
                  Play
                </button>
              </div>

              {(() => {
                const sl = slices[clip.sliceIndex];
                const durMs = sl ? sl.dur * 1000 : 0;
                const maxTrimIn = Math.max(0, Math.floor(durMs - clip.trimEndMs));
                const maxTrimOut = Math.max(0, Math.floor(durMs - clip.trimStartMs));
                const trimInVal = Math.min(clip.trimStartMs, maxTrimIn);
                const trimOutVal = Math.min(clip.trimEndMs, maxTrimOut);
                return (
                  <div
                    style={{
                      display: 'flex',
                      flexWrap: 'wrap',
                      justifyContent: 'center',
                      gap: 4,
                      marginTop: 2,
                    }}
                  >
                    <Knob
                      label="Gain"
                      value={clip.gain}
                      min={0}
                      max={3}
                      step={0.02}
                      display={`×${clip.gain.toFixed(2)}`}
                      onChange={v => updateClip(i, { gain: Math.round(Math.max(0, Math.min(3, v)) * 100) / 100 })}
                      title="Linear gain (0–3×)"
                      size={40}
                    />
                    <Knob
                      label="Trim in"
                      value={trimInVal}
                      min={0}
                      max={Math.max(0, maxTrimIn)}
                      step={1}
                      display={`${Math.round(trimInVal)} ms`}
                      onChange={v => {
                        const next = Math.max(0, Math.min(v, maxTrimIn));
                        updateClip(i, { trimStartMs: next });
                      }}
                      title="Trim from the start of this slice (ms)"
                      size={40}
                      disabled={!sl || durMs < 1}
                    />
                    <Knob
                      label="Trim out"
                      value={trimOutVal}
                      min={0}
                      max={Math.max(0, maxTrimOut)}
                      step={1}
                      display={`${Math.round(trimOutVal)} ms`}
                      onChange={v => {
                        const next = Math.max(0, Math.min(v, maxTrimOut));
                        updateClip(i, { trimEndMs: next });
                      }}
                      title="Trim from the end of this slice (ms)"
                      size={40}
                      disabled={!sl || durMs < 1}
                    />
                  </div>
                );
              })()}
              {layout === 'layer' ? (
                <label style={{ display: 'flex', flexDirection: 'column', gap: 3, fontSize: 8, color: 'var(--faint)', fontFamily: mono }}>
                  Offset (ms)
                  <input
                    type="number"
                    value={clip.startOffsetMs}
                    onChange={e => updateClip(i, { startOffsetMs: Number(e.target.value) || 0 })}
                    style={inp}
                  />
                </label>
              ) : null}

              <button
                type="button"
                onClick={() => updateClip(i, { reverse: !clip.reverse })}
                aria-pressed={clip.reverse}
                style={{
                  padding: '4px 8px',
                  fontSize: 8,
                  fontFamily: mono,
                  alignSelf: 'flex-start',
                  border: `1px solid ${clip.reverse ? 'var(--text)' : 'var(--border)'}`,
                  borderRadius: 2,
                  background: 'transparent',
                  color: clip.reverse ? 'var(--text)' : 'var(--muted)',
                  cursor: 'pointer',
                }}
              >
                Reverse {clip.reverse ? 'on' : 'off'}
              </button>
            </div>
          ))}
        </div>
      </div>

    </div>
  );
}
