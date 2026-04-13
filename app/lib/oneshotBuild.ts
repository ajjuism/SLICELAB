import type { Slice } from '../types';
import { sliceToAudioBuffer } from './audio';

/** One contribution to a composite oneshot (non-looping). */
export type OneshotClipParams = {
  sliceIndex: number;
  reverse: boolean;
  /** Linear gain; 1 = unity */
  gain: number;
  /**
   * Where this clip begins on the output timeline (ms from t=0).
   * In **sequence** layout this is ignored — order + gap define placement.
   */
  startOffsetMs: number;
  /** Trim from the start of the extracted slice audio (ms). */
  trimStartMs: number;
  /** Trim from the end of the extracted slice audio (ms). */
  trimEndMs: number;
};

export type OneshotLayout = 'layer' | 'sequence';

function reverseAudioBuffer(buf: AudioBuffer, ctx: BaseAudioContext): AudioBuffer {
  const nCh = buf.numberOfChannels;
  const len = buf.length;
  const sr = buf.sampleRate;
  const out = ctx.createBuffer(nCh, len, sr);
  for (let ch = 0; ch < nCh; ch++) {
    const src = buf.getChannelData(ch);
    const dst = out.getChannelData(ch);
    for (let i = 0; i < len; i++) dst[i] = src[len - 1 - i]!;
  }
  return out;
}

function trimBuffer(buf: AudioBuffer, ctx: BaseAudioContext, trimStartMs: number, trimEndMs: number): AudioBuffer {
  const sr = buf.sampleRate;
  const trimS = Math.max(0, Math.round((trimStartMs / 1000) * sr));
  const trimE = Math.max(0, Math.round((trimEndMs / 1000) * sr));
  const len = Math.max(0, buf.length - trimS - trimE);
  if (len <= 0) {
    return ctx.createBuffer(buf.numberOfChannels, 1, sr);
  }
  const out = ctx.createBuffer(buf.numberOfChannels, len, sr);
  for (let ch = 0; ch < buf.numberOfChannels; ch++) {
    out.getChannelData(ch).set(buf.getChannelData(ch).subarray(trimS, trimS + len));
  }
  return out;
}

function applyGain(buf: AudioBuffer, gain: number): void {
  if (!Number.isFinite(gain) || gain === 1) return;
  const g = Math.max(0, Math.min(4, gain));
  for (let ch = 0; ch < buf.numberOfChannels; ch++) {
    const d = buf.getChannelData(ch);
    for (let i = 0; i < d.length; i++) d[i] *= g;
  }
}

/**
 * One clip through the same path as the composite: extract → trim → reverse → gain.
 * Used for previews and waveforms so visuals match what you hear on Preview / Export.
 */
export function buildOneshotClipProcessedBuffer(
  source: AudioBuffer,
  slices: Slice[],
  p: OneshotClipParams,
  audioCtx: AudioContext,
): AudioBuffer | null {
  const slice = slices[p.sliceIndex];
  if (!slice) return null;
  let buf = sliceToAudioBuffer(source, slice, audioCtx);
  buf = trimBuffer(buf, audioCtx, p.trimStartMs, p.trimEndMs);
  if (p.reverse) buf = reverseAudioBuffer(buf, audioCtx);
  applyGain(buf, p.gain);
  if (buf.length === 0) return null;
  return buf;
}

/**
 * Builds a single-shot buffer from two or more slices: either stacked (layer) or placed end-to-end (sequence).
 * Overlapping regions are summed with hard clipping to ±1.
 */
export function buildOneshotComposite(
  source: AudioBuffer,
  slices: Slice[],
  clipParams: OneshotClipParams[],
  layout: OneshotLayout,
  /** Used when layout === 'sequence': ms between clip starts; negative overlaps prior tail. */
  sequenceGapMs: number,
  audioCtx: AudioContext,
): AudioBuffer | null {
  if (clipParams.length < 2) return null;

  const sr = source.sampleRate;
  const nCh = source.numberOfChannels;

  type Prepared = { buf: AudioBuffer; startSample: number };
  const prepared: Prepared[] = [];

  for (const p of clipParams) {
    const buf = buildOneshotClipProcessedBuffer(source, slices, p, audioCtx);
    if (!buf) continue;

    let startSample = 0;
    if (layout === 'layer') {
      startSample = Math.round(Math.max(0, (p.startOffsetMs / 1000) * sr));
    }
    prepared.push({ buf, startSample });
  }

  if (prepared.length < 2) return null;

  if (layout === 'sequence') {
    const gap = Math.round((sequenceGapMs / 1000) * sr);
    let t = 0;
    for (let i = 0; i < prepared.length; i++) {
      prepared[i]!.startSample = t;
      if (i < prepared.length - 1) {
        const nextT = t + prepared[i]!.buf.length + gap;
        // Keep next clip start ≥ 0 so samples are not written before the buffer (negative starts are fully skipped).
        // Large negative gaps still create overlap via max(0, …) instead of inaudible “silent” clips.
        t = Math.max(0, nextT);
      }
    }
  }

  let maxEnd = 0;
  for (const { buf, startSample } of prepared) {
    maxEnd = Math.max(maxEnd, startSample + buf.length);
  }
  if (maxEnd <= 0) return null;

  const out = audioCtx.createBuffer(nCh, maxEnd, sr);
  const chOut = Array.from({ length: nCh }, (_, ch) => out.getChannelData(ch));

  for (const { buf, startSample } of prepared) {
    for (let ch = 0; ch < nCh; ch++) {
      const src = buf.getChannelData(Math.min(ch, buf.numberOfChannels - 1));
      const dst = chOut[ch]!;
      for (let i = 0; i < src.length; i++) {
        const j = startSample + i;
        if (j >= 0 && j < maxEnd) {
          let v = dst[j]! + src[i]!;
          if (v > 1) v = 1;
          else if (v < -1) v = -1;
          dst[j] = v;
        }
      }
    }
  }

  return out;
}
