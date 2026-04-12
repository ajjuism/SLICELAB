'use client';

import { useRef, useState, type CSSProperties } from 'react';
import type { DetectionMethod, NamingScheme, BeatDivision, DetectionSettings, FadeSettings, NamingSettings } from '../types';
import { fmtTime } from '../lib/audio';

interface SidebarProps {
  detection: DetectionSettings;
  fade: FadeSettings;
  naming: NamingSettings;
  canAnalyze: boolean;
  canClear: boolean;
  onDetectionChange: (d: Partial<DetectionSettings>) => void;
  onFadeChange: (f: Partial<FadeSettings>) => void;
  onNamingChange: (n: Partial<NamingSettings>) => void;
  onFileLoad: (file: File) => void;
  onAnalyze: () => void;
  onClear: () => void;
  /** When slices exist: clear them but keep the loaded file (undo Apply). */
  hasAppliedSlices?: boolean;
  onClearAppliedSlices?: () => void;
  /** Manual marker mode: list / clear cuts (seconds along the file). */
  manualCutTimes?: number[];
  onRemoveManualCut?: (index: number) => void;
  onClearManualCuts?: () => void;
  audioDurationSec?: number | null;
  manualRegionStartSec?: number;
  manualRegionEndSec?: number;
  onManualRegionStartChange?: (sec: number) => void;
  onManualRegionEndChange?: (sec: number) => void;
}

const label = (text: string) => (
  <span style={{
    display: 'block',
    fontSize: 10,
    letterSpacing: 1.5,
    color: 'var(--faint)',
    textTransform: 'uppercase' as const,
    fontFamily: "'IBM Plex Mono', monospace",
    marginBottom: 6,
  }}>{text}</span>
);

const hint = (text: string) => (
  <p style={{
    fontSize: 8,
    lineHeight: 1.45,
    color: 'var(--faint)',
    fontFamily: "'IBM Plex Mono', monospace",
    margin: '0 0 8px',
    letterSpacing: 0.15,
  }}>{text}</p>
);

const METHOD_HELP: Record<DetectionMethod, string> = {
  transient: 'Attacks & spikes—tune sensitivity + gap below.',
  rms: 'RMS gate; lower dB = more sensitive.',
  beat: 'Slices on a BPM × division grid.',
  equal: 'Equal-length chops, no transient hunt.',
  manual: 'Set where exported audio begins and ends, add optional cuts between, then Apply slices.',
};

const Divider = () => (
  <div style={{ height: 1, background: 'var(--border)', margin: '2px 0' }} />
);

interface SliderRowProps {
  labelText: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  display?: string;
  hintText?: string;
  onChange: (v: number) => void;
}

function SliderRow({ labelText, value, min, max, step = 1, display, hintText, onChange }: SliderRowProps) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
        <span style={{ fontSize: 11, color: 'var(--muted)', fontFamily: "'IBM Plex Mono', monospace" }}>
          {labelText}
        </span>
        <span style={{ fontSize: 11, color: 'var(--text)', fontFamily: "'IBM Plex Mono', monospace" }}>
          {display ?? value}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={e => onChange(Number(e.target.value))}
      />
      {hintText ? (
        <span style={{
          fontSize: 8,
          lineHeight: 1.35,
          color: 'var(--faint)',
          fontFamily: "'IBM Plex Mono', monospace",
          letterSpacing: 0.1,
        }}>{hintText}</span>
      ) : null}
    </div>
  );
}

const DIV_LABELS: Record<string, string> = { '1': '1/1', '2': '1/2', '4': '1/4', '8': '1/8', '16': '1/16' };

const manualCutRemoveBtn: CSSProperties = {
  padding: '2px 8px',
  borderRadius: 2,
  border: '1px solid var(--border)',
  background: 'var(--surface)',
  color: 'var(--muted)',
  fontFamily: "'IBM Plex Mono', monospace",
  fontSize: 9,
  cursor: 'pointer',
  flexShrink: 0,
};

/** Must match MIN_MANUAL_REGION_SPAN in useAudioEngine */
const MANUAL_REGION_GAP_SEC = 0.05;

