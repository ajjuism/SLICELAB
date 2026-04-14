import type {
  DetectionSettings,
  FadeSettings,
  NamingSettings,
  Slice,
  StepsPerBar,
  TimeSignature,
} from '../types';

export function waveCssVar(name: string, fallback: string): string {
  if (typeof document === 'undefined') return fallback;
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

export function fmtTime(s: number): string {
  const m = Math.floor(s / 60);
  const sec = (s % 60).toFixed(2).padStart(5, '0');
  return m > 0 ? `${m}:${sec}` : `${Number(s.toFixed(2))}s`;
}

export function nameSlice(i: number, settings: NamingSettings): string {
  const { scheme, prefix } = settings;
  const p = prefix || 'smpl';
  if (scheme === 'index') return `${p}_${String(i + 1).padStart(3, '0')}`;
  if (scheme === 'hex') return `${p}_${(Date.now() + i).toString(16).toUpperCase().slice(-8)}`;
  return `${p}_${i + 1}`;
}

export function detectSlices(
  audioBuffer: AudioBuffer,
  detection: DetectionSettings,
  fade: FadeSettings,
  naming: NamingSettings,
): Slice[] {
  const { method } = detection;
  const sr = audioBuffer.sampleRate;
  const data = audioBuffer.getChannelData(0);
  const duration = audioBuffer.duration;
  const markers: number[] = [];

  if (method === 'manual') {
    return [];
  }

  if (method === 'equal') {
    const n = Math.round(detection.numSlices);
    for (let i = 0; i < n; i++) markers.push((i * duration) / n);
    markers.push(duration);

  } else if (method === 'beat') {
    const div = parseInt(detection.beatDiv);
    const sliceDur = (60 / detection.bpm) / div * 4;
    let t = 0;
    while (t < duration) { markers.push(t); t += sliceDur; }
    markers.push(duration);

  } else if (method === 'rms') {
    const thresh = Math.pow(10, detection.rmsThresh / 20);
    const hold = Math.round((detection.holdTime * sr) / 1000);
    const blockSize = Math.round(sr * 0.01);
    let active = false;
    let holdCounter = 0;
    markers.push(0);
    for (let b = 0; b < Math.floor(data.length / blockSize); b++) {
      let rms = 0;
      for (let i = 0; i < blockSize; i++) {
        const s = data[b * blockSize + i] || 0;
        rms += s * s;
      }
      rms = Math.sqrt(rms / blockSize);
      if (rms > thresh) {
        if (!active) {
          const t = (b * blockSize) / sr;
          if (t - markers[markers.length - 1] > 0.05) markers.push(t);
          active = true;
          holdCounter = hold;
        } else {
          holdCounter = hold;
        }
      } else if (active) {
        holdCounter--;
        if (holdCounter <= 0) active = false;
      }
    }
    markers.push(duration);

  } else {
    // transient
    const sens = (100 - detection.sensitivity) / 100;
    const minGapSamples = Math.round((detection.minGap * sr) / 1000);
    const blockSize = Math.round(sr * 0.005);
    let prev = 0;
    let lastMarker = 0;
    markers.push(0);
    for (let b = 1; b < Math.floor(data.length / blockSize); b++) {
      let energy = 0;
      for (let i = 0; i < blockSize; i++) {
        const s = data[b * blockSize + i] || 0;
        energy += s * s;
      }
      energy /= blockSize;
      const diff = energy - prev;
      if (diff > sens * 0.01 && b * blockSize - lastMarker > minGapSamples) {
        markers.push((b * blockSize) / sr);
        lastMarker = b * blockSize;
      }
      prev = energy * 0.7 + prev * 0.3;
    }
    markers.push(duration);
  }

  const fi = fade.fadeIn / 1000;
  const fo = fade.fadeOut / 1000;
  const result: Slice[] = [];

  for (let i = 0; i < markers.length - 1; i++) {
    const start = markers[i];
    const end = markers[i + 1];
    if (end - start > 0.01) {
      result.push({
        index: result.length,
        name: nameSlice(result.length, naming) + '.wav',
        start,
        end,
        dur: end - start,
        startSample: Math.round(start * sr),
        endSample: Math.round(end * sr),
        fadeIn: fi,
        fadeOut: fo,
      });
    }
  }
  return result;
}

const MIN_MANUAL_SLICE_SEC = 0.012;
const MIN_MANUAL_CUT_GAP_SEC = 0.022;

export interface ManualSliceRegion {
  /** First exported slice starts here (seconds). Default 0. */
  startSec: number;
  /** Last exported slice ends here (seconds). Default buffer duration. */
  endSec: number;
}

/**
 * Build slices from manual cut times (seconds) and an optional export region.
 * Cuts are internal boundaries between consecutive slices: first slice is [regionStart, t0], … last ends at regionEnd.
 * Empty interior cuts → one slice [regionStart, regionEnd].
 */
export function slicesFromManualCuts(
  audioBuffer: AudioBuffer,
  cutTimesSec: number[],
  fade: FadeSettings,
  naming: NamingSettings,
  region?: ManualSliceRegion | null,
): Slice[] {
  const duration = audioBuffer.duration;
  const sr = audioBuffer.sampleRate;
  const fi = fade.fadeIn / 1000;
  const fo = fade.fadeOut / 1000;

  let regionStart = region?.startSec ?? 0;
  let regionEnd = region?.endSec ?? duration;
  regionStart = Math.max(0, Math.min(regionStart, duration));
  regionEnd = Math.max(0, Math.min(regionEnd, duration));
  if (regionEnd <= regionStart) {
    return [];
  }
  const span = regionEnd - regionStart;
  const pad = Math.min(0.001 * span, 0.02);
  if (span < MIN_MANUAL_SLICE_SEC * 1.5) {
    return [];
  }

  const sorted = [...cutTimesSec]
    .filter(t => t > regionStart + pad && t < regionEnd - pad)
    .sort((a, b) => a - b);

  const deduped: number[] = [];
  for (const t of sorted) {
    if (deduped.length === 0 || t - deduped[deduped.length - 1] >= MIN_MANUAL_CUT_GAP_SEC) {
      deduped.push(t);
    }
  }

  const markers = [regionStart, ...deduped, regionEnd];
  const result: Slice[] = [];

  for (let i = 0; i < markers.length - 1; i++) {
    const start = markers[i];
    const end = markers[i + 1];
    if (end - start >= MIN_MANUAL_SLICE_SEC) {
      result.push({
        index: result.length,
        name: nameSlice(result.length, naming) + '.wav',
        start,
        end,
        dur: end - start,
        startSample: Math.round(start * sr),
        endSample: Math.round(end * sr),
        fadeIn: fi,
        fadeOut: fo,
      });
    }
  }
  return result;
}

export function sliceToAudioBuffer(
  audioBuffer: AudioBuffer,
  slice: Slice,
  audioCtx: AudioContext,
): AudioBuffer {
  const sr = audioBuffer.sampleRate;
  const numCh = audioBuffer.numberOfChannels;
  const len = slice.endSample - slice.startSample;
  const buf = audioCtx.createBuffer(numCh, len, sr);

  for (let ch = 0; ch < numCh; ch++) {
    const src = audioBuffer.getChannelData(ch).subarray(slice.startSample, slice.endSample);
    const dst = buf.getChannelData(ch);
    dst.set(src);
    const fiSamples = Math.min(Math.round(slice.fadeIn * sr), len / 2);
    const foSamples = Math.min(Math.round(slice.fadeOut * sr), len / 2);
    for (let j = 0; j < fiSamples; j++) dst[j] *= j / fiSamples;
    for (let j = 0; j < foSamples; j++) dst[len - 1 - j] *= j / foSamples;
  }
  return buf;
}

/** Concatenate slice buffers in order with optional silent gap between hits (for rhythmic loops). */
export function concatSliceBuffers(
  audioBuffer: AudioBuffer,
  slices: Slice[],
  orderedIndices: number[],
  audioCtx: AudioContext,
  gapMs: number,
): AudioBuffer | null {
  if (orderedIndices.length === 0) return null;
  const parts: AudioBuffer[] = [];
  for (const i of orderedIndices) {
    const slice = slices[i];
    if (!slice) continue;
    parts.push(sliceToAudioBuffer(audioBuffer, slice, audioCtx));
  }
  if (parts.length === 0) return null;

  const sr = audioBuffer.sampleRate;
  const numCh = audioBuffer.numberOfChannels;
  const gapSamples = Math.round((gapMs / 1000) * sr);
  let totalSamples = gapSamples * (parts.length - 1);
  for (const p of parts) totalSamples += p.length;

  const out = audioCtx.createBuffer(numCh, totalSamples, sr);
  let offset = 0;
  for (let p = 0; p < parts.length; p++) {
    const buf = parts[p];
    for (let ch = 0; ch < numCh; ch++) {
      out.getChannelData(ch).set(buf.getChannelData(ch), offset);
    }
    offset += buf.length;
    if (p < parts.length - 1) offset += gapSamples;
  }
  return out;
}

/** Bar length in seconds; BPM = quarter notes per minute. */
export function barDurationSeconds(bpm: number, timeSignature: TimeSignature): number {
  const quarterSec = 60 / Math.max(20, Math.min(300, bpm));
  const [nStr, dStr] = timeSignature.split('/');
  const n = Number(nStr);
  const d = Number(dStr);
  if (d === 4) return n * quarterSec;
  if (d === 8) return n * (quarterSec / 2);
  return 4 * quarterSec;
}

/** Step grid for a pattern (one or more bars). Step length follows stepsPerBar; total length is stepsPerBar × numBars. */
export function getLoopStepLayout(
  bpm: number,
  stepsPerBar: StepsPerBar,
  numBars: number,
  swingPercent: number,
  timeSignature: TimeSignature,
  sampleRate: number,
): { stepSamples: number; totalSamples: number; stepStartSamples: number[]; totalSteps: number } {
  const bars = Math.max(1, Math.min(32, Math.floor(Number(numBars)) || 1));
  const totalSteps = stepsPerBar * bars;
  const barSec = barDurationSeconds(bpm, timeSignature);
  const stepSec = barSec / stepsPerBar;
  const stepSamples = Math.round(stepSec * sampleRate);
  const totalSamples = stepSamples * totalSteps;
  const swing = (Math.max(0, Math.min(100, swingPercent)) / 100) * 0.5 * stepSamples;
  const stepStartSamples = Array.from({ length: totalSteps }, (_, step) =>
    step * stepSamples + (step % 2 === 1 ? Math.round(swing) : 0),
  );
  return { stepSamples, totalSamples, stepStartSamples, totalSteps };
}

/** Map playback position in samples to step index (same grid as loop buffer). */
export function samplePositionToLoopStep(
  samplePos: number,
  stepStartSamples: number[],
  totalSamples: number,
): number {
  const n = stepStartSamples.length;
  if (n === 0 || totalSamples <= 0) return 0;
  let sp = Math.floor(samplePos) % totalSamples;
  if (sp < 0) sp += totalSamples;
  for (let s = n - 1; s >= 0; s--) {
    if (stepStartSamples[s] <= sp) return s;
  }
  return 0;
}

/** Pitch shift in semitones → playback rate (sampler-style: pitch + tempo). */
export function semitonesToPlaybackRate(semitones: number): number {
  return Math.pow(2, semitones / 12);
}

function sampleChannelLinear(data: Float32Array, srcPos: number): number {
  const n = data.length;
  if (n === 0) return 0;
  if (srcPos >= n - 1) return data[n - 1];
  if (srcPos <= 0) return data[0];
  const i0 = Math.floor(srcPos);
  const frac = srcPos - i0;
  const a = data[i0];
  const b = data[Math.min(i0 + 1, n - 1)];
  return a * (1 - frac) + b * frac;
}

/**
 * One or more bars (meter from time signature), multiple layers summed. Steps divide each bar evenly; odd-index steps can be swung.
 * Layers are mixed additively (layering). Muted layers are skipped.
 *
 * @param numBars — How many bars the pattern spans (layer length = stepsPerBar × numBars).
 * @param trimSamplesToStep — When true (default), each hit only plays the first ~step worth of the slice. When false, the slice plays from the step until the slice ends or the current bar ends (whichever comes first).
 * @param layerPitchSemitones — Per-layer pitch in semitones (−∞…∞); 0 = original. Same rate for every hit on that layer.
 */
export function buildLayeredDrumPatternBuffer(
  audioBuffer: AudioBuffer,
  slices: Slice[],
  layers: (number | null)[][],
  layerMutes: boolean[],
  bpm: number,
  stepsPerBar: StepsPerBar,
  numBars: number,
  swingPercent: number,
  timeSignature: TimeSignature,
  audioCtx: AudioContext,
  trimSamplesToStep = true,
  layerPitchSemitones?: number[],
): AudioBuffer | null {
  if (layers.length === 0) return null;
  const mutes = [...layerMutes];
  while (mutes.length < layers.length) mutes.push(false);
  const pitches = layerPitchSemitones ? [...layerPitchSemitones] : [];
  while (pitches.length < layers.length) pitches.push(0);

  const sr = audioBuffer.sampleRate;
  const numCh = audioBuffer.numberOfChannels;
  const { stepSamples, totalSamples, stepStartSamples, totalSteps } = getLoopStepLayout(
    bpm,
    stepsPerBar,
    numBars,
    swingPercent,
    timeSignature,
    sr,
  );
  const n = totalSteps;
  for (const layer of layers) {
    if (layer.length !== n) return null;
  }
  const stepStartSample = (step: number) => stepStartSamples[step];

  const out = audioCtx.createBuffer(numCh, totalSamples, sr);
  const chOut = Array.from({ length: numCh }, (_, ch) => out.getChannelData(ch));

  const fadeEnd = Math.min(Math.round(0.003 * sr), Math.floor(stepSamples / 4));

  for (let L = 0; L < layers.length; L++) {
    if (mutes[L]) continue;
    const pattern = layers[L];
    const pitchSemis = pitches[L] ?? 0;
    const rate = semitonesToPlaybackRate(pitchSemis);
    if (!Number.isFinite(rate) || rate <= 1e-9) continue;

    for (let step = 0; step < n; step++) {
      const idx = pattern[step];
      if (idx === null || idx === undefined) continue;
      const slice = slices[idx];
      if (!slice) continue;

      const full = sliceToAudioBuffer(audioBuffer, slice, audioCtx);
      const offset = stepStartSample(step);
      if (offset >= totalSamples) continue;

      const barEndStep = Math.min((Math.floor(step / stepsPerBar) + 1) * stepsPerBar, n);
      const barEndSample = barEndStep >= n ? totalSamples : stepStartSamples[barEndStep]!;
      const maxStepWindow = trimSamplesToStep
        ? Math.min(stepSamples, totalSamples - offset)
        : barEndSample - offset;
      const maxOutFromSource = Math.max(1, Math.floor((full.length - 1) / rate) + 1);
      const copyLen = Math.min(maxOutFromSource, maxStepWindow);
      if (copyLen <= 0) continue;

      const fadeTail = copyLen < maxOutFromSource && copyLen >= fadeEnd;

      for (let j = 0; j < copyLen; j++) {
        const outIdx = offset + j;
        if (outIdx >= totalSamples) break;
        const srcPos = j * rate;
        if (srcPos > full.length - 1) break;
        for (let ch = 0; ch < numCh; ch++) {
          const src = full.getChannelData(ch);
          let v = sampleChannelLinear(src, srcPos);
          if (fadeTail && j >= copyLen - fadeEnd) {
            const t = (copyLen - 1 - j) / fadeEnd;
            v *= Math.max(0, Math.min(1, t));
          }
          chOut[ch][outIdx] += v;
        }
      }
    }
  }

  let peak = 0;
  for (let ch = 0; ch < numCh; ch++) {
    const d = chOut[ch];
    for (let i = 0; i < totalSamples; i++) {
      const a = Math.abs(d[i]);
      if (a > peak) peak = a;
    }
  }
  if (peak > 1) {
    const g = 1 / peak;
    for (let ch = 0; ch < numCh; ch++) {
      const d = chOut[ch];
      for (let i = 0; i < totalSamples; i++) d[i] *= g;
    }
  }

  return out;
}

/** @deprecated Use buildLayeredDrumPatternBuffer with one layer */
export function buildDrumPatternBuffer(
  audioBuffer: AudioBuffer,
  slices: Slice[],
  stepSliceIndex: (number | null)[],
  bpm: number,
  stepsPerBar: StepsPerBar,
  audioCtx: AudioContext,
): AudioBuffer | null {
  return buildLayeredDrumPatternBuffer(
    audioBuffer,
    slices,
    [stepSliceIndex],
    [false],
    bpm,
    stepsPerBar,
    1,
    0,
    '4/4',
    audioCtx,
    true,
    [0],
  );
}

export function bufferToWav(buffer: AudioBuffer): ArrayBuffer {
  const numCh = buffer.numberOfChannels;
  const sr = buffer.sampleRate;
  const len = buffer.length;
  const wavBuf = new ArrayBuffer(44 + len * numCh * 2);
  const view = new DataView(wavBuf);

  const write = (off: number, str: string) => {
    for (let i = 0; i < str.length; i++) view.setUint8(off + i, str.charCodeAt(i));
  };

  write(0, 'RIFF');
  view.setUint32(4, 36 + len * numCh * 2, true);
  write(8, 'WAVE');
  write(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, numCh, true);
  view.setUint32(24, sr, true);
  view.setUint32(28, sr * numCh * 2, true);
  view.setUint16(32, numCh * 2, true);
  view.setUint16(34, 16, true);
  write(36, 'data');
  view.setUint32(40, len * numCh * 2, true);

  let off = 44;
  for (let i = 0; i < len; i++) {
    for (let ch = 0; ch < numCh; ch++) {
      const s = Math.max(-1, Math.min(1, buffer.getChannelData(ch)[i]));
      view.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7fff, true);
      off += 2;
    }
  }
  return wavBuf;
}

