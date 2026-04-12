/**
 * Grain output monitor: compact oscilloscope + log-frequency spectrum (dB).
 * Colors match `globals.css` — light panel, grayscale traces (same language as waveform + sliders).
 */

export interface GrainMonitorTheme {
  /** 1px outer frame (sits on light --surface) */
  frameBorder: string;
  /** --surface */
  plotBg: string;
  /** Horizontal dB lines */
  gridMajor: string;
  /** Vertical frequency lines */
  gridMinor: string;
  /** Axis ticks (--faint / --muted) */
  axisText: string;
  waveLine: string;
  spectrumLine: string;
}

/** Aligned with :root in globals.css */
export const GRAIN_MONITOR_THEME: GrainMonitorTheme = {
  frameBorder: '#dde2ea',
  plotBg: '#ffffff',
  gridMajor: 'rgba(18, 21, 26, 0.09)',
  gridMinor: 'rgba(18, 21, 26, 0.045)',
  axisText: '#8b939f',
  waveLine: '#5c6470',
  spectrumLine: '#12151a',
};

const WAVE_STRIP_FRAC = 0.2;
const PAD_L = 40;
const PAD_R = 10;
const PAD_TOP = 8;
const PAD_BOTTOM = 26;

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}

function smoothTime(samples: number[], passes: number): void {
  for (let p = 0; p < passes; p++) {
    const prev = samples.slice();
    const n = samples.length;
    for (let i = 1; i < n - 1; i++) {
      samples[i] = prev[i - 1]! * 0.2 + prev[i]! * 0.6 + prev[i + 1]! * 0.2;
    }
  }
}

function interpDb(
  magDb: Float32Array,
  freqHz: number,
  sampleRate: number,
  fftSize: number,
): number {
  const idx = Math.max(0.5, (freqHz * fftSize) / sampleRate);
  const n = magDb.length;
  if (idx >= n - 1) return magDb[n - 1]!;
  const i0 = Math.floor(idx);
  const i1 = Math.min(i0 + 1, n - 1);
  const t = idx - i0;
  return magDb[i0]! * (1 - t) + magDb[i1]! * t;
}

function formatFreqLabel(f: number): string {
  if (f >= 1000) {
    const k = f / 1000;
    return k >= 10 ? `${k.toFixed(0)} k` : `${k.toFixed(1)} k`;
  }
  return `${Math.round(f)}`;
}

/**
 * @param freqByte — `analyser.getByteFrequencyData` (mapped between min/max dB by the engine)
 * @param smoothed — smoothed dB per bin; same length as freqByte
 */