export function Sidebar({
  detection, fade, naming,
  canAnalyze, canClear,
  onDetectionChange, onFadeChange, onNamingChange,
  onFileLoad, onAnalyze, onClear,
  hasAppliedSlices = false,
  onClearAppliedSlices,
  manualCutTimes = [],
  onRemoveManualCut,
  onClearManualCuts,
  audioDurationSec = null,
  manualRegionStartSec = 0,
  manualRegionEndSec = 0,
  onManualRegionStartChange,
  onManualRegionEndChange,
}: SidebarProps) {
  const fileRef = useRef<HTMLInputElement>(null);
  const dragDepth = useRef(0);
  const [dragOver, setDragOver] = useState(false);

  const durSec = audioDurationSec ?? 0;
  const manualStartSliderVal =
    durSec > 0
      ? Math.max(0, Math.min(manualRegionStartSec, manualRegionEndSec - MANUAL_REGION_GAP_SEC))
      : 0;
  const manualEndSliderVal =
    durSec > 0
      ? Math.min(durSec, Math.max(manualRegionEndSec, manualRegionStartSec + MANUAL_REGION_GAP_SEC))
      : 0;

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    dragDepth.current = 0;
    setDragOver(false);
    const f = e.dataTransfer.files[0];
    if (f) onFileLoad(f);
  };
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  };
  const handleDragEnter = (e: React.DragEvent) => {
    e.preventDefault();
    dragDepth.current += 1;
    setDragOver(true);
  };
  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    dragDepth.current = Math.max(0, dragDepth.current - 1);
    if (dragDepth.current === 0) setDragOver(false);
  };

  return (
    <div style={{
      background: 'var(--surface)',
      borderRight: '1px solid var(--border)',
      display: 'flex',
      flexDirection: 'column',
      width: 240,
      flexShrink: 0,
      minHeight: 0,
      alignSelf: 'stretch',
      overflow: 'hidden',
    }}>
      <div
        className="sidebar-scroll"
        style={{
          flex: 1,
          minHeight: 0,
          overflowY: 'auto',
          padding: 14,
          display: 'flex',
          flexDirection: 'column',
          gap: 14,
        }}
      >
      {/* Load */}
      <div>
        {label('Load audio')}
        {hint('One file: waveform, slices, export.')}
        <div
          className="sidebar-load-zone"
          role="button"
          tabIndex={0}
          data-drag={dragOver ? 'true' : undefined}
          onClick={() => fileRef.current?.click()}
          onKeyDown={e => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              fileRef.current?.click();
            }
          }}
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          onDragEnter={handleDragEnter}
          onDragLeave={handleDragLeave}
          aria-label="Load audio file"
        >
          <div style={{
            fontFamily: "'IBM Plex Mono', monospace",
            fontSize: 11,
            fontWeight: 400,
            color: 'var(--text)',
            marginBottom: 4,
            lineHeight: 1.35,
          }}>
            {dragOver ? 'Release to load' : 'Drop or click to browse'}
          </div>
          <div style={{
            fontFamily: "'IBM Plex Mono', monospace",
            fontSize: 8,
            color: 'var(--faint)',
            lineHeight: 1.4,
            letterSpacing: 0.35,
          }}>
            WAV · MP3 · OGG · FLAC · M4A
          </div>
        </div>
        <input
          ref={fileRef}
          type="file"
          accept="audio/*"
          style={{ display: 'none' }}
          onChange={e => { if (e.target.files?.[0]) onFileLoad(e.target.files[0]); }}
        />
      </div>

      <Divider />

      {/* Detection method */}
      <div>
        {label('Detection method')}
        <select
          value={detection.method}
          onChange={e => onDetectionChange({ method: e.target.value as DetectionMethod })}
        >
          <option value="transient">Transient detection</option>
          <option value="rms">RMS energy threshold</option>
          <option value="beat">Beat / BPM grid</option>
          <option value="equal">Equal divisions</option>
          <option value="manual">Manual markers</option>
        </select>
        {hint(METHOD_HELP[detection.method])}
      </div>

      {detection.method === 'manual' && audioDurationSec != null && audioDurationSec > 0 && (
        <div>
          {label('Slice region')}
          {hint('First slice starts at “Start”; last slice ends at “End”. Cuts on the waveform only fall inside this window.')}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 10 }}>
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                <span style={{ fontSize: 11, color: 'var(--muted)', fontFamily: "'IBM Plex Mono', monospace" }}>Start (s)</span>
                <span style={{ fontSize: 11, color: 'var(--text)', fontFamily: "'IBM Plex Mono', monospace" }}>
                  {manualRegionStartSec.toFixed(2)}
                </span>
              </div>
              <input
                type="range"
                min={0}
                max={durSec}
                step={0.01}
                value={manualStartSliderVal}
                onChange={e => onManualRegionStartChange?.(Number(e.target.value))}
              />
            </div>
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                <span style={{ fontSize: 11, color: 'var(--muted)', fontFamily: "'IBM Plex Mono', monospace" }}>End (s)</span>
                <span style={{ fontSize: 11, color: 'var(--text)', fontFamily: "'IBM Plex Mono', monospace" }}>
                  {manualRegionEndSec.toFixed(2)}
                </span>
              </div>
              <input
                type="range"
                min={0}
                max={durSec}
                step={0.01}
                value={manualEndSliderVal}
                onChange={e => onManualRegionEndChange?.(Number(e.target.value))}
              />
            </div>
          </div>
          {label('Manual cuts')}
          {manualCutTimes.length === 0 ? (
            hint('Click the waveform to add cuts between Start and End. Shift+click removes the nearest cut.')
          ) : (
            <>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 5, marginBottom: 8 }}>
                {manualCutTimes.map((t, i) => (
                  <div
                    key={`${i}-${t.toFixed(4)}`}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: 8,
                      minWidth: 0,
                    }}
                  >
                    <span style={{
                      fontSize: 10,
                      fontFamily: "'IBM Plex Mono', monospace",
                      color: 'var(--text)',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}>
                      #{i + 1} · {fmtTime(t)}
                    </span>
                    <button
                      type="button"
                      onClick={() => onRemoveManualCut?.(i)}
                      style={manualCutRemoveBtn}
                      title="Remove this cut"
                    >
                      Remove
                    </button>
                  </div>
                ))}
              </div>
              <button
                type="button"
                onClick={() => onClearManualCuts?.()}
                style={{
                  width: '100%',
                  padding: '6px 10px',
                  borderRadius: 2,
                  border: '1px dashed var(--border2)',
                  background: 'transparent',
                  color: 'var(--muted)',
                  fontFamily: "'IBM Plex Mono', monospace",
                  fontSize: 10,
                  cursor: 'pointer',
                }}
              >
                Clear all cuts
              </button>
            </>
          )}
        </div>
      )}

      {/* Transient controls */}
      {detection.method === 'transient' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <SliderRow
            labelText="Sensitivity"
            value={detection.sensitivity}
            min={10} max={99}
            hintText="Higher → more peaks."
            onChange={v => onDetectionChange({ sensitivity: v })}
          />
          <SliderRow
            labelText="Min gap (ms)"
            value={detection.minGap}
            min={20} max={500} step={10}
            hintText="Min ms between slices."
            onChange={v => onDetectionChange({ minGap: v })}
          />
        </div>
      )}

      {/* RMS controls */}
      {detection.method === 'rms' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <SliderRow
            labelText="Threshold (dB)"
            value={detection.rmsThresh}
            min={-60} max={-6}
            display={`${detection.rmsThresh}dB`}
            hintText="Gate level; lower dB = more slices."
            onChange={v => onDetectionChange({ rmsThresh: v })}
          />
          <SliderRow
            labelText="Hold (ms)"
            value={detection.holdTime}
            min={10} max={400} step={10}
            hintText="Debounce between triggers."
            onChange={v => onDetectionChange({ holdTime: v })}
          />
        </div>
      )}

      {/* Beat controls */}
      {detection.method === 'beat' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <SliderRow
            labelText="BPM"
            value={detection.bpm}
            min={60} max={200}
            hintText="Quarter-note BPM."
            onChange={v => onDetectionChange({ bpm: v })}
          />
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
              <span style={{ fontSize: 11, color: 'var(--muted)', fontFamily: "'IBM Plex Mono', monospace" }}>Division</span>
              <span style={{ fontSize: 11, color: 'var(--text)', fontFamily: "'IBM Plex Mono', monospace" }}>{DIV_LABELS[detection.beatDiv]}</span>
            </div>
            <select
              value={detection.beatDiv}
              onChange={e => onDetectionChange({ beatDiv: e.target.value as BeatDivision })}
            >
              <option value="1">1/1 whole</option>
              <option value="2">1/2 half</option>
              <option value="4">1/4 quarter</option>
              <option value="8">1/8 eighth</option>
              <option value="16">1/16 sixteenth</option>
            </select>
            <span style={{
              display: 'block',
              marginTop: 6,
              fontSize: 8,
              lineHeight: 1.35,
              color: 'var(--faint)',
              fontFamily: "'IBM Plex Mono', monospace",
              letterSpacing: 0.1,
            }}>
              Finer grid → more slices at this BPM.
            </span>
          </div>
        </div>
      )}

      {/* Equal controls */}
      {detection.method === 'equal' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <SliderRow
            labelText="Num slices"
            value={detection.numSlices}
            min={2} max={64}
            hintText="Evenly splits duration."
            onChange={v => onDetectionChange({ numSlices: v })}
          />
        </div>
      )}

      <Divider />

      {/* Naming */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {label('Naming')}
        {hint('Filenames + labels; hex = short id.')}
        <select
          value={naming.scheme}
          onChange={e => onNamingChange({ scheme: e.target.value as NamingScheme })}
        >
          <option value="index">prefix_001, prefix_002…</option>
          <option value="hex">Hex timestamp</option>
        </select>
        <input
          type="text"
          placeholder="prefix"
          value={naming.prefix}
          onChange={e => onNamingChange({ prefix: e.target.value })}
        />
        <span style={{
          fontSize: 8,
          lineHeight: 1.35,
          color: 'var(--faint)',
          fontFamily: "'IBM Plex Mono', monospace",
          letterSpacing: 0.1,
          marginTop: -2,
        }}>
          Prefix before _001; optional.
        </span>
      </div>

      <Divider />

      {/* Fade */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {label('Fade')}
        {hint('On export; reduces clicks.')}
        <SliderRow
          labelText="Fade in (ms)"
          value={fade.fadeIn}
          min={0} max={100}
          hintText="Fade at slice start."
          onChange={v => onFadeChange({ fadeIn: v })}
        />
        <SliderRow
          labelText="Fade out (ms)"
          value={fade.fadeOut}
          min={0} max={200}
          hintText="Fade before slice end."
          onChange={v => onFadeChange({ fadeOut: v })}
        />
      </div>
      </div>

      <div style={{
        flexShrink: 0,
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        padding: '10px 14px 14px',
        borderTop: '1px solid var(--border)',
        background: 'var(--surface)',
      }}>
        {hasAppliedSlices && onClearAppliedSlices ? (
          <button
            type="button"
            onClick={onClearAppliedSlices}
            title="Remove detected slices but keep the loaded file"
            style={{
              width: '100%',
              padding: '6px 12px',
              borderRadius: 2,
              border: '1px dashed var(--border2)',
              background: 'transparent',
              color: 'var(--muted)',
              fontFamily: "'IBM Plex Mono', monospace",
              fontSize: 10,
              cursor: 'pointer',
              letterSpacing: 0.3,
            }}
          >
            Clear slices
          </button>
        ) : null}
        <div style={{ display: 'flex', gap: 6 }}>
          <button
            onClick={onAnalyze}
            disabled={!canAnalyze}
            style={{
              flex: 1,
              padding: '7px 12px',
              borderRadius: 2,
              border: '1px solid var(--text)',
              background: canAnalyze ? 'var(--text)' : 'var(--border)',
              color: canAnalyze ? 'var(--surface)' : 'var(--faint)',
              fontFamily: "'IBM Plex Mono', monospace",
              fontSize: 11,
              cursor: canAnalyze ? 'pointer' : 'not-allowed',
              letterSpacing: 0.5,
            }}
          >
            {detection.method === 'manual' ? 'Apply slices' : 'Analyze'}
          </button>
          <button
            onClick={onClear}
            disabled={!canClear}
            title="Unload file and reset project"
            style={{
              padding: '7px 12px',
              borderRadius: 2,
              border: '1px solid var(--border)',
              background: 'var(--surface)',
              color: canClear ? 'var(--text)' : 'var(--faint)',
              fontFamily: "'IBM Plex Mono', monospace",
              fontSize: 11,
              cursor: canClear ? 'pointer' : 'not-allowed',
            }}
          >
            Clear all
          </button>
        </div>
      </div>
    </div>
  );
}
