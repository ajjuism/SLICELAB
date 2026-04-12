'use client';

import { useRef, useState, useCallback, useEffect } from 'react';
import JSZip from 'jszip';
import type { Slice, DetectionSettings, FadeSettings, NamingSettings, AudioInfo, TimeSignature } from '../types';
import {
  detectSlices,
  sliceToAudioBuffer,
  buildLayeredDrumPatternBuffer,
  bufferToWav,
  getLoopStepLayout,
  samplePositionToLoopStep,
} from '../lib/audio';

export function useAudioEngine() {
  const audioCtxRef = useRef<AudioContext | null>(null);
  const currentSourceRef = useRef<AudioBufferSourceNode | null>(null);
  const loopSourceRef = useRef<AudioBufferSourceNode | null>(null);
  const audioBufferRef = useRef<AudioBuffer | null>(null);

  const [audioInfo, setAudioInfo] = useState<AudioInfo | null>(null);
  const [slices, setSlices] = useState<Slice[]>([]);
  const [playingIndex, setPlayingIndex] = useState<number | null>(null);
  const [loopPlaying, setLoopPlaying] = useState(false);
  /** Current step index within the bar while the loop is playing (for UI playhead). */
  const [loopPlayheadStep, setLoopPlayheadStep] = useState<number | null>(null);

  const loopCtxStartRef = useRef<number | null>(null);
  const loopStepStartsRef = useRef<number[]>([]);
  const loopTotalSamplesRef = useRef(0);
  const loopSampleRateRef = useRef(48000);
  const playheadRafRef = useRef(0);

  /** Master waveform: preview playhead + slice highlight (slice tab playback). */
  const [waveformPlayheadSec, setWaveformPlayheadSec] = useState<number | null>(null);
  const [waveformHighlightSec, setWaveformHighlightSec] = useState<{ start: number; end: number } | null>(null);
  const previewStartRef = useRef<number | null>(null);
  const previewSliceRef = useRef<Slice | null>(null);
  const previewRafRef = useRef(0);

  const [status, setStatus] = useState('Ready — drop a file to begin');
  const [statusActive, setStatusActive] = useState(false);
  const [progress, setProgress] = useState(0);
  const [isLoading, setIsLoading] = useState(false);

  const getCtx = useCallback(() => {
    if (!audioCtxRef.current) {
      audioCtxRef.current = new AudioContext();
    }
    return audioCtxRef.current;
  }, []);

  const loadFile = useCallback(async (file: File) => {
    setIsLoading(true);
    setStatus(`Loading ${file.name}…`);
    setStatusActive(true);
    setProgress(20);

    try {
      const ctx = getCtx();
      if (ctx.state === 'suspended') await ctx.resume();

      const arr = await file.arrayBuffer();
      const buffer = await ctx.decodeAudioData(arr);
      audioBufferRef.current = buffer;

      setAudioInfo({
        duration: buffer.duration,
        sampleRate: buffer.sampleRate,
        channels: buffer.numberOfChannels,
        fileName: file.name.length > 32 ? file.name.slice(0, 30) + '…' : file.name,
      });
      setSlices([]);
      setProgress(100);
      setTimeout(() => setProgress(0), 500);
      setStatus(`Loaded · ${buffer.duration.toFixed(2)}s · ${buffer.sampleRate}Hz · ${buffer.numberOfChannels}ch`);
      setStatusActive(false);
    } catch {
      setStatus('Error decoding audio — try another format');
      setStatusActive(false);
    } finally {
      setIsLoading(false);
    }
  }, [getCtx]);

  const analyze = useCallback((
    detection: DetectionSettings,
    fade: FadeSettings,
    naming: NamingSettings,
  ) => {
    if (!audioBufferRef.current) return;
    setStatus('Analyzing…');
    setStatusActive(true);
    setProgress(30);

    setTimeout(() => {
      try {
        const result = detectSlices(audioBufferRef.current!, detection, fade, naming);
        setSlices(result);
        setProgress(100);
        setTimeout(() => setProgress(0), 500);
        setStatus(`${result.length} slices detected — click to preview, download zip when ready`);
        setStatusActive(false);
      } catch {
        setStatus('Analysis failed');
        setStatusActive(false);
        setProgress(0);
      }
    }, 40);
  }, []);

  const stopLoop = useCallback(() => {
    if (loopSourceRef.current) {
      try { loopSourceRef.current.stop(); } catch { /* ok */ }
      loopSourceRef.current = null;
    }
    loopCtxStartRef.current = null;
    loopStepStartsRef.current = [];
    loopTotalSamplesRef.current = 0;
    setLoopPlaying(false);
  }, []);

  useEffect(() => {
    if (!loopPlaying) {
      setLoopPlayheadStep(null);
      return;
    }
    const tick = () => {
      const ctx = audioCtxRef.current;
      const t0 = loopCtxStartRef.current;
      const starts = loopStepStartsRef.current;
      const total = loopTotalSamplesRef.current;
      const sr = loopSampleRateRef.current;
      if (!ctx || t0 === null || starts.length === 0 || total <= 0) {
        playheadRafRef.current = requestAnimationFrame(tick);
        return;
      }
      const elapsed = ctx.currentTime - t0;
      const raw = elapsed * sr;
      const samplePos = ((Math.floor(raw) % total) + total) % total;
      const step = samplePositionToLoopStep(samplePos, starts, total);
      setLoopPlayheadStep(step);
      playheadRafRef.current = requestAnimationFrame(tick);
    };
    playheadRafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(playheadRafRef.current);
  }, [loopPlaying]);

  useEffect(() => {
    if (playingIndex === null) {
      setWaveformPlayheadSec(null);
      setWaveformHighlightSec(null);
      previewStartRef.current = null;
      previewSliceRef.current = null;
      return;
    }
    const tick = () => {
      const ctx = audioCtxRef.current;
      const t0 = previewStartRef.current;
      const buf = audioBufferRef.current;
      if (!ctx || t0 === null || !buf) {
        previewRafRef.current = requestAnimationFrame(tick);
        return;
      }
      const elapsed = ctx.currentTime - t0;
      if (playingIndex === -1) {
        const pos = Math.min(Math.max(0, elapsed), buf.duration);
        setWaveformPlayheadSec(pos);
      } else {
        const sl = previewSliceRef.current;
        if (sl) {
          const pos = Math.min(sl.start + elapsed, sl.end);
          setWaveformPlayheadSec(pos);
        }
      }
      previewRafRef.current = requestAnimationFrame(tick);
    };
    previewRafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(previewRafRef.current);
  }, [playingIndex]);

  const playLoop = useCallback((
    layers: (number | null)[][],
    layerMutes: boolean[],
    bpm: number,
    stepsPerBar: 8 | 16,
    swingPercent: number,
    timeSignature: TimeSignature,
  ) => {
    if (!audioBufferRef.current) return;
    const ctx = getCtx();
    if (ctx.state === 'suspended') void ctx.resume();

    if (currentSourceRef.current) {
      try { currentSourceRef.current.stop(); } catch { /* ok */ }
      currentSourceRef.current = null;
    }
    setPlayingIndex(null);

    stopLoop();

    const sr = audioBufferRef.current.sampleRate;
    const layout = getLoopStepLayout(bpm, stepsPerBar, swingPercent, timeSignature, sr);

    const bar = buildLayeredDrumPatternBuffer(
      audioBufferRef.current,
      slices,
      layers,
      layerMutes,
      bpm,
      stepsPerBar,
      swingPercent,
      timeSignature,
      ctx,
    );
    if (!bar || bar.length === 0) return;

    loopStepStartsRef.current = layout.stepStartSamples;
    loopTotalSamplesRef.current = layout.totalSamples;
    loopSampleRateRef.current = bar.sampleRate;

    const src = ctx.createBufferSource();
    src.buffer = bar;
    src.loop = true;
    src.connect(ctx.destination);
    const startAt = ctx.currentTime;
    loopCtxStartRef.current = startAt;
    src.start(startAt);
    loopSourceRef.current = src;
    setLoopPlaying(true);
  }, [getCtx, slices, stopLoop]);

  const downloadLoopWav = useCallback((
    layers: (number | null)[][],
    layerMutes: boolean[],
    bpm: number,
    stepsPerBar: 8 | 16,
    swingPercent: number,
    timeSignature: TimeSignature,
  ) => {
    if (!audioBufferRef.current) return;
    const ctx = getCtx();
    if (ctx.state === 'suspended') void ctx.resume();

    const bar = buildLayeredDrumPatternBuffer(
      audioBufferRef.current,
      slices,
      layers,
      layerMutes,
      bpm,
      stepsPerBar,
      swingPercent,
      timeSignature,
      ctx,
    );
    if (!bar || bar.length === 0) return;

    const wav = bufferToWav(bar);
    const blob = new Blob([wav], { type: 'audio/wav' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'slicelab_loop.wav';
    a.click();
    URL.revokeObjectURL(url);
    setStatus('Downloaded loop as slicelab_loop.wav');
    setStatusActive(false);
  }, [getCtx, slices]);

  const playSlice = useCallback((slice: Slice) => {
    if (!audioBufferRef.current) return;
    const ctx = getCtx();
    if (ctx.state === 'suspended') ctx.resume();

    stopLoop();

    if (currentSourceRef.current) {
      try { currentSourceRef.current.stop(); } catch { /* already stopped */ }
    }

    const buf = sliceToAudioBuffer(audioBufferRef.current, slice, ctx);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(ctx.destination);

    previewSliceRef.current = slice;
    const t0 = ctx.currentTime;
    previewStartRef.current = t0;
    setWaveformHighlightSec({ start: slice.start, end: slice.end });
    setWaveformPlayheadSec(slice.start);
    src.start(t0);

    src.onended = () => setPlayingIndex(null);
    currentSourceRef.current = src;
    setPlayingIndex(slice.index);
  }, [getCtx, stopLoop]);

  /** Play the entire loaded file (not slice extractions). Uses playingIndex -1 while active. */
  const playFullSource = useCallback(() => {
    if (!audioBufferRef.current) return;
    const ctx = getCtx();
    if (ctx.state === 'suspended') void ctx.resume();

    stopLoop();

    if (currentSourceRef.current) {
      try { currentSourceRef.current.stop(); } catch { /* already stopped */ }
    }

    const src = ctx.createBufferSource();
    src.buffer = audioBufferRef.current;
    src.connect(ctx.destination);

    previewSliceRef.current = null;
    const t0 = ctx.currentTime;
    previewStartRef.current = t0;
    setWaveformHighlightSec(null);
    setWaveformPlayheadSec(0);
    src.start(t0);

    src.onended = () => setPlayingIndex(null);
    currentSourceRef.current = src;
    setPlayingIndex(-1);
  }, [getCtx, stopLoop]);

  const stopPlayback = useCallback(() => {
    stopLoop();
    if (currentSourceRef.current) {
      try { currentSourceRef.current.stop(); } catch { /* ok */ }
    }
    setPlayingIndex(null);
    setWaveformPlayheadSec(null);
    setWaveformHighlightSec(null);
    previewStartRef.current = null;
    previewSliceRef.current = null;
  }, [stopLoop]);

  const downloadZip = useCallback(async () => {
    if (!audioBufferRef.current || slices.length === 0) return;
    const ctx = getCtx();
    setStatus('Packaging zip…');
    setStatusActive(true);
    setProgress(5);

    const zip = new JSZip();
    for (let i = 0; i < slices.length; i++) {
      const slice = slices[i];
      const buf = sliceToAudioBuffer(audioBufferRef.current, slice, ctx);
      zip.file(slice.name, bufferToWav(buf));
      setProgress(5 + 85 * ((i + 1) / slices.length));
    }

    const blob = await zip.generateAsync({ type: 'blob' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'slicelab_samples.zip';
    a.click();
    URL.revokeObjectURL(url);
    setProgress(100);
    setTimeout(() => setProgress(0), 800);
    setStatus(`Downloaded ${slices.length} samples as zip`);
    setStatusActive(false);
  }, [slices, getCtx]);

  const clear = useCallback(() => {
    stopPlayback();
    audioBufferRef.current = null;
    setAudioInfo(null);
    setSlices([]);
    setStatus('Ready — drop a file to begin');
    setStatusActive(false);
    setProgress(0);
  }, [stopLoop, stopPlayback]);

  return {
    audioBuffer: audioBufferRef,
    audioInfo,
    slices,
    playingIndex,
    loopPlaying,
    loopPlayheadStep,
    waveformPlayheadSec,
    waveformHighlightSec,
    status,
    statusActive,
    progress,
    isLoading,
    loadFile,
    analyze,
    playSlice,
    playFullSource,
    playLoop,
    downloadLoopWav,
    stopLoop,
    stopPlayback,
    downloadZip,
    clear,
  };
}