export function drawGrainMonitor(
  canvas: HTMLCanvasElement,
  timeData: Uint8Array,
  freqByte: Uint8Array,
  sampleRate: number,
  fftSize: number,
  minDb: number,
  maxDb: number,
  theme: GrainMonitorTheme,
  smoothed: Float32Array,
): void {
  const c2d = canvas.getContext('2d');
  if (!c2d) return;

  const dpr = window.devicePixelRatio || 1;
  const W = canvas.offsetWidth;
  const H = canvas.offsetHeight;
  if (W < 2 || H < 2) return;

  if (canvas.width !== W * dpr || canvas.height !== H * dpr) {
    canvas.width = W * dpr;
    canvas.height = H * dpr;
  }
  c2d.setTransform(dpr, 0, 0, dpr, 0, 0);

  const nyquist = sampleRate * 0.5;
  const fMin = 25;
  const fMax = Math.min(20000, nyquist * 0.98);
  const logR = Math.log(fMax / fMin);

  const plotX0 = PAD_L;
  const plotX1 = W - PAD_R;
  const plotW = plotX1 - plotX0;

  const innerH = H - PAD_TOP - PAD_BOTTOM;
  const waveH = Math.max(36, innerH * WAVE_STRIP_FRAC);
  const specH = innerH - waveH;
  const waveY0 = PAD_TOP;
  const waveY1 = waveY0 + waveH;
  const specY0 = waveY1 + 1;
  const specY1 = H - PAD_BOTTOM;

  c2d.fillStyle = theme.plotBg;
  c2d.fillRect(0, 0, W, H);

  c2d.strokeStyle = theme.frameBorder;
  c2d.lineWidth = 1;
  c2d.beginPath();
  c2d.moveTo(plotX0, waveY1 + 0.5);
  c2d.lineTo(plotX1, waveY1 + 0.5);
  c2d.stroke();

  c2d.font = '500 9px "IBM Plex Mono", ui-monospace, monospace';
  c2d.textBaseline = 'middle';

  const n = smoothed.length;
  const dbRangeLin = maxDb - minDb;
  for (let i = 0; i < n; i++) {
    const db = minDb + (freqByte[i]! / 255) * dbRangeLin;
    if (!Number.isFinite(smoothed[i]!)) smoothed[i] = db;
    smoothed[i] = smoothed[i]! * 0.38 + db * 0.62;
  }

  const dbTop = maxDb + 4;
  const dbBottom = minDb - 4;
  const dbRange = dbBottom - dbTop;

  function yForDb(db: number) {
    return specY0 + ((db - dbTop) / dbRange) * (specY1 - specY0);
  }

  function xForFreq(f: number) {
    return plotX0 + (Math.log(f / fMin) / logR) * plotW;
  }

  /** Spectrum grid + axes */
  c2d.strokeStyle = theme.gridMinor;
  c2d.lineWidth = 1;
  const freqTicks = [50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000].filter(
    f => f <= fMax && f >= fMin,
  );
  for (const f of freqTicks) {
    const x = xForFreq(f);
    c2d.beginPath();
    c2d.moveTo(x, specY0);
    c2d.lineTo(x, specY1);
    c2d.stroke();
  }

  c2d.strokeStyle = theme.gridMajor;
  for (let db = -12; db >= -96; db -= 12) {
    if (db < dbBottom || db > dbTop) continue;
    const y = yForDb(db);
    c2d.beginPath();
    c2d.moveTo(plotX0, y);
    c2d.lineTo(plotX1, y);
    c2d.stroke();
  }

  c2d.fillStyle = theme.axisText;
  c2d.textAlign = 'right';
  c2d.font = '500 8px "IBM Plex Mono", ui-monospace, monospace';
  c2d.fillText('dB', plotX0 - 4, specY0 + 10);
  c2d.font = '500 9px "IBM Plex Mono", ui-monospace, monospace';
  for (let db = -12; db >= -96; db -= 12) {
    if (db < dbBottom || db > dbTop) continue;
    const y = yForDb(db);
    c2d.fillText(`${db}`, plotX0 - 6, y);
  }

  c2d.textAlign = 'center';
  c2d.textBaseline = 'top';
  const labelFreqs = [100, 200, 500, 1000, 2000, 5000, 10000].filter(f => f <= fMax && f >= fMin);
  for (const f of labelFreqs) {
    const x = xForFreq(f);
    c2d.fillText(formatFreqLabel(f), x, specY1 + 4);
  }
  c2d.textBaseline = 'middle';

  /** Spectrum polyline (log-sampled), crisp on light ground (no glow) */
  const steps = Math.min(400, Math.max(120, Math.floor(plotW)));
  c2d.lineJoin = 'round';
  c2d.lineCap = 'round';
  c2d.beginPath();
  let first = true;
  for (let s = 0; s <= steps; s++) {
    const t = s / steps;
    const f = fMin * Math.exp(t * logR);
    let db = interpDb(smoothed, f, sampleRate, fftSize);
    if (!Number.isFinite(db)) db = minDb;
    db = clamp(db, dbBottom, dbTop);
    const x = plotX0 + t * plotW;
    const y = yForDb(db);
    if (first) {
      c2d.moveTo(x, y);
      first = false;
    } else {
      c2d.lineTo(x, y);
    }
  }
  c2d.strokeStyle = theme.spectrumLine;
  c2d.lineWidth = 1;
  c2d.globalAlpha = 0.88;
  c2d.stroke();
  c2d.globalAlpha = 1;

  /** Waveform strip */
  c2d.strokeStyle = theme.gridMinor;
  c2d.lineWidth = 1;
  c2d.globalAlpha = 0.65;
  c2d.beginPath();
  const midW = (waveY0 + waveY1) / 2;
  c2d.moveTo(plotX0, midW);
  c2d.lineTo(plotX1, midW);
  c2d.stroke();
  c2d.globalAlpha = 1;

  const samples: number[] = new Array(timeData.length);
  for (let i = 0; i < timeData.length; i++) {
    samples[i] = (timeData[i]! - 128) / 128;
  }
  smoothTime(samples, 1);

  const step = plotW / Math.max(1, samples.length - 1);
  c2d.strokeStyle = theme.waveLine;
  c2d.lineWidth = 1;
  c2d.globalAlpha = 0.9;
  c2d.beginPath();
  for (let i = 0; i < samples.length; i++) {
    const x = plotX0 + i * step;
    const y = midW + samples[i]! * (waveH * 0.38);
    if (i === 0) c2d.moveTo(x, y);
    else c2d.lineTo(x, y);
  }
  c2d.stroke();
  c2d.globalAlpha = 1;

  c2d.fillStyle = theme.axisText;
  c2d.font = '500 8px "IBM Plex Mono", ui-monospace, monospace';
  c2d.textAlign = 'left';
  c2d.textBaseline = 'top';
  c2d.fillText('OSC', plotX0, waveY0 + 2);

  c2d.strokeStyle = theme.frameBorder;
  c2d.lineWidth = 1;
  c2d.strokeRect(0.5, 0.5, W - 1, H - 1);
}
