'use client';

import { useRef, useState, useCallback, useEffect } from 'react';
import JSZip from 'jszip';
import type {
  Slice,
  DetectionSettings,
  FadeSettings,
  NamingSettings,
  AudioInfo,
  TimeSignature,
  StepsPerBar,
} from '../types';
import {
  detectSlices,
  slicesFromManualCuts,
  type ManualSliceRegion,
  sliceToAudioBuffer,
  buildLayeredDrumPatternBuffer,
  bufferToWav,
  getLoopStepLayout,
  samplePositionToLoopStep,
} from '../lib/audio';
import { useProjectOptional } from '../context/ProjectContext';
import { triggerBlobDownload } from '../lib/projectFolder';

export function useAudioEngine() {
  const project = useProjectOptional();
  const audioCtxRef = useRef<AudioContext | null>(null);
  const currentSourceRef = useRef<AudioBufferSourceNode | null>(null);
  const loopSourceRef = useRef<AudioBufferSourceNode | null>(null);
  const audioBufferRef = useRef<AudioBuffer | null>(null);

  const [audioInfo, setAudioInfo] = useState<AudioInfo | null>(null);
  const [slices, setSlices] = useState<Slice[]>([]);
  /** Interior cut times (seconds) for manual marker mode. */
  const [manualCutTimes, setManualCutTimes] = useState<number[]>([]);
  const manualCutTimesRef = useRef<number[]>([]);
  manualCutTimesRef.current = manualCutTimes;

  /** Export window: first slice starts at startSec; last slice ends at endSec (full file by default). */
  const [manualRegionStartSec, setManualRegionStartSec] = useState(0);
  const [manualRegionEndSec, setManualRegionEndSec] = useState(0);
  const manualRegionStartRef = useRef(0);
  const manualRegionEndRef = useRef(0);
  manualRegionStartRef.current = manualRegionStartSec;
  manualRegionEndRef.current = manualRegionEndSec;

  const MIN_MANUAL_REGION_SPAN = 0.05;
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
    if (!audioCtxRef.current && typeof window !== 'undefined') {
      const Ctor =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (Ctor) {
        audioCtxRef.current = new Ctor();
      }
    }
    if (!audioCtxRef.current) {
      audioCtxRef.current = new AudioContext();
    }
    return audioCtxRef.current;
  }, []);

  /** Shared AudioContext; resumes if suspended (required after user gesture for Grain Mode, etc.). */
  const ensureAudioContext = useCallback(async () => {
    const ctx = getCtx();
    if (ctx.state === 'suspended') await ctx.resume();
    return ctx;
  }, [getCtx]);

  const loadFile = useCallback(async (file: File) => {
    setIsLoading(true);
    setStatus(`Loading ${file.name}…`);
    setStatusActive(true);
    setProgress(20);

    try {
      const ctx = getCtx();
      // Safari: start unlock in the same synchronous turn as drop/picker; await again before decode.
      if (ctx.state === 'suspended') void ctx.resume();
      if (ctx.state === 'suspended') await ctx.resume();

      const arr = await file.arrayBuffer();
      if (ctx.state === 'suspended') await ctx.resume();

      const buffer = await ctx.decodeAudioData(arr);
      audioBufferRef.current = buffer;

      setAudioInfo({
        duration: buffer.duration,
        sampleRate: buffer.sampleRate,
        channels: buffer.numberOfChannels,
        fileName: file.name.length > 32 ? file.name.slice(0, 30) + '…' : file.name,
      });
      setSlices([]);
      setManualCutTimes([]);
      setManualRegionStartSec(0);
      setManualRegionEndSec(buffer.duration);
      setProgress(100);
      setTimeout(() => setProgress(0), 500);
      setStatus(`Loaded · ${buffer.duration.toFixed(2)}s · ${buffer.sampleRate}Hz · ${buffer.numberOfChannels}ch`);
      setStatusActive(false);
      if (project?.hasProjectFolder) {
        void project.onSourceFileLoaded(file);
      }
    } catch {
      setStatus('Error decoding audio — try another format');
      setStatusActive(false);
    } finally {
      setIsLoading(false);
    }
  }, [getCtx, project]);

  const addManualCut = useCallback((timeSec: number) => {
    const buf = audioBufferRef.current;
    if (!buf) return;
    const dur = buf.duration;
    const rs = manualRegionStartRef.current;
    const re = manualRegionEndRef.current;
    const span = re - rs;
    const pad = Math.max(0.008, Math.min(0.04, span * 0.02));
    const t = Math.max(rs + pad, Math.min(re - pad, timeSec));
    setManualCutTimes(prev => {
      const merged = [...prev, t].sort((a, b) => a - b);
      const out: number[] = [];
      for (const x of merged) {
        if (out.length === 0 || x - out[out.length - 1] >= 0.022) out.push(x);
      }
      return out;
    });
  }, []);

  /** Remove the single cut closest to `timeSec` if within reach (waveform Shift+click). */
  const removeManualCutNear = useCallback((timeSec: number) => {
    const buf = audioBufferRef.current;
    if (!buf) return;
    setManualCutTimes(prev => {
      if (prev.length === 0) return prev;
      let bestI = -1;
      let bestD = Infinity;
      for (let i = 0; i < prev.length; i++) {
        const d = Math.abs(prev[i] - timeSec);
        if (d < bestD) {
          bestD = d;
          bestI = i;
        }
      }
      const maxReach = Math.max(0.055, buf.duration * 0.014);
      if (bestI < 0 || bestD > maxReach) return prev;
      return prev.filter((_, i) => i !== bestI);
    });
  }, []);

  const removeManualCutAtIndex = useCallback((index: number) => {
    setManualCutTimes(prev => prev.filter((_, i) => i !== index));
  }, []);

  const clearManualCuts = useCallback(() => {
    setManualCutTimes([]);
  }, []);

  const setManualRegionStart = useCallback((startSec: number) => {
    const buf = audioBufferRef.current;
    if (!buf) return;
    const dur = buf.duration;
    const re = manualRegionEndRef.current;
    let rs = Math.max(0, Math.min(startSec, dur));
    rs = Math.min(rs, re - MIN_MANUAL_REGION_SPAN);
    setManualRegionStartSec(rs);
    setManualCutTimes(prev =>
      prev.filter(c => c > rs + 0.015 && c < re - 0.015),
    );
  }, []);

  const setManualRegionEnd = useCallback((endSec: number) => {
    const buf = audioBufferRef.current;
    if (!buf) return;
    const dur = buf.duration;
    const rs = manualRegionStartRef.current;
    let re = Math.max(0, Math.min(endSec, dur));
    re = Math.max(re, rs + MIN_MANUAL_REGION_SPAN);
    setManualRegionEndSec(re);
    setManualCutTimes(prev =>
      prev.filter(c => c > rs + 0.015 && c < re - 0.015),
    );
  }, []);

  const analyze = useCallback((
    detection: DetectionSettings,
    fade: FadeSettings,
    naming: NamingSettings,
  ) => {
    if (!audioBufferRef.current) return;
    setStatus(detection.method === 'manual' ? 'Applying slices…' : 'Analyzing…');
    setStatusActive(true);
    setProgress(30);

    setTimeout(() => {
      try {
        const buf = audioBufferRef.current!;
        let result: Slice[];
        if (detection.method === 'manual') {
          const cuts = manualCutTimesRef.current;
          const region: ManualSliceRegion = {
            startSec: manualRegionStartRef.current,
            endSec: manualRegionEndRef.current,
          };
          result = slicesFromManualCuts(buf, cuts, fade, naming, region);
          if (result.length === 0) {
            setStatus('Could not build slices — widen the slice region or adjust cuts');
            setStatusActive(false);
            setProgress(0);
            return;
          }
          setManualRegionStartSec(result[0].start);
          setManualRegionEndSec(result[result.length - 1].end);
          setManualCutTimes(result.slice(1).map(s => s.start));
        } else {
          result = detectSlices(buf, detection, fade, naming);
        }
        setSlices(result);
        setProgress(100);
        setTimeout(() => setProgress(0), 500);
        setStatus(
          detection.method === 'manual'
            ? `${result.length} slices from manual markers — preview or download zip`
            : `${result.length} slices detected — click to preview, download zip when ready`,
        );
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

  const playLoop = useCallback(async (
    layers: (number | null)[][],
    layerMutes: boolean[],
    layerPitchSemitones: number[],
    bpm: number,
    stepsPerBar: StepsPerBar,
    numBars: number,
    swingPercent: number,
    timeSignature: TimeSignature,
    trimSamplesToStep = true,
  ) => {
    if (!audioBufferRef.current) return;
    const ctx = getCtx();
    try {
      if (ctx.state === 'suspended') await ctx.resume();
    } catch {
      /* Safari may reject resume without a user gesture */
    }

    if (currentSourceRef.current) {
      try { currentSourceRef.current.stop(); } catch { /* ok */ }
      currentSourceRef.current = null;
    }
    setPlayingIndex(null);

    stopLoop();

    const sr = audioBufferRef.current.sampleRate;
    const layout = getLoopStepLayout(bpm, stepsPerBar, numBars, swingPercent, timeSignature, sr);

    const bar = buildLayeredDrumPatternBuffer(
      audioBufferRef.current,
      slices,
      layers,
      layerMutes,
      bpm,
      stepsPerBar,
      numBars,
      swingPercent,
      timeSignature,
      ctx,
      trimSamplesToStep,
      layerPitchSemitones,
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

  const downloadLoopWav = useCallback(async (
    layers: (number | null)[][],
    layerMutes: boolean[],
    layerPitchSemitones: number[],
    bpm: number,
    stepsPerBar: StepsPerBar,
    numBars: number,
    swingPercent: number,
    timeSignature: TimeSignature,
    trimSamplesToStep = true,
  ) => {
    if (!audioBufferRef.current) return;
    const ctx = getCtx();
    try {
      if (ctx.state === 'suspended') await ctx.resume();
    } catch {
      /* ok */
    }

    const bar = buildLayeredDrumPatternBuffer(
      audioBufferRef.current,
      slices,
      layers,
      layerMutes,
      bpm,
      stepsPerBar,
      numBars,
      swingPercent,
      timeSignature,
      ctx,
      trimSamplesToStep,
      layerPitchSemitones,
    );
    if (!bar || bar.length === 0) return;

    const wav = bufferToWav(bar);
    const blob = new Blob([wav], { type: 'audio/wav' });
    let saved = false;
    if (project?.hasProjectFolder) {
      saved = await project.trySaveLoop(blob);
    }
    if (!saved) {
      triggerBlobDownload(blob, 'slicelab_loop.wav');
    }
    setStatus(
      saved ? 'Saved loop WAV to project · exports/loops/' : 'Downloaded loop as slicelab_loop.wav',
    );
    setStatusActive(false);
  }, [getCtx, slices, project]);

  const playSlice = useCallback((slice: Slice) => {
    if (!audioBufferRef.current) return;
    const mainBuf = audioBufferRef.current;
    const ctx = getCtx();

    stopLoop();

    if (currentSourceRef.current) {
      try { currentSourceRef.current.stop(); } catch { /* already stopped */ }
    }

    void (async () => {
      try {
        if (ctx.state === 'suspended') await ctx.resume();
      } catch {
        /* Safari: resume must follow a user gesture — try clicking play again */
      }

      const buf = sliceToAudioBuffer(mainBuf, slice, ctx);
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
    })();
  }, [getCtx, stopLoop]);

  /** Play the entire loaded file (not slice extractions). Uses playingIndex -1 while active. */
  const playFullSource = useCallback(() => {
    if (!audioBufferRef.current) return;
    const mainBuf = audioBufferRef.current;
    const ctx = getCtx();

    stopLoop();

    if (currentSourceRef.current) {
      try { currentSourceRef.current.stop(); } catch { /* already stopped */ }
    }

    void (async () => {
      try {
        if (ctx.state === 'suspended') await ctx.resume();
      } catch {
        /* ok */
      }

      const src = ctx.createBufferSource();
      src.buffer = mainBuf;
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
    })();
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

  /** One-shot preview of an arbitrary buffer (e.g. oneshot composite). Does not loop. */
  const playOneshotPreview = useCallback(
    (buffer: AudioBuffer) => {
      const ctx = getCtx();
      void (async () => {
        try {
          if (ctx.state === 'suspended') await ctx.resume();
        } catch {
          /* ok */
        }
        stopLoop();
        if (currentSourceRef.current) {
          try {
            currentSourceRef.current.stop();
          } catch {
            /* ok */
          }
        }
        setPlayingIndex(null);
        setWaveformPlayheadSec(null);
        setWaveformHighlightSec(null);
        previewStartRef.current = null;
        previewSliceRef.current = null;

        const src = ctx.createBufferSource();
        src.buffer = buffer;
        src.connect(ctx.destination);
        src.start(ctx.currentTime);
        src.onended = () => {
          if (currentSourceRef.current === src) currentSourceRef.current = null;
        };
        currentSourceRef.current = src;
      })();
    },
    [getCtx, stopLoop],
  );

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
    let saved = false;
    if (project?.hasProjectFolder) {
      saved = await project.trySaveZip(blob);
    }
    if (!saved) {
      triggerBlobDownload(blob, 'slicelab_samples.zip');
    }
    setProgress(100);
    setTimeout(() => setProgress(0), 800);
    setStatus(
      saved
        ? `Saved ${slices.length} samples zip to project · exports/samples/`
        : `Downloaded ${slices.length} samples as zip`,
    );
    setStatusActive(false);
  }, [slices, getCtx, project]);

  const clear = useCallback(() => {
    stopPlayback();
    audioBufferRef.current = null;
    setAudioInfo(null);
    setSlices([]);
    setManualCutTimes([]);
    setManualRegionStartSec(0);
    setManualRegionEndSec(0);
    setStatus('Ready — drop a file to begin');
    setStatusActive(false);
    setProgress(0);
  }, [stopLoop, stopPlayback]);

  /** Remove applied slices but keep the loaded file (e.g. undo Apply in manual mode). Resets manual draft to full file, no cuts. */
  const clearAppliedSlices = useCallback(() => {
    stopPlayback();
    setSlices([]);
    setManualCutTimes([]);
    const buf = audioBufferRef.current;
    if (buf) {
      setManualRegionStartSec(0);
      setManualRegionEndSec(buf.duration);
      setStatus('Slices cleared — adjust region or markers on the waveform, then Apply again');
    } else {
      setStatus('Ready — drop a file to begin');
    }
    setStatusActive(false);
  }, [stopPlayback]);

  return {
    audioBuffer: audioBufferRef,
    audioInfo,
    slices,
    manualCutTimes,
    manualRegionStartSec,
    manualRegionEndSec,
    setManualRegionStart,
    setManualRegionEnd,
    addManualCut,
    removeManualCutNear,
    removeManualCutAtIndex,
    clearManualCuts,
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
    playOneshotPreview,
    downloadZip,
    clear,
    clearAppliedSlices,
    ensureAudioContext,
  };
}