export interface WaveformPlaybackOverlay {
  /** Seconds in the file; vertical playhead. Null = hidden. */
  playheadSec: number | null;
  /** Highlight [start, end] in seconds (e.g. active slice); dims outside. Null = no highlight. */
  highlightBetweenSec: { start: number; end: number } | null;
}

export function drawWaveform(
  canvas: HTMLCanvasElement,
  audioBuffer: AudioBuffer | null,
  markers: number[],
  overlay?: WaveformPlaybackOverlay | null,
  /** Manual mode: draw region bounds (S/E) separately; `markers` are interior cuts only. */
  manualRegionSec?: { start: number; end: number } | null,
): void {
  const dpr = window.devicePixelRatio || 1;
  canvas.width = canvas.offsetWidth * dpr;
  canvas.height = canvas.offsetHeight * dpr;
  const ctx = canvas.getContext('2d')!;
  ctx.scale(dpr, dpr);
  const W = canvas.offsetWidth;
  const H = canvas.offsetHeight;

  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = waveCssVar('--wave-canvas-bg', '#ffffff');
  ctx.fillRect(0, 0, W, H);

  if (!audioBuffer) {
    ctx.fillStyle = waveCssVar('--wave-empty-text', '#cccccc');
    ctx.font = '11px IBM Plex Mono';
    ctx.fillText('no audio loaded', W / 2 - 55, H / 2);
    return;
  }

  const dur = audioBuffer.duration;
  const data = audioBuffer.getChannelData(0);
  const step = Math.ceil(data.length / W);

  ctx.strokeStyle = waveCssVar('--wave-midline', '#e0deda');
  ctx.lineWidth = 0.5;
  ctx.beginPath();
  ctx.moveTo(0, H / 2);
  ctx.lineTo(W, H / 2);
  ctx.stroke();

  ctx.strokeStyle = waveCssVar('--wave-line', '#a09e99');
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let x = 0; x < W; x++) {
    let min = 1, max = -1;
    for (let i = 0; i < step; i++) {
      const s = data[x * step + i] || 0;
      if (s < min) min = s;
      if (s > max) max = s;
    }
    ctx.moveTo(x, (H / 2) * (1 + min));
    ctx.lineTo(x, (H / 2) * (1 + max));
  }
  ctx.stroke();

  if (overlay?.highlightBetweenSec && dur > 0) {
    const { start, end } = overlay.highlightBetweenSec;
    const x0 = Math.max(0, Math.min(W, (start / dur) * W));
    const x1 = Math.max(0, Math.min(W, (end / dur) * W));
    ctx.fillStyle = waveCssVar('--wave-dim', 'rgba(18, 21, 26, 0.1)');
    ctx.fillRect(0, 0, x0, H);
    ctx.fillRect(x1, 0, W - x1, H);
  }

  const markerLine = waveCssVar('--wave-marker-line', 'rgba(160, 158, 153, 0.42)');
  const markerLabel = waveCssVar('--wave-marker-label', '#8a8883');

  if (manualRegionSec && dur > 0) {
    const { start: rs, end: re } = manualRegionSec;
    const xStart = Math.max(0, Math.min(W, (rs / dur) * W));
    const xEnd = Math.max(0, Math.min(W, (re / dur) * W));
    ctx.font = '9px IBM Plex Mono';

    ctx.strokeStyle = waveCssVar('--wave-region-start', 'rgba(112, 110, 105, 0.72)');
    ctx.lineWidth = 1.35;
    ctx.beginPath();
    ctx.moveTo(xStart, 0);
    ctx.lineTo(xStart, H);
    ctx.stroke();
    ctx.fillStyle = markerLabel;
    ctx.fillText('S', xStart + 2, 11);

    ctx.strokeStyle = waveCssVar('--wave-region-end-stroke', 'rgba(72, 98, 122, 0.78)');
    ctx.lineWidth = 1.35;
    ctx.beginPath();
    ctx.moveTo(xEnd, 0);
    ctx.lineTo(xEnd, H);
    ctx.stroke();
    ctx.fillStyle = waveCssVar('--wave-region-end-fill', 'rgba(72, 98, 122, 0.95)');
    ctx.fillText('E', xEnd + 2, 11);
  }

  markers.forEach((m, i) => {
    const x = (m / dur) * W;
    ctx.strokeStyle = markerLine;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, H);
    ctx.stroke();
    ctx.fillStyle = markerLabel;
    ctx.font = '9px IBM Plex Mono';
    ctx.fillText(String(i + 1), x + 2, 11);
  });

  if (overlay?.playheadSec != null && dur > 0) {
    const px = Math.max(0, Math.min(W, (overlay.playheadSec / dur) * W));
    ctx.strokeStyle = waveCssVar('--wave-playhead', 'rgba(18, 21, 26, 0.85)');
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(px, 0);
    ctx.lineTo(px, H);
    ctx.stroke();
  }
}

