'use client';

import { useCallback, useRef, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react';

export interface KnobProps {
  label: string;
  /** Current value (controlled). */
  value: number;
  min: number;
  max: number;
  /** Optional step for keyboard; drag uses fractional deltas. */
  step?: number;
  /** Shown under the knob (e.g. "42 ms"). */
  display: string;
  onChange: (v: number) => void;
  /** Extra hint for hover / SR. */
  title?: string;
  /** Outer diameter in px. */
  size?: number;
  disabled?: boolean;
}

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}

/** Arc from angle a0 → a1 at radius r (SVG coords, y down, clockwise sweep). */
function arcSegment(cx: number, cy: number, r: number, a0: number, a1: number): string {
  const x0 = cx + r * Math.cos(a0);
  const y0 = cy + r * Math.sin(a0);
  const x1 = cx + r * Math.cos(a1);
  const y1 = cy + r * Math.sin(a1);
  const delta = a1 - a0;
  const norm = ((delta % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
  const large = norm > Math.PI ? 1 : 0;
  return `M ${x0} ${y0} A ${r} ${r} 0 ${large} 1 ${x1} ${y1}`;
}

/**
 * Rotary control: vertical drag changes value (up = increase).
 * Value is a stroke arc (not a pie fill) so nothing draws outside the ring.
 */
export function Knob({
  label,
  value,
  min,
  max,
  step = 1,
  display,
  onChange,
  title,
  size = 56,
  disabled = false,
}: KnobProps) {
  const dragRef = useRef<{ startY: number; startVal: number } | null>(null);

  const cx = size / 2;
  const cy = size / 2;
  /** Outer ring radius */
  const rOuter = (size - 10) / 2;
  /** Track centerline */
  const rTrack = rOuter - 3;
  /** Value arc inset: slightly smaller than pointer so stroke caps do not read past the dot */
  const rValue = rTrack - 2.75;
  const rValueStroke = rValue - 2.6;

  const t = max === min ? 0 : (value - min) / (max - min);
  const startAngle = -Math.PI * 0.75;
  const sweep = Math.PI * 1.5;
  const endAngle = startAngle + t * sweep;
  const pointerAngle = endAngle;

  const ix = cx + (rValue - 2) * Math.cos(pointerAngle);
  const iy = cy + (rValue - 2) * Math.sin(pointerAngle);

  const trackPath = arcSegment(cx, cy, rTrack, startAngle, startAngle + sweep);
  const valuePath =
    t > 0.001 ? arcSegment(cx, cy, rValueStroke, startAngle, endAngle) : '';

  const onPointerDown = useCallback(
    (e: ReactPointerEvent) => {
      if (disabled) return;
      e.currentTarget.setPointerCapture(e.pointerId);
      dragRef.current = { startY: e.clientY, startVal: value };
    },
    [disabled, value],
  );

  const onPointerMove = useCallback(
    (e: ReactPointerEvent) => {
      if (!dragRef.current || disabled) return;
      const { startY, startVal } = dragRef.current;
      const range = max - min || 1;
      const delta = (startY - e.clientY) * (range / 120);
      let next = startVal + delta;
      if (step >= 1) next = Math.round(next / step) * step;
      onChange(clamp(next, min, max));
    },
    [disabled, max, min, onChange, step],
  );

  const onPointerUp = useCallback((e: ReactPointerEvent) => {
    dragRef.current = null;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      /* ok */
    }
  }, []);

  const onKeyDown = useCallback(
    (e: KeyboardEvent<HTMLButtonElement>) => {
      if (disabled) return;
      const inc = (e.shiftKey ? step * 5 : step) || 1;
      if (e.key === 'ArrowUp' || e.key === 'ArrowRight') {
        e.preventDefault();
        onChange(clamp(value + inc, min, max));
      } else if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') {
        e.preventDefault();
        onChange(clamp(value - inc, min, max));
      } else if (e.key === 'Home') {
        e.preventDefault();
        onChange(min);
      } else if (e.key === 'End') {
        e.preventDefault();
        onChange(max);
      }
    },
    [disabled, max, min, onChange, step, value],
  );

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 4,
        width: size + 16,
        opacity: disabled ? 0.45 : 1,
      }}
    >
      <span
        style={{
          fontSize: 9,
          letterSpacing: 0.8,
          textTransform: 'uppercase',
          color: 'var(--faint)',
          fontFamily: "'IBM Plex Mono', monospace",
          textAlign: 'center',
          lineHeight: 1.2,
        }}
      >
        {label}
      </span>
      <button
        type="button"
        title={title ?? label}
        disabled={disabled}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={value}
        role="slider"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onKeyDown={onKeyDown}
        style={{
          width: size,
          height: size,
          padding: 0,
          border: 'none',
          background: 'transparent',
          cursor: disabled ? 'not-allowed' : 'ns-resize',
          borderRadius: '50%',
          outline: 'none',
        }}
      >
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden>
          <circle cx={cx} cy={cy} r={rOuter} fill="none" stroke="var(--border2)" strokeWidth={1.25} />
          <path
            d={trackPath}
            fill="none"
            stroke="var(--border)"
            strokeWidth={2.25}
            strokeLinecap="round"
            opacity={0.38}
          />
          {valuePath ? (
            <path
              d={valuePath}
              fill="none"
              stroke="var(--text)"
              strokeWidth={2}
              strokeLinecap="round"
              opacity={0.32}
            />
          ) : null}
          <line
            x1={cx}
            y1={cy}
            x2={ix}
            y2={iy}
            stroke="var(--text)"
            strokeWidth={1.75}
            strokeLinecap="round"
            opacity={0.82}
          />
        </svg>
      </button>
      <span
        style={{
          fontSize: 10,
          color: 'var(--muted)',
          fontFamily: "'IBM Plex Mono', monospace",
          textAlign: 'center',
          minHeight: 14,
        }}
      >
        {display}
      </span>
    </div>
  );
}
