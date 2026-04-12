'use client';

import type { Slice } from '../types';
import { SliceCard } from './SliceCard';

interface SliceGridProps {
  slices: Slice[];
  audioBuffer: AudioBuffer | null;
  /** Slice index while a slice preview plays; -1 while full-source preview plays. */
  playingIndex: number | null;
  onPlay: (slice: Slice) => void;
  /** Play the entire loaded file (original buffer), not individual slices. */
  onPlayFullSource: () => void;
  hasAudio: boolean;
}

export function SliceGrid({ slices, audioBuffer, playingIndex, onPlay, onPlayFullSource, hasAudio }: SliceGridProps) {
  const playingFull = playingIndex === -1;
  return (
    <div
      className="app-scroll"
      style={{ flex: 1, overflowY: 'auto', padding: 14, minHeight: 0, background: 'var(--bg)' }}
    >
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 10,
        paddingBottom: 10,
        marginBottom: 12,
        borderBottom: '1px solid var(--border)',
      }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, minWidth: 0 }}>
          <span style={{
            fontSize: 10,
            letterSpacing: 1.5,
            color: 'var(--faint)',
            textTransform: 'uppercase',
            fontFamily: "'IBM Plex Mono', monospace",
          }}>
            Samples
          </span>
          <span style={{
            fontSize: 8,
            color: 'var(--faint)',
            fontFamily: "'IBM Plex Mono', monospace",
            letterSpacing: 0.2,
          }}>
            detected regions
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0, flexWrap: 'wrap' }}>
          {hasAudio && audioBuffer && (
            <button
              type="button"
              onClick={onPlayFullSource}
              aria-pressed={playingFull}
              style={{
                padding: '5px 10px',
                borderRadius: 2,
                border: `1px solid ${playingFull ? 'var(--text)' : 'var(--border)'}`,
                background: playingFull ? 'var(--text)' : 'transparent',
                color: playingFull ? 'var(--surface)' : 'var(--muted)',
                fontFamily: "'IBM Plex Mono', monospace",
                fontSize: 10,
                cursor: 'pointer',
                letterSpacing: 0.3,
              }}
            >
              {playingFull ? 'Playing full file…' : 'Play full file'}
            </button>
          )}
          <span style={{
            fontSize: 9,
            fontFamily: "'IBM Plex Mono', monospace",
            color: 'var(--muted)',
            border: '1px solid var(--border)',
            borderRadius: 2,
            padding: '3px 8px',
            lineHeight: 1,
          }}>
            {slices.length} {slices.length === 1 ? 'slice' : 'slices'}
          </span>
        </div>
      </div>

      {slices.length === 0 ? (
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 8,
          minHeight: 168,
          padding: '24px 16px',
          color: 'var(--faint)',
          border: '1px dashed var(--border2)',
          borderRadius: 2,
          background: 'var(--surface)',
        }}>
          <span style={{
            fontSize: 9,
            fontFamily: "'IBM Plex Mono', monospace",
            letterSpacing: 2,
            color: 'var(--border2)',
          }}>
            ◇
          </span>
          <p style={{
            fontSize: 9,
            fontFamily: "'IBM Plex Mono', monospace",
            lineHeight: 1.5,
            textAlign: 'center',
            letterSpacing: 0.1,
            margin: 0,
            maxWidth: 220,
          }}>
            {hasAudio
              ? 'Use Play full file above to hear the original. Run Analyze in the sidebar to detect regions and list slices below.'
              : 'Load audio in the sidebar, then analyze to populate this grid.'}
          </p>
        </div>
      ) : (
        <div style={{
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          borderRadius: 2,
          padding: 10,
        }}>
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(158px, 1fr))',
            gap: 8,
          }}>
            {slices.map(slice => (
              <SliceCard
                key={slice.index}
                slice={slice}
                audioBuffer={audioBuffer!}
                isPlaying={playingIndex === slice.index}
                onClick={() => onPlay(slice)}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
