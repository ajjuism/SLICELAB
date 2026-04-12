/**
 * Parallel dry / delay / reverb path after the grain summing bus.
 */

export interface GrainFxState {
  /** 0–900 ms */
  delayTimeMs: number;
  /** 0–85% feedback */
  delayFeedbackPct: number;
  /** 0–100% wet for delay tap */
  delayMixPct: number;
  /** 0–100% wet for reverb */
  reverbMixPct: number;
  /** Rough room size: 0.25–3.5 s impulse length */
  reverbSizeSec: number;
}

const DEFAULT_FX: GrainFxState = {
  delayTimeMs: 380,
  delayFeedbackPct: 52,
  delayMixPct: 48,
  reverbMixPct: 52,
  reverbSizeSec: 2.8,
};

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}

function makeReverbImpulse(ctx: AudioContext, durationSec: number): AudioBuffer {
  const sr = ctx.sampleRate;
  const len = Math.max(512, Math.floor(sr * clamp(durationSec, 0.25, 5)));
  const buf = ctx.createBuffer(2, len, sr);
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c);
    for (let i = 0; i < len; i++) {
      const t = i / len;
      /** Slower decay + correlated stereo tail for pad-like ambience */
      const env = Math.exp(-2.8 * t) * (0.65 + 0.35 * Math.sin(t * Math.PI * 3.2));
      d[i] = (Math.random() * 2 - 1) * env;
    }
  }
  return buf;
}

/** Approximate constant-power dry vs wet; conservative sums to reduce clipping. */
function dryLevel(delayMix: number, revMix: number): number {
  const d = clamp(delayMix, 0, 1);
  const r = clamp(revMix, 0, 1);
  return clamp(1 - 0.42 * d - 0.4 * r, 0.12, 1);
}

/** Peaking EQ center frequencies (Hz) — 7-band graphic / parametric-style. */
export const GRAIN_EQ_CENTER_HZ = [80, 240, 500, 1000, 2400, 5600, 12000] as const;

/** Q for grain EQ peaking bands — keep in sync with UI curve math. */
export const GRAIN_EQ_PEAKING_Q = 1.12;

export interface GrainMasterChain {
  /** Softens grain edges for drone / pad character */
  warmFilter: BiquadFilterNode;
  dryGain: GainNode;
  delay: DelayNode;
  feedbackGain: GainNode;
  delayWet: GainNode;
  convolver: ConvolverNode;
  revWet: GainNode;
  outGain: GainNode;
  /** Peaking filters (inserted between sum and master output). */
  eqBands: BiquadFilterNode[];
  /** Final trim before analyser / speakers (set from Grain “Gain” knob). */
  masterOutput: GainNode;
  analyser: AnalyserNode;
  /** Update levels and delay time (no IR regen). */
  applyFx: (fx: GrainFxState, ctx: AudioContext) => void;
  /** Replace convolver buffer when room size changes. */
  setReverbSize: (ctx: AudioContext, seconds: number) => void;
  /** dB per band, length 7; clamped ±12 dB. */
  applyEqGains: (gainsDb: number[], audioCtx: AudioContext) => void;
  dispose: () => void;
}

