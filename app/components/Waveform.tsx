'use client';

import { useRef, useEffect, useCallback } from 'react';
import type { AudioInfo, DetectionMethod } from '../types';
import { drawWaveform, fmtTime, type WaveformPlaybackOverlay } from '../lib/audio';

interface WaveformProps {
  audioBuffer: React.MutableRefObject<AudioBuffer | null>;
  audioInfo: AudioInfo | null;
  markers: number[];
  method: DetectionMethod;
  sliceCount: number;
  /** Live playhead + optional slice highlight (preview playback). */
  playback?: WaveformPlaybackOverlay | null;
}

const METHOD_LABELS: Record<DetectionMethod, string> = {
  transient: 'transient',
  rms: 'rms energy',
  beat: 'beat grid',
  equal: 'equal div',
};

function overlayFromPlayback(p: WaveformPlaybackOverlay | null | undefined): WaveformPlaybackOverlay | null {
  if (!p || (p.playheadSec == null && p.highlightBetweenSec == null)) return null;
  return {
    playheadSec: p.playheadSec ?? null,
    highlightBetweenSec: p.highlightBetweenSec ?? null,
  };
}

export function Waveform({ audioBuffer, audioInfo, markers, method, sliceCount, playback }: WaveformProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const playbackRef = useRef(playback);
  playbackRef.current = playback;

  const redraw = useCallback(() => {
    if (!canvasRef.current) return;
    drawWaveform(canvasRef.current, audioBuffer.current, markers, overlayFromPlayback(playbackRef.current));
  }, [audioBuffer, markers]);

  useEffect(() => {
    redraw();
  }, [redraw, playback?.playheadSec, playback?.highlightBetweenSec]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ro = new ResizeObserver(() => redraw());
    ro.observe(canvas);
    return () => ro.disconnect();
  }, [redraw]);

  return (
    <div style={{
      padding: 14,
      borderBottom: '1px solid var(--border)',
      flexShrink: 0,
      background: 'var(--surface)',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
        <span style={{
          fontSize: 10,
          letterSpacing: 1.5,
          color: 'var(--faint)',
          textTransform: 'uppercase',
          fontFamily: "'IBM Plex Mono', monospace",
        }}>
          Waveform
        </span>
        <span style={{
          fontSize: 10,
          fontFamily: "'IBM Plex Mono', monospace",
          color: 'var(--muted)',
        }}>
          {METHOD_LABELS[method]}
        </span>
      </div>

      <canvas
        ref={canvasRef}
        style={{
          width: '100%',
          height: 110,
          background: 'var(--bg)',
          borderRadius: 2,
          border: '1px solid var(--border)',
          display: 'block',
        }}
      />

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 14px', marginTop: 8 }}>
        {[
          ['dur', audioInfo ? fmtTime(audioInfo.duration) : '—'],
          ['sr', audioInfo ? `${audioInfo.sampleRate}Hz` : '—'],
          ['ch', audioInfo ? String(audioInfo.channels) : '—'],
          ['slices', String(sliceCount)],
        ].map(([k, v]) => (
          <div key={k} style={{ fontSize: 9, fontFamily: "'IBM Plex Mono', monospace", color: 'var(--faint)' }}>
            {k} <span style={{ color: 'var(--text)' }}>{v}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
