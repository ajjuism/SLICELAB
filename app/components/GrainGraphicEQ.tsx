'use client';

import { useCallback, useMemo, useRef, useState } from 'react';
import {
  Area,
  CartesianGrid,
  ComposedChart,
  ReferenceDot,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { cascadedPeakingDbAt, logSpaceHz } from '../lib/grainEqMagnitude';
import { GRAIN_EQ_PRESETS } from '../lib/grainEqPresets';
import { GRAIN_EQ_CENTER_HZ, GRAIN_EQ_PEAKING_Q } from '../lib/grainFxGraph';
import { Knob } from './Knob';

const DB_MIN = -12;
const DB_MAX = 12;
const DB_CLAMP = 14;
const CURVE_POINTS = 220;
const KNOB_SIZE = 40;

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}

function formatHz(hz: number): string {
  if (hz >= 1000) {
    const k = hz / 1000;
    const s = Number.isInteger(k) ? `${k}` : k.toFixed(1).replace(/\.0$/, '');
    return `${s}k`;
  }
  return `${hz}`;
}

/** Rounded Hz for curve stats (avoids long floats from log-spaced samples). */
function formatCurveHz(hz: number): string {
  if (!Number.isFinite(hz)) return '—';
  if (hz >= 1000) {
    const k = hz / 1000;
    if (k >= 10) return `${Math.round(k)}k`;
    const r = Math.round(k * 10) / 10;
    return `${r}k`;
  }
  return `${Math.round(hz)} Hz`;
}

function formatDbDisplay(db: number): string {
  if (db === 0) return '0 dB';
  const n = db.toFixed(1);
  return db > 0 ? `+${n} dB` : `${n} dB`;
}

/** Clipboard line for sharing 7-band gains between sessions. */
const EQ_CLIP_PREFIX = 'slicelab-grain-eq:';

function serializeEqGains(g: number[]): string {
  const rounded = g.map(x => clamp(Math.round(x * 4) / 4, DB_MIN, DB_MAX));
  return EQ_CLIP_PREFIX + rounded.join(',');
}

function parseEqGains(raw: string): number[] | null {
  const t = raw.trim();
  const body = t.startsWith(EQ_CLIP_PREFIX) ? t.slice(EQ_CLIP_PREFIX.length) : t;
  const parts = body.split(',').map(s => s.trim()).filter(Boolean);
  if (parts.length !== 7) return null;
  const out: number[] = [];
  for (const p of parts) {
    const v = Number.parseFloat(p);
    if (!Number.isFinite(v)) return null;
    out.push(clamp(Math.round(v * 4) / 4, DB_MIN, DB_MAX));
  }
  return out;
}

interface GrainGraphicEQProps {
  gainsDb: number[];
  onGainsChange: (next: number[]) => void;
  disabled?: boolean;
  responseSampleRate?: number;
  /** When true, audio chain uses 0 dB on all bands; curve and knobs stay as edited. */
  eqBypass?: boolean;
  onEqBypassChange?: (bypass: boolean) => void;
}

/**
 * 7-band EQ: chart + tight knob row with presets beside the knobs.
 */