export function createGrainMasterChain(
  ctx: AudioContext,
  grainBus: AudioNode,
  destination: AudioDestinationNode,
  initialFx?: Partial<GrainFxState>,
): GrainMasterChain {
  const fx: GrainFxState = { ...DEFAULT_FX, ...initialFx };

  const dryGain = ctx.createGain();
  const delay = ctx.createDelay(2.0);
  const feedbackGain = ctx.createGain();
  const delayWet = ctx.createGain();
  const convolver = ctx.createConvolver();
  convolver.normalize = false;
  convolver.buffer = makeReverbImpulse(ctx, fx.reverbSizeSec);
  const revWet = ctx.createGain();
  const warmFilter = ctx.createBiquadFilter();
  warmFilter.type = 'lowpass';
  warmFilter.frequency.value = 5200;
  warmFilter.Q.value = 0.55;
  const outGain = ctx.createGain();
  const masterOutput = ctx.createGain();
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 2048;
  /** Wider dB range + slightly faster motion for the grain monitor */
  analyser.minDecibels = -96;
  analyser.maxDecibels = -9;
  analyser.smoothingTimeConstant = 0.42;

  grainBus.connect(warmFilter);
  warmFilter.connect(dryGain);
  warmFilter.connect(delay);
  warmFilter.connect(convolver);

  delay.connect(feedbackGain);
  feedbackGain.connect(delay);
  delay.connect(delayWet);

  convolver.connect(revWet);

  dryGain.connect(outGain);
  delayWet.connect(outGain);
  revWet.connect(outGain);

  const eqBands: BiquadFilterNode[] = [];
  let postSum: AudioNode = outGain;
  for (let i = 0; i < GRAIN_EQ_CENTER_HZ.length; i++) {
    const bf = ctx.createBiquadFilter();
    bf.type = 'peaking';
    bf.frequency.value = GRAIN_EQ_CENTER_HZ[i];
    bf.Q.value = GRAIN_EQ_PEAKING_Q;
    bf.gain.value = 0;
    postSum.connect(bf);
    eqBands.push(bf);
    postSum = bf;
  }
  postSum.connect(masterOutput);
  masterOutput.connect(analyser);
  analyser.connect(destination);

  const applyFx = (next: GrainFxState, audioCtx: AudioContext) => {
    const t = audioCtx.currentTime;
    const delaySec = clamp(next.delayTimeMs / 1000, 0.001, 1.95);
    const fb = clamp(next.delayFeedbackPct / 100, 0, 0.82);
    const dMix = clamp(next.delayMixPct / 100, 0, 1);
    const rMix = clamp(next.reverbMixPct / 100, 0, 1);

    try {
      delay.delayTime.cancelScheduledValues(t);
      delay.delayTime.setValueAtTime(delaySec, t);
    } catch {
      delay.delayTime.value = delaySec;
    }

    try {
      feedbackGain.gain.cancelScheduledValues(t);
      feedbackGain.gain.setValueAtTime(fb, t);
    } catch {
      feedbackGain.gain.value = fb;
    }

    const dry = dryLevel(dMix, rMix);
    try {
      dryGain.gain.cancelScheduledValues(t);
      dryGain.gain.setValueAtTime(dry, t);
      delayWet.gain.cancelScheduledValues(t);
      delayWet.gain.setValueAtTime(dMix * 0.62, t);
      revWet.gain.cancelScheduledValues(t);
      revWet.gain.setValueAtTime(rMix * 0.52, t);
    } catch {
      dryGain.gain.value = dry;
      delayWet.gain.value = dMix * 0.62;
      revWet.gain.value = rMix * 0.52;
    }
  };

  const setReverbSize = (audioCtx: AudioContext, seconds: number) => {
    convolver.buffer = makeReverbImpulse(audioCtx, clamp(seconds, 0.25, 5));
  };

  const applyEqGains = (gainsDb: number[], audioCtx: AudioContext) => {
    const t = audioCtx.currentTime;
    for (let i = 0; i < eqBands.length; i++) {
      const g = clamp(gainsDb[i] ?? 0, -12, 12);
      try {
        eqBands[i].gain.cancelScheduledValues(t);
        eqBands[i].gain.setTargetAtTime(g, t, 0.025);
      } catch {
        eqBands[i].gain.value = g;
      }
    }
  };

  applyFx(fx, ctx);

  const dispose = () => {
    try {
      grainBus.disconnect();
    } catch {
      /* ok */
    }
    try {
      warmFilter.disconnect();
      dryGain.disconnect();
      delay.disconnect();
      feedbackGain.disconnect();
      delayWet.disconnect();
      convolver.disconnect();
      revWet.disconnect();
      outGain.disconnect();
      for (let i = eqBands.length - 1; i >= 0; i--) {
        try {
          eqBands[i].disconnect();
        } catch {
          /* ok */
        }
      }
      masterOutput.disconnect();
      analyser.disconnect();
    } catch {
      /* ok */
    }
  };

  return {
    warmFilter,
    dryGain,
    delay,
    feedbackGain,
    delayWet,
    convolver,
    revWet,
    outGain,
    eqBands,
    masterOutput,
    analyser,
    applyFx,
    setReverbSize,
    applyEqGains,
    dispose,
  };
}

/** Merge stereo chunks from ScriptProcessor into one AudioBuffer (for WAV export). */
export function mergeStereoChunks(
  leftParts: Float32Array[],
  rightParts: Float32Array[],
  sampleRate: number,
): AudioBuffer {
  const len = leftParts.reduce((a, p) => a + p.length, 0);
  const buf = new AudioBuffer({ length: len, numberOfChannels: 2, sampleRate });
  let off = 0;
  for (const p of leftParts) {
    buf.getChannelData(0).set(p, off);
    off += p.length;
  }
  off = 0;
  for (const p of rightParts) {
    buf.getChannelData(1).set(p, off);
    off += p.length;
  }
  return buf;
}
