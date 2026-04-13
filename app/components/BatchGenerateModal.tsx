'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import JSZip from 'jszip';
import type { Slice } from '../types';
import { bufferToWav } from '../lib/audio';
import { buildOneshotComposite, type OneshotClipParams, type OneshotLayout } from '../lib/oneshotBuild';
import {
  DEFAULT_SEQUENCE_GAP_MAX_MS,
  DEFAULT_SEQUENCE_GAP_MIN_MS,
  MAX_BATCH_ONESHOTS,
  MAX_ONESHOT_CLIPS,
  formatPlanLabel,
  generateRandomOneshotPlans,
  randomClipParamsForIndices,
  randomSequenceGapMs,
  shufflePlanOrder,
} from '../lib/oneshotBatch';
import { useProjectOptional } from '../context/ProjectContext';
import { triggerBlobDownload } from '../lib/projectFolder';

const mono = "'IBM Plex Mono', monospace" as const;

export interface BatchGenerateModalProps {
  open: boolean;
  onClose: () => void;
  slices: Slice[];
  audioBuffer: AudioBuffer | null;
  ensureAudioContext: () => Promise<AudioContext>;
  playOneshotPreview: (buffer: AudioBuffer) => void;
  onStopOtherAudio: () => void;
  playSlice: (slice: Slice) => void;
}

type BatchResult = {
  index: number;
  planIndices: number[];
  sliceNames: string[];
  buffer: AudioBuffer;
  /** Per-file sequence gap when layout is sequence (random within user min…max ms). */
  sequenceGapMs?: number;
  clipParams: OneshotClipParams[];
};