export function GrainGraphicEQ({
  gainsDb,
  onGainsChange,
  disabled = false,
  responseSampleRate = 48000,
  eqBypass = false,
  onEqBypassChange,
}: GrainGraphicEQProps) {
  const [clipHint, setClipHint] = useState<string | null>(null);
  const clipHintTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showClipHint = useCallback((msg: string) => {
    if (clipHintTimer.current) clearTimeout(clipHintTimer.current);
    setClipHint(msg);
    clipHintTimer.current = setTimeout(() => {
      setClipHint(null);
      clipHintTimer.current = null;
    }, 2200);
  }, []);

  const copyCurve = useCallback(async () => {
    const text = serializeEqGains(gainsDb);
    try {
      await navigator.clipboard.writeText(text);
      showClipHint('Curve copied');
    } catch {
      showClipHint('Copy blocked');
    }
  }, [gainsDb, showClipHint]);

  const pasteCurve = useCallback(async () => {
    try {
      const raw = await navigator.clipboard.readText();
      const next = parseEqGains(raw);
      if (!next) {
        showClipHint('Not a valid curve');
        return;
      }
      onGainsChange(next);
      showClipHint('Curve pasted');
    } catch {
      showClipHint('Paste blocked');
    }
  }, [onGainsChange, showClipHint]);
  const setBand = useCallback(
    (index: number, db: number) => {
      const next = [...gainsDb];
      const q = Math.round(db * 4) / 4;
      next[index] = clamp(q, DB_MIN, DB_MAX);
      onGainsChange(next);
    },
    [gainsDb, onGainsChange],
  );

  const curveData = useMemo(() => {
    const freqs = logSpaceHz(20, 20000, CURVE_POINTS);
    return freqs.map(f => ({
      f,
      db: clamp(
        cascadedPeakingDbAt(f, responseSampleRate, GRAIN_EQ_CENTER_HZ, gainsDb, GRAIN_EQ_PEAKING_Q),
        -DB_CLAMP,
        DB_CLAMP,
      ),
    }));
  }, [gainsDb, responseSampleRate]);

  const bandDots = useMemo(
    () =>
      GRAIN_EQ_CENTER_HZ.map(hz => ({
        f: hz,
        db: clamp(
          cascadedPeakingDbAt(hz, responseSampleRate, GRAIN_EQ_CENTER_HZ, gainsDb, GRAIN_EQ_PEAKING_Q),
          -DB_CLAMP,
          DB_CLAMP,
        ),
      })),
    [gainsDb, responseSampleRate],
  );

  const curveStats = useMemo(() => {
    if (curveData.length === 0) return null;
    let imax = 0;
    let imin = 0;
    for (let i = 1; i < curveData.length; i++) {
      if (curveData[i]!.db > curveData[imax]!.db) imax = i;
      if (curveData[i]!.db < curveData[imin]!.db) imin = i;
    }
    const max = curveData[imax]!;
    const min = curveData[imin]!;
    return { maxDb: max.db, maxHz: max.f, minDb: min.db, minHz: min.f };
  }, [curveData]);

  const applyPreset = useCallback(
    (gains: readonly number[]) => {
      onGainsChange(gains.map(g => clamp(Math.round(g * 4) / 4, DB_MIN, DB_MAX)));
    },
    [onGainsChange],
  );

  const xTicks = [80, 200, 500, 1000, 2000, 5000, 10000, 20000];
  const yTicks = [-12, -6, 0, 6, 12];

  const axisTickProps = {
    fontSize: 9,
    fontFamily: "'IBM Plex Mono', monospace",
    fill: 'var(--faint)',
  } as const;

  const presetBtn = {
    padding: '4px 5px',
    borderRadius: 2,
    border: '1px solid var(--border)',
    background: 'var(--surface)',
    color: 'var(--muted)',
    fontFamily: "'IBM Plex Mono', monospace",
    fontSize: 8,
    letterSpacing: 0.1,
    cursor: disabled ? 'not-allowed' : 'pointer',
    lineHeight: 1.2,
    textAlign: 'center' as const,
    width: '100%',
    minWidth: 0,
  } as const;

  const sectionTitleStyle = {
    fontSize: 8,
    letterSpacing: 0.9,
    color: 'var(--faint)',
    textTransform: 'uppercase',
    fontFamily: "'IBM Plex Mono', monospace",
    lineHeight: 1.2,
    margin: 0,
    display: 'block',
    minHeight: 14,
  } as const;

  const subSectionTitleStyle = {
    fontSize: 8,
    letterSpacing: 0.9,
    color: 'var(--faint)',
    textTransform: 'uppercase',
    fontFamily: "'IBM Plex Mono', monospace",
    lineHeight: 1.2,
    margin: 0,
    display: 'block',
  } as const;

  return (
    <div
      style={{
        marginTop: 14,
        width: '100%',
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        borderRadius: 2,
        padding: 0,
        opacity: disabled ? 0.5 : 1,
        pointerEvents: disabled ? 'none' : 'auto',
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'baseline',
          padding: '12px 14px 6px',
          fontFamily: "'IBM Plex Mono', monospace",
        }}
      >
        <span
          style={{
            fontSize: 9,
            letterSpacing: 1.5,
            color: 'var(--faint)',
            textTransform: 'uppercase',
          }}
        >
          Parametric EQ
        </span>
        <span style={{ fontSize: 9, color: 'var(--faint)', letterSpacing: 0.25 }}>
          ±12 dB · 7 bands · Q {GRAIN_EQ_PEAKING_Q}
          {eqBypass ? ' · bypass' : ''}
        </span>
      </div>

      <div style={{ padding: '0 10px 4px' }}>
        <div
          className="grain-eq-chart"
          style={{
            width: '100%',
            height: 158,
            border: '1px solid var(--border)',
            borderRadius: 2,
            background: 'var(--bg)',
            padding: '4px 4px 0 0',
            outline: 'none',
            userSelect: 'none',
            opacity: eqBypass ? 0.62 : 1,
            transition: 'opacity 0.18s ease',
          }}
          tabIndex={-1}
          onMouseDown={e => {
            const t = e.target as HTMLElement;
            if (t.closest('.recharts-wrapper') || t.closest('svg')) {
              e.preventDefault();
            }
          }}
        >
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={curveData} margin={{ top: 6, right: 6, left: 4, bottom: 4 }}>
              <CartesianGrid
                stroke="var(--border)"
                strokeOpacity={0.55}
                vertical={false}
                horizontal
              />
              {GRAIN_EQ_CENTER_HZ.map(hz => (
                <ReferenceLine
                  key={`v-${hz}`}
                  x={hz}
                  stroke="var(--border2)"
                  strokeOpacity={0.85}
                  strokeWidth={1}
                />
              ))}
              <XAxis
                type="number"
                dataKey="f"
                scale="log"
                domain={[20, 20000]}
                ticks={xTicks}
                allowDuplicatedCategory={false}
                tickFormatter={(v: number) => (v >= 1000 ? `${v / 1000}k` : `${v}`)}
                tick={axisTickProps}
                tickLine={{ stroke: 'var(--border2)' }}
                axisLine={{ stroke: 'var(--border2)' }}
                height={28}
              />
              <YAxis
                type="number"
                domain={[-12, 12]}
                ticks={yTicks}
                tickFormatter={(v: number) => (v > 0 ? `+${v}` : `${v}`)}
                tick={axisTickProps}
                tickLine={{ stroke: 'var(--border2)' }}
                axisLine={{ stroke: 'var(--border2)' }}
                width={34}
              />
              <Tooltip content={() => null} cursor={{ stroke: 'var(--border2)', strokeWidth: 1, opacity: 0.7 }} />
              <Area
                type="monotone"
                dataKey="db"
                stroke="var(--muted)"
                strokeOpacity={0.88}
                strokeWidth={1.05}
                fill="var(--border2)"
                fillOpacity={0.38}
                baseLine={0}
                dot={false}
                isAnimationActive={false}
                activeDot={false}
              />
              {bandDots.map((d, i) => (
                <ReferenceDot
                  key={`b-${GRAIN_EQ_CENTER_HZ[i]}`}
                  x={d.f}
                  y={d.db}
                  r={3.5}
                  fill="var(--border2)"
                  fillOpacity={0.95}
                  stroke="var(--surface)"
                  strokeWidth={1.25}
                />
              ))}
            </ComposedChart>
          </ResponsiveContainer>
        </div>

        {curveStats ? (
          <p
            style={{
              margin: '6px 2px 0',
              fontSize: 9,
              lineHeight: 1.35,
              color: 'var(--muted)',
              fontFamily: "'IBM Plex Mono', monospace",
            }}
          >
            {Math.abs(curveStats.maxDb) < 0.12 && Math.abs(curveStats.minDb) < 0.12
              ? 'Combined curve ≈ flat at this resolution.'
              : `Peak ${curveStats.maxDb >= 0 ? '+' : ''}${curveStats.maxDb.toFixed(1)} dB @ ${formatCurveHz(curveStats.maxHz)} · min ${curveStats.minDb >= 0 ? '+' : ''}${curveStats.minDb.toFixed(1)} dB @ ${formatCurveHz(curveStats.minHz)}`}
          </p>
        ) : null}
      </div>

      <div
        style={{
          display: 'flex',
          flexDirection: 'row',
          flexWrap: 'wrap',
          alignItems: 'flex-start',
          justifyContent: 'flex-start',
          gap: 12,
          rowGap: 10,
          padding: '6px 10px 10px',
          borderTop: '1px solid var(--border)',
          background: 'var(--bg)',
        }}
      >
        {/* Bands */}
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
            flex: '0 0 auto',
            minWidth: 0,
          }}
        >
          <span style={sectionTitleStyle}>Bands</span>
          <div
            style={{
              display: 'flex',
              flexWrap: 'nowrap',
              gap: 2,
              justifyContent: 'flex-start',
              alignItems: 'flex-end',
            }}
          >
            {GRAIN_EQ_CENTER_HZ.map((hz, i) => (
              <Knob
                key={hz}
                label={formatHz(hz)}
                value={gainsDb[i] ?? 0}
                min={DB_MIN}
                max={DB_MAX}
                step={0.25}
                display={formatDbDisplay(gainsDb[i] ?? 0)}
                title={`${formatHz(hz)} band gain (±12 dB)`}
                size={KNOB_SIZE}
                disabled={disabled}
                onChange={v => setBand(i, v)}
              />
            ))}
          </div>
        </div>

        {/* Presets */}
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
            width: 272,
            maxWidth: '100%',
            flex: '0 1 auto',
            minWidth: 0,
          }}
        >
          <span style={sectionTitleStyle}>Presets</span>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
              gap: 4,
              columnGap: 5,
              alignContent: 'start',
            }}
          >
            {GRAIN_EQ_PRESETS.map(p => (
              <button
                key={p.id}
                type="button"
                disabled={disabled}
                title={p.description}
                onClick={() => applyPreset(p.gainsDb)}
                style={presetBtn}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>

        {onEqBypassChange ? (
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 5,
              width: 112,
              maxWidth: '100%',
              flex: '0 0 auto',
            }}
          >
            <span style={sectionTitleStyle}>Compare</span>
            <button
              type="button"
              disabled={disabled}
              aria-pressed={eqBypass}
              title="Hear output with EQ flat (0 dB per band). Knob settings are kept for when you turn this off."
              onClick={() => onEqBypassChange(!eqBypass)}
              style={{
                ...presetBtn,
                padding: '6px 8px',
                borderColor: eqBypass ? 'var(--text)' : 'var(--border)',
                background: eqBypass ? 'var(--panel)' : 'var(--surface)',
                color: 'var(--text)',
              }}
            >
              {eqBypass ? 'Bypass on' : 'Bypass'}
            </button>
            <span style={{ ...subSectionTitleStyle, marginTop: 1 }}>Curve</span>
            <div style={{ display: 'flex', gap: 5 }}>
              <button
                type="button"
                disabled={disabled}
                title="Copy 7-band gains to the clipboard"
                onClick={() => void copyCurve()}
                style={{ ...presetBtn, padding: '5px 6px', flex: '1 1 50%' }}
              >
                Copy
              </button>
              <button
                type="button"
                disabled={disabled}
                title="Paste gains from clipboard (same format as Copy, or seven comma-separated dB values)"
                onClick={() => void pasteCurve()}
                style={{ ...presetBtn, padding: '5px 6px', flex: '1 1 50%' }}
              >
                Paste
              </button>
            </div>
            {clipHint ? (
              <span
                style={{
                  fontSize: 8,
                  color: 'var(--muted)',
                  fontFamily: "'IBM Plex Mono', monospace",
                  lineHeight: 1.3,
                  minHeight: 14,
                }}
              >
                {clipHint}
              </span>
            ) : (
              <span style={{ minHeight: 14 }} />
            )}
          </div>
        ) : null}

        {/* About */}
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
            flex: '1 1 200px',
            minWidth: 0,
            paddingLeft: 12,
            borderLeft: '1px solid var(--border)',
          }}
        >
          <span style={sectionTitleStyle}>About</span>
          <p
            style={{
              margin: 0,
              fontSize: 10,
              lineHeight: 1.55,
              color: 'var(--muted)',
              fontFamily: "'IBM Plex Sans', sans-serif",
            }}
          >
            Seven peaking bands (±12 dB, Q {GRAIN_EQ_PEAKING_Q}) sit after delay and reverb in the grain path. The curve is
            the combined cascade in that order — not each band alone. Presets are starting points; shelf-like tones are
            approximated with these fixed centers.
            {onEqBypassChange ? (
              <>
                {' '}
                Use <span style={{ color: 'var(--text)', fontWeight: 600 }}>Bypass</span> to A/B a flat EQ,{' '}
                <span style={{ color: 'var(--text)', fontWeight: 600 }}>Copy</span> /{' '}
                <span style={{ color: 'var(--text)', fontWeight: 600 }}>Paste</span> to move a curve as text, or
              </>
            ) : (
              ' '
            )}
            drag knobs vertically to tune by ear.
          </p>
        </div>
      </div>
    </div>
  );
}
