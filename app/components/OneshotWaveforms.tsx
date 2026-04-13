'use client';

import { useEffect, useRef } from 'react';
import { useTheme } from 'next-themes';
import type { Slice } from '../types';
import { drawMiniWave, waveCssVar } from '../lib/audio';
import { drawOneshotClipFeedbackWaveform } from '../lib/oneshotWaveformDraw';
import {
  buildOneshotComposite,
  type OneshotClipParams,
  type OneshotLayout,
} from '../lib/oneshotBuild';

const WAVE_PROM = 'prominent' as const;

function drawMiniPlaceholder(canvas: HTMLCanvasElement, prominent: boolean): void {
  const W = canvas.offsetWidth || 140;
  const H = canvas.offsetHeight || 32;
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, W, H);
  if (prominent && typeof document !== 'undefined') {
    const bg = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim();
    if (bg) {
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, W, H);
    }
  }
  ctx.strokeStyle = waveCssVar('--wave-oneshot-mid', 'rgba(92, 100, 112, 0.2)');
  ctx.globalAlpha = 0.55;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, H / 2);
  ctx.lineTo(W, H / 2);
  ctx.stroke();
  ctx.globalAlpha = 1;
}

type ClipWaveProps = {
  source: AudioBuffer | null;
  slices: Slice[];
  clip: OneshotClipParams;
  ensureAudioContext: () => Promise<AudioContext>;
};

/** Waveform of this clip after trim, reverse, and gain — matches Preview / Export processing. */
export function OneshotClipWaveform({ source, slices, clip, ensureAudioContext }: ClipWaveProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { resolvedTheme } = useTheme();

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !source) return;

    let cancelled = false;

    const paint = () => {
      void ensureAudioContext().then(ctx => {
        if (cancelled || !canvasRef.current) return;
        const c = canvasRef.current;
        requestAnimationFrame(() => {
          if (cancelled || !canvasRef.current) return;
          drawOneshotClipFeedbackWaveform(canvasRef.current, source, slices, clip, ctx);
        });
      });
    };

    paint();
    const ro = new ResizeObserver(() => paint());
    ro.observe(canvas);
    return () => {
      cancelled = true;
      ro.disconnect();
    };
  }, [
    source,
    slices,
    clip.sliceIndex,
    clip.reverse,
    clip.gain,
    clip.trimStartMs,
    clip.trimEndMs,
    ensureAudioContext,
    resolvedTheme,
  ]);

  return (
    <canvas
      ref={canvasRef}
      style={{
        width: '100%',
        height: 40,
        display: 'block',
        background: 'var(--surface)',
      }}
      aria-label={
        clip.reverse
          ? 'Waveform: faint full slice, shaded trim, bold region is preview; gain shown as multiplier'
          : 'Waveform: faint full slice, shaded trim, bold region is preview; gain shown as multiplier'
      }
    />
  );
}

type CompositeWaveProps = {
  source: AudioBuffer | null;
  slices: Slice[];
  clips: OneshotClipParams[];
  layout: OneshotLayout;
  sequenceGapMs: number;
  canBuild: boolean;
  ensureAudioContext: () => Promise<AudioContext>;
};

/** Full composite waveform (layer or sequence) for the current settings. */
export function OneshotCompositeWaveform({
  source,
  slices,
  clips,
  layout,
  sequenceGapMs,
  canBuild,
  ensureAudioContext,
}: CompositeWaveProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { resolvedTheme } = useTheme();

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !source) return;

    if (!canBuild) {
      drawMiniPlaceholder(canvas, true);
      return;
    }

    let cancelled = false;

    const paint = () => {
      void ensureAudioContext().then(ctx => {
        if (cancelled || !canvasRef.current) return;
        const out = buildOneshotComposite(source, slices, clips, layout, sequenceGapMs, ctx);
        const c = canvasRef.current;
        if (!out || out.length === 0) {
          if (c) drawMiniPlaceholder(c, true);
          return;
        }
        requestAnimationFrame(() => {
          if (cancelled || !canvasRef.current) return;
          drawMiniWave(canvasRef.current, out, 0, out.length, WAVE_PROM);
        });
      });
    };

    paint();
    const ro = new ResizeObserver(() => paint());
    ro.observe(canvas);
    return () => {
      cancelled = true;
      ro.disconnect();
    };
  }, [
    source,
    slices,
    clips,
    layout,
    sequenceGapMs,
    canBuild,
    ensureAudioContext,
    resolvedTheme,
  ]);

  return (
    <canvas
      ref={canvasRef}
      style={{
        width: '100%',
        height: 32,
        display: 'block',
        background: 'var(--bg)',
      }}
      aria-label="Composite output waveform"
    />
  );
}
