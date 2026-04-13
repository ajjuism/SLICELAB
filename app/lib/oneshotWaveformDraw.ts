import type { Slice } from '../types';
import { sliceToAudioBuffer, waveCssVar } from './audio';
import {
  buildOneshotClipProcessedBuffer,
  type OneshotClipParams,
} from './oneshotBuild';

/**
 * Draw buffer mapped across [x0, x0+widthPx): full buffer length → segment width.
 */
function drawBufferSpan(
  ctx: CanvasRenderingContext2D,
  data: Float32Array,
  len: number,
  x0: number,
  widthPx: number,
  H: number,
  stroke: string,
  lineWidth: number,
): void {
  if (len <= 0 || widthPx < 1) return;
  const step = Math.max(1, Math.ceil(len / widthPx));
  ctx.strokeStyle = stroke;
  ctx.lineWidth = lineWidth;
  ctx.lineCap = 'butt';
  ctx.beginPath();
  for (let px = 0; px < widthPx; px++) {
    const x = x0 + px;
    let min = 1,
      max = -1;
    for (let i = 0; i < step; i++) {
      const idx = Math.floor((px / widthPx) * len) + i;
      if (idx >= len) break;
      const s = data[idx] ?? 0;
      if (s < min) min = s;
      if (s > max) max = s;
    }
    ctx.moveTo(x, (H / 2) * (1 + min));
    ctx.lineTo(x, (H / 2) * (1 + max));
  }
  ctx.stroke();
}

/**
 * Full-slice faint background + trim-mute overlays + processed waveform in the kept region.
 * Gain is shown as a text multiplier (signal already baked into processed buffer).
 */
export function drawOneshotClipFeedbackWaveform(
  canvas: HTMLCanvasElement,
  source: AudioBuffer,
  slices: Slice[],
  clip: OneshotClipParams,
  audioCtx: AudioContext,
): void {
  const W = canvas.offsetWidth || 140;
  const H = canvas.offsetHeight || 32;
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, W, H);

  const slice = slices[clip.sliceIndex];
  if (!slice) {
    ctx.fillStyle = waveCssVar('--surface', '#ffffff');
    ctx.fillRect(0, 0, W, H);
    return;
  }

  ctx.fillStyle = waveCssVar('--surface', '#ffffff');
  ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = waveCssVar('--wave-oneshot-mid', 'rgba(92, 100, 112, 0.2)');
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, H / 2);
  ctx.lineTo(W, H / 2);
  ctx.stroke();

  const sliceBuf = sliceToAudioBuffer(source, slice, audioCtx);
  const sliceDurMs = Math.max(1e-6, slice.dur * 1000);
  let trimIn = Math.max(0, clip.trimStartMs);
  let trimOut = Math.max(0, clip.trimEndMs);
  const maxMs = sliceDurMs;
  if (trimIn + trimOut > maxMs) {
    const s = maxMs / (trimIn + trimOut);
    trimIn *= s;
    trimOut *= s;
  }
  const leftFrac = trimIn / sliceDurMs;
  const rightFrac = trimOut / sliceDurMs;

  const faint = waveCssVar('--wave-mini-stroke', '#5c6470');
  ctx.save();
  ctx.globalAlpha = 0.32;
  drawBufferSpan(ctx, sliceBuf.getChannelData(0), sliceBuf.length, 0, W, H, faint, 1);
  ctx.restore();

  const mute = waveCssVar('--wave-oneshot-trim-mute', 'rgba(18, 21, 26, 0.12)');
  ctx.globalAlpha = 1;
  ctx.fillStyle = mute;
  if (leftFrac > 0) ctx.fillRect(0, 0, W * leftFrac, H);
  if (rightFrac > 0) ctx.fillRect(W * (1 - rightFrac), 0, W * rightFrac, H);

  const edge = waveCssVar('--border2', '#c5ccd6');
  ctx.strokeStyle = edge;
  ctx.lineWidth = 1;
  ctx.globalAlpha = 0.85;
  if (leftFrac > 0.001 && leftFrac < 0.999) {
    const x = W * leftFrac;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, H);
    ctx.stroke();
  }
  if (rightFrac > 0.001 && rightFrac < 0.999) {
    const x = W * (1 - rightFrac);
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, H);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;

  const proc = buildOneshotClipProcessedBuffer(source, slices, clip, audioCtx);
  if (!proc || proc.length === 0) return;

  const x0 = W * leftFrac;
  const rw = Math.max(2, W * (1 - leftFrac - rightFrac));
  ctx.save();
  ctx.beginPath();
  ctx.rect(x0, 0, rw, H);
  ctx.clip();
  const stroke = waveCssVar('--wave-oneshot-stroke', '#6e7788');
  drawBufferSpan(ctx, proc.getChannelData(0), proc.length, x0, rw, H, stroke, 1.1);
  ctx.restore();

  ctx.fillStyle = waveCssVar('--muted', '#5c6470');
  ctx.font = '9px IBM Plex Mono, monospace';
  ctx.textAlign = 'right';
  ctx.textBaseline = 'top';
  ctx.fillText(`×${clip.gain.toFixed(2)}`, W - 3, 3);
}
