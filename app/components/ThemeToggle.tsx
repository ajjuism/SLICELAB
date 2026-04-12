'use client';

import { useTheme } from 'next-themes';
import { useEffect, useState } from 'react';

/**
 * Switches light / dark; avoids hydration mismatch by rendering a stable placeholder until mounted.
 */
export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    // Avoid SSR/client mismatch for next-themes before hydration completes.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional mount gate
    setMounted(true);
  }, []);

  if (!mounted) {
    return (
      <span
        aria-hidden
        style={{
          width: 72,
          height: 28,
          flexShrink: 0,
          display: 'inline-block',
        }}
      />
    );
  }

  const dark = resolvedTheme === 'dark';

  return (
    <button
      type="button"
      onClick={() => setTheme(dark ? 'light' : 'dark')}
      title={dark ? 'Switch to light mode' : 'Switch to dark mode'}
      aria-label={dark ? 'Switch to light mode' : 'Switch to dark mode'}
      style={{
        padding: '5px 10px',
        borderRadius: 2,
        border: '1px solid var(--border)',
        background: 'var(--bg)',
        color: 'var(--muted)',
        fontFamily: "'IBM Plex Mono', monospace",
        fontSize: 9,
        letterSpacing: 0.35,
        cursor: 'pointer',
        flexShrink: 0,
        transition: 'border-color 0.12s ease, background 0.12s ease, color 0.12s ease',
      }}
    >
      {dark ? 'Light' : 'Dark'}
    </button>
  );
}