/** `prominent` — Oneshot previews: filled track, midline, thicker stroke (reads theme CSS vars). */
export type MiniWaveVisualStyle = 'default' | 'prominent';

export function drawMiniWave(
  canvas: HTMLCanvasElement,
  audioBuffer: AudioBuffer,
  startSample: number,
  endSample: number,
  visual: MiniWaveVisualStyle = 'default',
): void {
  const W = canvas.offsetWidth || 140;
  const H = canvas.offsetHeight || 32;
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, W, H);

  const prominent = visual === 'prominent';
  if (prominent) {
    ctx.fillStyle = waveCssVar('--bg', '#f4f6f9');
    ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = waveCssVar('--wave-oneshot-mid', 'rgba(18, 21, 26, 0.12)');
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, H / 2);
    ctx.lineTo(W, H / 2);
    ctx.stroke();
  }

  const data = audioBuffer.getChannelData(0);
  const len = endSample - startSample;
  ctx.strokeStyle = prominent
    ? waveCssVar('--wave-oneshot-stroke', '#6e7788')
    : waveCssVar('--wave-mini-stroke', '#5c6470');
  ctx.lineWidth = 1;
  ctx.lineCap = 'butt';
  if (len <= 0) {
    ctx.beginPath();
    ctx.moveTo(0, H / 2);
    ctx.lineTo(W, H / 2);
    ctx.stroke();
    return;
  }
  /** Bucket indices [lo, hi) so every sample maps to exactly one column; avoids empty tail columns drawing spurious full-height lines. */
  ctx.beginPath();
  for (let x = 0; x < W; x++) {
    const lo = Math.floor((x * len) / W);
    const hi = Math.floor(((x + 1) * len) / W);
    if (lo >= hi) continue;
    let min = 1,
      max = -1;
    for (let j = lo; j < hi; j++) {
      const idx = startSample + j;
      if (idx >= endSample) break;
      const s = data[idx] ?? 0;
      if (s < min) min = s;
      if (s > max) max = s;
    }
    if (max < min) continue;
    ctx.moveTo(x, (H / 2) * (1 + min));
    ctx.lineTo(x, (H / 2) * (1 + max));
  }
  ctx.stroke();
}
