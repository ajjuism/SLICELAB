'use client';

interface StatusBarProps {
  message: string;
  active: boolean;
}

export function StatusBar({ message, active }: StatusBarProps) {
  return (
    <div style={{
      padding: '8px 14px',
      borderTop: '1px solid var(--border)',
      background: 'var(--surface)',
      fontFamily: "'IBM Plex Mono', monospace",
      fontSize: 9,
      color: 'var(--muted)',
      display: 'flex',
      alignItems: 'center',
      gap: 8,
      flexShrink: 0,
    }}>
      <div style={{
        width: 4,
        height: 4,
        borderRadius: '50%',
        background: active ? 'var(--green)' : 'var(--faint)',
        flexShrink: 0,
        animation: active ? 'blink 0.7s infinite' : 'none',
      }} />
      <span>{message}</span>
    </div>
  );
}
