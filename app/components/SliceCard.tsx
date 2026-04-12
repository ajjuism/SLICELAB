'use client';

import { useRef, useEffect } from 'react';
import type { Slice } from '../types';
import { drawMiniWave, fmtTime } from '../lib/audio';

interface SliceCardProps {
  slice: Slice;
  audioBuffer: AudioBuffer;
  isPlaying: boolean;
  onClick: () => void;
}

export function SliceCard({ slice, audioBuffer, isPlaying, onClick }: SliceCardProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!canvasRef.current) return;
    requestAnimationFrame(() => {
      if (canvasRef.current) {
        drawMiniWave(canvasRef.current, audioBuffer, slice.startSample, slice.endSample);
      }
    });
  }, [audioBuffer, slice.startSample, slice.endSample]);

  const displayName = slice.name.replace(/\.(wav|mp3|ogg|flac|m4a)$/i, '');

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={`Play ${slice.name}`}
      onClick={onClick}
      onKeyDown={e => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onClick();
        }
      }}
      style={{
        background: 'var(--surface)',
        border: `1px solid ${isPlaying ? 'var(--text)' : 'var(--border)'}`,
        borderRadius: 2,
        padding: 8,
        cursor: 'pointer',
        position: 'relative',
        transition: 'border-color 0.15s ease, box-shadow 0.15s ease, transform 0.15s ease',
        animation: 'fadeIn 0.15s ease-out forwards',
      }}
      onMouseEnter={e => {
        if (isPlaying) return;
        const el = e.currentTarget as HTMLDivElement;
        el.style.borderColor = 'var(--border2)';
        el.style.boxShadow = '0 2px 10px rgba(18, 21, 26, 0.07)';
        el.style.transform = 'translateY(-1px)';
      }}
      onMouseLeave={e => {
        if (isPlaying) return;
        const el = e.currentTarget as HTMLDivElement;
        el.style.borderColor = 'var(--border)';
        el.style.boxShadow = 'none';
        el.style.transform = 'none';
      }}
    >
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: 6,
      }}>
        <span style={{
          fontSize: 8,
          fontFamily: "'IBM Plex Mono', monospace",
          letterSpacing: 0.5,
          color: 'var(--muted)',
          border: '1px solid var(--border)',
          borderRadius: 2,
          padding: '2px 5px',
          lineHeight: 1,
        }}>
          #{String(slice.index + 1).padStart(2, '0')}
        </span>
        {isPlaying && (
          <span
            style={{
              width: 6,
              height: 6,
              borderRadius: '50%',
              background: 'var(--text)',
              flexShrink: 0,
              animation: 'blink 0.7s infinite',
            }}
            aria-hidden
          />
        )}
      </div>

      <canvas
        ref={canvasRef}
        style={{
          width: '100%',
          height: 36,
          display: 'block',
          marginBottom: 8,
        }}
      />

      <div
        style={{
          fontSize: 10,
          fontFamily: "'IBM Plex Mono', monospace",
          color: 'var(--text)',
          marginBottom: 6,
          lineHeight: 1.3,
          display: '-webkit-box',
          WebkitLineClamp: 2,
          WebkitBoxOrient: 'vertical' as const,
          overflow: 'hidden',
          wordBreak: 'break-word',
        }}
        title={slice.name}
      >
        {displayName || slice.name}
      </div>

      <div style={{
        paddingTop: 4,
        borderTop: '1px solid var(--border)',
      }}>
        <span style={{ fontSize: 9, color: 'var(--muted)', fontFamily: "'IBM Plex Mono', monospace" }}>
          {fmtTime(slice.dur)}
        </span>
      </div>
    </div>
  );
}