export function BatchGenerateModal({
  open,
  onClose,
  slices,
  audioBuffer,
  ensureAudioContext,
  playOneshotPreview,
  onStopOtherAudio,
  playSlice,
}: BatchGenerateModalProps) {
  const project = useProjectOptional();
  const [layout, setLayout] = useState<OneshotLayout>('layer');
  /** Per-oneshot sequence gap is uniform random in [min, max] ms when layout is sequence. */
  const [sequenceGapMinMs, setSequenceGapMinMs] = useState(DEFAULT_SEQUENCE_GAP_MIN_MS);
  const [sequenceGapMaxMs, setSequenceGapMaxMs] = useState(DEFAULT_SEQUENCE_GAP_MAX_MS);
  /** How many oneshots to draw / generate (unique plans, capped by pool). */
  const [generateCount, setGenerateCount] = useState(24);
  /** Slice indices excluded from batch (unchecked = excluded). */
  const [excluded, setExcluded] = useState<Set<number>>(() => new Set());

  const [results, setResults] = useState<BatchResult[] | null>(null);
  /** Result `index` values (1-based) included in ZIP; all selected when a new batch finishes. */
  const [zipInclude, setZipInclude] = useState<Set<number>>(() => new Set());
  const [generating, setGenerating] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setExcluded(new Set());
    setSequenceGapMinMs(DEFAULT_SEQUENCE_GAP_MIN_MS);
    setSequenceGapMaxMs(DEFAULT_SEQUENCE_GAP_MAX_MS);
    setGenerateCount(24);
    setResults(null);
    setZipInclude(new Set());
    setError(null);
    setProgress(null);
    setGenerating(false);
  }, [open]);

  const includedIndices = useMemo(
    () => slices.map((_, i) => i).filter(i => !excluded.has(i)),
    [slices, excluded],
  );

  const cappedCount = Math.min(MAX_BATCH_ONESHOTS, Math.max(1, Math.floor(generateCount) || 1));

  const basePlans = useMemo(
    () => generateRandomOneshotPlans(includedIndices, layout, cappedCount),
    [includedIndices, layout, cappedCount],
  );

  /** Current order of combinations (reset when pool/layout changes; use Randomise to shuffle). */
  const [orderedPlans, setOrderedPlans] = useState<number[][]>([]);

  useEffect(() => {
    setOrderedPlans(shufflePlanOrder(basePlans.map(p => [...p])));
    setResults(null);
    setZipInclude(new Set());
  }, [basePlans]);

  const canGenerate =
    audioBuffer !== null &&
    includedIndices.length >= 2 &&
    orderedPlans.length > 0 &&
    !generating;

  const toggleExclude = useCallback((sliceIndex: number) => {
    setExcluded(prev => {
      const next = new Set(prev);
      if (next.has(sliceIndex)) next.delete(sliceIndex);
      else next.add(sliceIndex);
      return next;
    });
    setResults(null);
  }, []);

  const onRandomiseOrder = useCallback(() => {
    setOrderedPlans(prev => shufflePlanOrder(prev.length ? prev : basePlans.map(p => [...p])));
    setResults(null);
    setError(null);
  }, [basePlans]);

  const onGenerate = useCallback(async () => {
    if (!audioBuffer || !canGenerate) return;
    setError(null);
    setResults(null);
    setGenerating(true);
    const total = orderedPlans.length;
    setProgress({ done: 0, total });
    try {
      const ctx = await ensureAudioContext();
      const built: BatchResult[] = [];
      for (let p = 0; p < orderedPlans.length; p++) {
        const planIndices = orderedPlans[p]!;
        const clips = randomClipParamsForIndices(slices, planIndices);
        const gapMs =
          layout === 'sequence' ? randomSequenceGapMs(sequenceGapMinMs, sequenceGapMaxMs) : 0;
        const buf = buildOneshotComposite(audioBuffer, slices, clips, layout, gapMs, ctx);
        if (!buf || buf.length === 0) {
          setError(`Could not build oneshot for plan ${p + 1} (${formatPlanLabel(planIndices.map(i => slices[i]?.name ?? `#${i}`), layout)}).`);
          setGenerating(false);
          setProgress(null);
          return;
        }
        built.push({
          index: p + 1,
          planIndices,
          sliceNames: planIndices.map(i => slices[i]?.name ?? `#${i}`),
          buffer: buf,
          sequenceGapMs: layout === 'sequence' ? gapMs : undefined,
          clipParams: clips.map(c => ({ ...c })),
        });
        setProgress({ done: p + 1, total });
      }
      setResults(built);
      setZipInclude(new Set(built.map(b => b.index)));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Generation failed');
    } finally {
      setGenerating(false);
      setProgress(null);
    }
  }, [
    audioBuffer,
    canGenerate,
    ensureAudioContext,
    layout,
    orderedPlans,
    sequenceGapMaxMs,
    sequenceGapMinMs,
    slices,
  ]);

  const toggleZipInclude = useCallback((resultIndex: number) => {
    setZipInclude(prev => {
      const next = new Set(prev);
      if (next.has(resultIndex)) next.delete(resultIndex);
      else next.add(resultIndex);
      return next;
    });
  }, []);

  const selectAllZip = useCallback(() => {
    if (!results?.length) return;
    setZipInclude(new Set(results.map(r => r.index)));
  }, [results]);

  const selectNoneZip = useCallback(() => {
    setZipInclude(new Set());
  }, []);

  const onDownloadZip = useCallback(async () => {
    if (!results || results.length === 0) return;
    const picked = results.filter(r => zipInclude.has(r.index));
    if (picked.length === 0) return;
    const zip = new JSZip();
    const manifest: {
      layout: OneshotLayout;
      note: string;
      sequenceGapRangeMs?: { min: number; max: number };
      items: {
        file: string;
        batchIndex: number;
        sliceIndices: number[];
        sliceNames: string[];
        sequenceGapMs?: number;
        clips: OneshotClipParams[];
      }[];
    } = {
      layout,
      note:
        'Each item uses the same random trim/gain/reverse/offset distribution as main Oneshots Randomize. Sequence gap is uniform random per file within the saved gap range. Files are numbered 001… in export order among checked rows.',
      sequenceGapRangeMs:
        layout === 'sequence'
          ? {
              min: Math.min(sequenceGapMinMs, sequenceGapMaxMs),
              max: Math.max(sequenceGapMinMs, sequenceGapMaxMs),
            }
          : undefined,
      items: [],
    };

    picked.forEach((r, i) => {
      const name = `oneshot_${String(i + 1).padStart(3, '0')}.wav`;
      const wav = bufferToWav(r.buffer);
      zip.file(name, wav);
      manifest.items.push({
        file: name,
        batchIndex: r.index,
        sliceIndices: r.planIndices,
        sliceNames: r.sliceNames,
        sequenceGapMs: r.sequenceGapMs,
        clips: r.clipParams.map(c => ({ ...c })),
      });
    });
    zip.file('manifest.json', JSON.stringify(manifest, null, 2));
    const blob = await zip.generateAsync({ type: 'blob' });
    let saved = false;
    if (project?.hasProjectFolder) {
      saved = await project.trySaveOneshotBatchZip(blob);
    }
    if (!saved) {
      triggerBlobDownload(blob, 'slicelab_batch_oneshots.zip');
    }
  }, [layout, project, results, sequenceGapMaxMs, sequenceGapMinMs, zipInclude]);

  const onPreviewResult = useCallback(
    (buf: AudioBuffer) => {
      onStopOtherAudio();
      playOneshotPreview(buf);
    },
    [onStopOtherAudio, playOneshotPreview],
  );

  const onPreviewPoolSlice = useCallback(
    (slice: Slice) => {
      onStopOtherAudio();
      playSlice(slice);
    },
    [onStopOtherAudio, playSlice],
  );

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="batch-gen-title"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 1000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 16,
        background: 'rgba(12, 14, 18, 0.72)',
        backdropFilter: 'blur(4px)',
      }}
      onClick={e => {
        if (e.target === e.currentTarget) onClose();
      }}
      onKeyDown={e => {
        if (e.key === 'Escape') onClose();
      }}
    >
      <div
        style={{
          width: 'min(920px, 100%)',
          height: 'min(88vh, 900px)',
          maxHeight: 'min(88vh, 900px)',
          display: 'flex',
          flexDirection: 'column',
          background: 'var(--panel)',
          border: '1px solid var(--border)',
          borderRadius: 4,
          boxShadow: '0 16px 48px rgba(0,0,0,0.35)',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
            padding: '12px 14px',
            borderBottom: '1px solid var(--border)',
            flexShrink: 0,
          }}
        >
          <h2
            id="batch-gen-title"
            style={{
              margin: 0,
              fontSize: 13,
              fontWeight: 600,
              fontFamily: mono,
              letterSpacing: 0.6,
              textTransform: 'uppercase',
              color: 'var(--text)',
            }}
          >
            Batch generate
          </h2>
          <button
            type="button"
            onClick={onClose}
            style={{
              padding: '4px 10px',
              fontSize: 10,
              fontFamily: mono,
              border: '1px solid var(--border)',
              borderRadius: 2,
              background: 'var(--surface)',
              color: 'var(--muted)',
              cursor: 'pointer',
            }}
          >
            Close
          </button>
        </div>

        <div
          style={{
            flex: 1,
            minHeight: 0,
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 340px), 1fr))',
            gap: 0,
            alignItems: 'stretch',
            overflow: 'hidden',
          }}
        >
          {/* Input */}
          <div
            className="app-scroll"
            style={{
              padding: 14,
              display: 'flex',
              flexDirection: 'column',
              gap: 12,
              borderRight: '1px solid var(--border)',
              minWidth: 0,
              overflow: 'auto',
            }}
          >
            <div
              style={{
                display: 'flex',
                flexWrap: 'wrap',
                alignItems: 'center',
                gap: 8,
                rowGap: 6,
              }}
            >
              <button
                type="button"
                onClick={onRandomiseOrder}
                disabled={orderedPlans.length < 2}
                title="Shuffle the order of the current plan list (same combinations)"
                style={{
                  padding: '6px 12px',
                  fontSize: 11,
                  fontFamily: mono,
                  border: '1px solid var(--border2)',
                  borderRadius: 2,
                  background: orderedPlans.length >= 2 ? 'var(--panel)' : 'var(--surface)',
                  color: orderedPlans.length >= 2 ? 'var(--text)' : 'var(--faint)',
                  cursor: orderedPlans.length >= 2 ? 'pointer' : 'not-allowed',
                }}
              >
                Randomise order
              </button>
              <button
                type="button"
                onClick={() => void onGenerate()}
                disabled={!canGenerate}
                style={{
                  padding: '6px 14px',
                  fontSize: 11,
                  fontFamily: mono,
                  border: '1px solid var(--text)',
                  borderRadius: 2,
                  background: canGenerate ? 'var(--text)' : 'var(--border)',
                  color: canGenerate ? 'var(--surface)' : 'var(--faint)',
                  cursor: canGenerate ? 'pointer' : 'not-allowed',
                }}
              >
                Generate
              </button>
              {progress ? (
                <span style={{ fontSize: 10, fontFamily: mono, color: 'var(--muted)' }}>
                  Generating… {progress.done}/{progress.total}
                </span>
              ) : null}
            </div>

            <p style={{ margin: 0, fontSize: 11, color: 'var(--muted)', lineHeight: 1.45 }}>
              Draws up to your <strong style={{ color: 'var(--text)' }}>max count</strong> of unique combinations (2–{MAX_ONESHOT_CLIPS} clips per
              plan). With a small pool, lower the count so you are not flooded with near-duplicates — change layout or exclusions to draw a new set.
              Each file uses the same <strong style={{ color: 'var(--text)' }}>Randomize</strong> trim / gain / reverse / offset distribution as the
              main Oneshots tab; for sequence, each oneshot picks a gap at random in the gap range you set below. Click a slice name to preview it;
              uncheck to exclude from the pool.
            </p>

            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center' }}>
              <label
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 8,
                  fontSize: 9,
                  color: 'var(--muted)',
                  fontFamily: mono,
                }}
              >
                Max to generate
                <input
                  type="number"
                  min={1}
                  max={MAX_BATCH_ONESHOTS}
                  value={generateCount}
                  onChange={e => {
                    const raw = Number(e.target.value);
                    if (!Number.isFinite(raw)) return;
                    setGenerateCount(Math.min(MAX_BATCH_ONESHOTS, Math.max(1, Math.floor(raw))));
                  }}
                  style={{
                    width: 52,
                    padding: '4px 6px',
                    fontSize: 10,
                    fontFamily: mono,
                    border: '1px solid var(--border)',
                    borderRadius: 2,
                    background: 'var(--surface)',
                    color: 'var(--text)',
                  }}
                />
                <span style={{ fontSize: 8, color: 'var(--faint)' }}>1–{MAX_BATCH_ONESHOTS}</span>
              </label>
            </div>

            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
              <span style={{ fontSize: 9, color: 'var(--faint)', fontFamily: mono, textTransform: 'uppercase' }}>Layout</span>
              <button
                type="button"
                onClick={() => {
                  setLayout('layer');
                  setResults(null);
                }}
                style={{
                  padding: '4px 10px',
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
                onClick={() => {
                  setLayout('sequence');
                  setResults(null);
                }}
                style={{
                  padding: '4px 10px',
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
                    flexWrap: 'wrap',
                    alignItems: 'center',
                    gap: 6,
                    fontSize: 9,
                    color: 'var(--muted)',
                    fontFamily: mono,
                  }}
                >
                  <span style={{ fontSize: 8, color: 'var(--faint)' }}>Gap range (ms)</span>
                  <input
                    type="number"
                    value={sequenceGapMinMs}
                    onChange={e => setSequenceGapMinMs(Number(e.target.value) || 0)}
                    title="Minimum gap between clips (negative = overlap)"
                    style={{
                      width: 52,
                      padding: '4px 6px',
                      fontSize: 10,
                      fontFamily: mono,
                      border: '1px solid var(--border)',
                      borderRadius: 2,
                      background: 'var(--surface)',
                      color: 'var(--text)',
                    }}
                  />
                  <span style={{ fontSize: 9, color: 'var(--faint)' }}>–</span>
                  <input
                    type="number"
                    value={sequenceGapMaxMs}
                    onChange={e => setSequenceGapMaxMs(Number(e.target.value) || 0)}
                    title="Maximum gap between clips"
                    style={{
                      width: 52,
                      padding: '4px 6px',
                      fontSize: 10,
                      fontFamily: mono,
                      border: '1px solid var(--border)',
                      borderRadius: 2,
                      background: 'var(--surface)',
                      color: 'var(--text)',
                    }}
                  />
                  <span style={{ fontSize: 7, color: 'var(--faint)', fontFamily: mono, maxWidth: 200, lineHeight: 1.35 }}>
                    uniform random each oneshot · − = overlap
                  </span>
                </label>
              ) : null}
            </div>

            <div
              style={{
                border: '1px solid var(--border)',
                borderRadius: 2,
                padding: 10,
                background: 'var(--surface)',
              }}
            >
              <div style={{ fontSize: 9, letterSpacing: 0.8, color: 'var(--faint)', fontFamily: mono, marginBottom: 8 }}>
                Slices in pool · checkbox include · name = preview
              </div>
              <div
                className="app-scroll"
                style={{
                  maxHeight: 220,
                  minHeight: 0,
                  overflow: 'auto',
                }}
              >
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignContent: 'flex-start' }}>
                  {slices.map((s, i) => {
                    const on = !excluded.has(i);
                    return (
                      <div
                        key={i}
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 6,
                          padding: '4px 8px',
                          borderRadius: 2,
                          border: `1px solid ${on ? 'var(--border2)' : 'var(--border)'}`,
                          background: on ? 'var(--panel)' : 'transparent',
                          opacity: on ? 1 : 0.55,
                          fontSize: 10,
                          fontFamily: mono,
                          color: 'var(--text)',
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={on}
                          onChange={() => toggleExclude(i)}
                          title="Include in random combinations"
                          style={{ accentColor: 'var(--text)', cursor: 'pointer' }}
                        />
                        <button
                          type="button"
                          onClick={() => onPreviewPoolSlice(s)}
                          title="Preview this slice (raw)"
                          style={{
                            border: 'none',
                            background: 'transparent',
                            padding: 0,
                            margin: 0,
                            font: 'inherit',
                            color: 'inherit',
                            cursor: 'pointer',
                            textAlign: 'left',
                            textDecoration: 'underline',
                            textDecorationColor: 'var(--border2)',
                            textUnderlineOffset: 2,
                          }}
                        >
                          {s.name}
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>

            <div
              style={{
                border: '1px solid var(--border)',
                borderRadius: 2,
                padding: 10,
                background: 'var(--surface)',
                flex: 1,
                minHeight: 140,
                maxHeight: 320,
                overflow: 'auto',
                display: 'flex',
                flexDirection: 'column',
              }}
            >
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0, marginBottom: 8 }}>
                <span style={{ fontSize: 9, letterSpacing: 0.8, color: 'var(--faint)', fontFamily: mono }}>
                  Combination order ({orderedPlans.length} plans · target {cappedCount})
                </span>
                <span style={{ fontSize: 8, color: 'var(--faint)', fontFamily: mono, lineHeight: 1.4 }}>
                  Random unique set (2–{MAX_ONESHOT_CLIPS} clips). Use <strong style={{ color: 'var(--muted)', fontWeight: 500 }}>Randomise order</strong>{' '}
                  above to reshuffle; change layout or pool for a new draw.
                </span>
              </div>
              {includedIndices.length < 2 ? (
                <p style={{ margin: 0, fontSize: 11, color: 'var(--muted)' }}>Include at least two slices.</p>
              ) : orderedPlans.length === 0 ? (
                <p style={{ margin: 0, fontSize: 11, color: 'var(--muted)' }}>No plans (unexpected).</p>
              ) : (
                <ul
                  style={{
                    margin: 0,
                    paddingLeft: 18,
                    fontSize: 10,
                    fontFamily: mono,
                    color: 'var(--muted)',
                    lineHeight: 1.6,
                  }}
                >
                  {orderedPlans.map((plan, idx) => (
                    <li key={idx}>
                      {formatPlanLabel(
                        plan.map(i => slices[i]?.name ?? `#${i}`),
                        layout,
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {error ? (
              <p style={{ margin: 0, fontSize: 11, color: '#c45c5c' }}>{error}</p>
            ) : null}
          </div>

          {/* Output */}
          <div
            className="app-scroll"
            style={{
              padding: 14,
              display: 'flex',
              flexDirection: 'column',
              gap: 10,
              background: 'var(--bg)',
              minWidth: 0,
              minHeight: 0,
              overflow: 'auto',
            }}
          >
            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
                <span style={{ fontSize: 9, letterSpacing: 0.8, color: 'var(--faint)', fontFamily: mono, textTransform: 'uppercase' }}>
                  Output
                </span>
                {results && results.length > 0 ? (
                  <span style={{ fontSize: 8, color: 'var(--faint)', fontFamily: mono }}>
                    {zipInclude.size} of {results.length} selected for ZIP
                  </span>
                ) : null}
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6 }}>
                {results && results.length > 0 ? (
                  <>
                    <button
                      type="button"
                      onClick={selectAllZip}
                      style={{
                        padding: '4px 8px',
                        fontSize: 9,
                        fontFamily: mono,
                        border: '1px solid var(--border)',
                        borderRadius: 2,
                        background: 'transparent',
                        color: 'var(--muted)',
                        cursor: 'pointer',
                      }}
                    >
                      All
                    </button>
                    <button
                      type="button"
                      onClick={selectNoneZip}
                      style={{
                        padding: '4px 8px',
                        fontSize: 9,
                        fontFamily: mono,
                        border: '1px solid var(--border)',
                        borderRadius: 2,
                        background: 'transparent',
                        color: 'var(--muted)',
                        cursor: 'pointer',
                      }}
                    >
                      None
                    </button>
                  </>
                ) : null}
                <button
                  type="button"
                  onClick={() => void onDownloadZip()}
                  disabled={!results || results.length === 0 || zipInclude.size === 0}
                  style={{
                    padding: '6px 14px',
                    fontSize: 11,
                    fontFamily: mono,
                    border: '1px solid var(--border2)',
                    borderRadius: 2,
                    background:
                      results && results.length > 0 && zipInclude.size > 0 ? 'var(--surface)' : 'var(--panel)',
                    color: results && results.length > 0 && zipInclude.size > 0 ? 'var(--text)' : 'var(--faint)',
                    cursor:
                      results && results.length > 0 && zipInclude.size > 0 ? 'pointer' : 'not-allowed',
                  }}
                >
                  Download ZIP
                </button>
              </div>
            </div>

            {!results || results.length === 0 ? (
              <div
                style={{
                  flex: 1,
                  minHeight: 120,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  border: '1px dashed var(--border)',
                  borderRadius: 2,
                  padding: 16,
                }}
              >
                <p style={{ margin: 0, fontSize: 11, color: 'var(--muted)', textAlign: 'center', lineHeight: 1.5 }}>
                  Generated oneshots appear here with slice tags and preview. Run <strong style={{ color: 'var(--text)' }}>Generate</strong>{' '}
                  from the left panel.
                </p>
              </div>
            ) : (
              <div
                className="app-scroll"
                style={{
                  flex: 1,
                  minHeight: 0,
                  overflow: 'auto',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 8,
                }}
              >
                <div style={{ fontSize: 9, letterSpacing: 0.8, color: 'var(--faint)', fontFamily: mono }}>
                  {results.length} file{results.length === 1 ? '' : 's'} · check rows to include in ZIP · each uses a fresh Randomize-style render
                </div>
                {results.map(r => (
                  <div
                    key={r.index}
                    style={{
                      display: 'flex',
                      flexWrap: 'wrap',
                      alignItems: 'center',
                      gap: 8,
                      padding: 8,
                      background: 'var(--panel)',
                      border: `1px solid ${zipInclude.has(r.index) ? 'var(--border)' : 'var(--border2)'}`,
                      borderRadius: 2,
                      opacity: zipInclude.has(r.index) ? 1 : 0.65,
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={zipInclude.has(r.index)}
                      onChange={() => toggleZipInclude(r.index)}
                      title="Include in ZIP"
                      style={{ accentColor: 'var(--text)', cursor: 'pointer', flexShrink: 0 }}
                    />
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 100 }}>
                      <span style={{ fontSize: 9, fontFamily: mono, color: 'var(--faint)' }}>
                        oneshot_{String(r.index).padStart(3, '0')}.wav
                      </span>
                      {r.sequenceGapMs !== undefined ? (
                        <span style={{ fontSize: 8, fontFamily: mono, color: 'var(--faint)' }}>gap {r.sequenceGapMs} ms</span>
                      ) : null}
                    </div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, flex: 1, minWidth: 0 }}>
                      {r.sliceNames.map((name, j) => (
                        <span
                          key={j}
                          style={{
                            fontSize: 9,
                            fontFamily: mono,
                            padding: '2px 6px',
                            borderRadius: 2,
                            border: '1px solid var(--border2)',
                            color: 'var(--text)',
                          }}
                        >
                          {name}
                        </span>
                      ))}
                    </div>
                    <button
                      type="button"
                      onClick={() => onPreviewResult(r.buffer)}
                      style={{
                        padding: '4px 10px',
                        fontSize: 9,
                        fontFamily: mono,
                        border: '1px solid var(--border)',
                        borderRadius: 2,
                        background: 'var(--surface)',
                        color: 'var(--muted)',
                        cursor: 'pointer',
                        flexShrink: 0,
                      }}
                    >
                      Preview
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
