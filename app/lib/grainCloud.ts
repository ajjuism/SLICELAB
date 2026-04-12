import type { Slice } from '../types';

export interface GrainCloudParams {
  /** Grains per second (approximate; Poisson spacing). */
  density: number;
  /** Grain length in milliseconds. */
  grainDurationMs: number;
  /** 0–1: focus point along the combined slice timeline (all slices laid end-to-end). */
  position: number;
  /** 0–1: how far grains can drift from the focus point along the timeline. */
  jitter: number;
  /** Max random pitch offset in semitones (±). */
  pitchSpreadSemis: number;
  /** Output level 0–1. */
  mix: number;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function hann(n: number, N: number): number {
  if (N <= 1) return 1;
  return 0.5 * (1 - Math.cos((2 * Math.PI * n) / (N - 1)));
}

function semitonesToRate(semis: number): number {
  return Math.pow(2, semis / 12);
}

/**
 * Pick a grain start (sample index) and length (samples) inside the slice pool.
 */
function pickGrainBounds(
  slices: Slice[],
  sr: number,
  grainDurSamples: number,
  position: number,
  jitter: number,
): { start: number; length: number } | null {
  if (slices.length === 0) return null;
  const totalSec = slices.reduce((a, s) => a + s.dur, 0);
  if (totalSec <= 1e-6) return null;

  let targetSec = position * totalSec;
  targetSec += (Math.random() - 0.5) * jitter * totalSec * 2;
  targetSec = clamp(targetSec, 0, Math.max(0, totalSec - 1e-4));

  let acc = 0;
  for (const s of slices) {
    const sliceEnd = acc + s.dur;
    if (targetSec < sliceEnd - 1e-9) {
      const localSec = targetSec - acc;
      const grainSec = grainDurSamples / sr;
      const maxStartInSlice = Math.max(0, s.dur - grainSec);
      const startInSlice = clamp(localSec - grainSec * 0.5, 0, maxStartInSlice);
      const startSample = s.startSample + Math.floor(startInSlice * sr);
      const end = startSample + grainDurSamples;
      if (end > s.endSample) {
        const adjLen = Math.max(32, s.endSample - startSample);
        return { start: startSample, length: adjLen };
      }
      return { start: startSample, length: grainDurSamples };
    }
    acc = sliceEnd;
  }
  const last = slices[slices.length - 1];
  const startSample = Math.max(
    last.startSample,
    last.endSample - grainDurSamples - 4,
  );
  return { start: startSample, length: Math.min(grainDurSamples, last.endSample - startSample) };
}

/**
 * Copy a windowed segment from `source` into a new AudioBuffer (same rate/channels).
 */
function makeGrainBuffer(
  source: AudioBuffer,
  start: number,
  length: number,
): AudioBuffer | null {
  const sr = source.sampleRate;
  const numCh = source.numberOfChannels;
  const len = Math.max(0, Math.min(length, source.length - start));
  if (len < 16) return null;

  const out = new AudioBuffer({
    length: len,
    numberOfChannels: numCh,
    sampleRate: sr,
  });

  for (let ch = 0; ch < numCh; ch++) {
    const src = source.getChannelData(ch);
    const dst = out.getChannelData(ch);
    for (let i = 0; i < len; i++) {
      const w = hann(i, len);
      dst[i] = (src[start + i] ?? 0) * w;
    }
  }
  return out;
}

export interface GrainCloudHandle {
  start: () => void;
  stop: () => void;
  setParams: (p: Partial<GrainCloudParams>) => void;
  getParams: () => GrainCloudParams;
}

const DEFAULT_PARAMS: GrainCloudParams = {
  density: 11,
  grainDurationMs: 165,
  position: 0.5,
  jitter: 0.55,
  pitchSpreadSemis: 0,
  mix: 0.58,
};

/**
 * Schedules overlapping grains from slice regions of `sourceBuffer` into `masterGain`.
 */
export function createGrainCloud(
  ctx: AudioContext,
  sourceBuffer: AudioBuffer,
  slices: Slice[],
  masterGain: GainNode,
  initialParams?: Partial<GrainCloudParams>,
): GrainCloudHandle {
  let params: GrainCloudParams = { ...DEFAULT_PARAMS, ...initialParams };
  let running = false;
  /** Browser timer id (avoid Node `Timeout` vs `number` mismatch in TS). */
  let timeoutId: number | null = null;

  function scheduleNext() {
    if (!running) return;
    const rate = clamp(params.density, 0.5, 80);
    const delayMs = (-Math.log(Math.random() + 1e-12) / rate) * 1000;
    /** Allow long gaps at low density so grains don’t feel metronomic. */
    timeoutId = window.setTimeout(tick, clamp(delayMs, 4, 1400)) as unknown as number;
  }

  function tick() {
    if (!running) return;
    const sr = sourceBuffer.sampleRate;
    const grainDurMs = clamp(params.grainDurationMs, 12, 520);
    let grainSamples = Math.max(16, Math.floor((grainDurMs / 1000) * sr));

    const bounds = pickGrainBounds(slices, sr, grainSamples, params.position, params.jitter);
    if (!bounds) {
      scheduleNext();
      return;
    }

    grainSamples = Math.min(bounds.length, grainSamples);
    const grainBuf = makeGrainBuffer(sourceBuffer, bounds.start, grainSamples);
    if (!grainBuf) {
      scheduleNext();
      return;
    }

    const spread = params.pitchSpreadSemis;
    /** Bias toward smaller detunes so the cloud stays closer to a tonal “bed”. */
    const u = Math.random() * 2 - 1;
    const detuneSemis = Math.sign(u) * Math.pow(Math.abs(u), 1.15) * spread;
    const playRate = semitonesToRate(detuneSemis);

    const src = ctx.createBufferSource();
    src.buffer = grainBuf;
    src.playbackRate.value = playRate;
    const g = ctx.createGain();
    g.gain.value = params.mix * 0.36;
    const panner = ctx.createStereoPanner();
    panner.pan.value = (Math.random() * 2 - 1) * 0.92;
    src.connect(g);
    g.connect(panner);
    panner.connect(masterGain);

    const t = ctx.currentTime;
    try {
      src.start(t);
      src.stop(t + grainBuf.duration / playRate + 0.02);
    } catch {
      /* ignore */
    }

    scheduleNext();
  }

  return {
    start: () => {
      if (running || slices.length === 0) return;
      running = true;
      masterGain.gain.setValueAtTime(params.mix * 0.58, ctx.currentTime);
      tick();
    },
    stop: () => {
      running = false;
      if (timeoutId != null) {
        clearTimeout(timeoutId);
        timeoutId = null;
      }
      try {
        masterGain.gain.setTargetAtTime(0, ctx.currentTime, 0.05);
      } catch {
        masterGain.gain.value = 0;
      }
    },
    setParams: (p: Partial<GrainCloudParams>) => {
      params = { ...params, ...p };
      if (running) {
        try {
          masterGain.gain.setTargetAtTime(params.mix * 0.58, ctx.currentTime, 0.08);
        } catch {
          masterGain.gain.value = params.mix * 0.58;
        }
      }
    },
    getParams: () => ({ ...params }),
  };
}
