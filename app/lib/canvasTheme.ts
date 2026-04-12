import type { GrainMonitorTheme } from './grainScopeDraw';

function readVar(name: string, fallback: string): string {
  if (typeof document === 'undefined') return fallback;
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

/** Grain scope / monitor — read from `globals.css` canvas tokens (light + dark). */
export function getGrainMonitorThemeFromCss(): GrainMonitorTheme {
  return {
    frameBorder: readVar('--grain-scope-border', '#dde2ea'),
    plotBg: readVar('--grain-scope-bg', '#ffffff'),
    gridMajor: readVar('--grain-scope-grid-major', 'rgba(18, 21, 26, 0.09)'),
    gridMinor: readVar('--grain-scope-grid-minor', 'rgba(18, 21, 26, 0.045)'),
    axisText: readVar('--grain-scope-axis', '#8b939f'),
    waveLine: readVar('--grain-scope-wave', '#5c6470'),
    spectrumLine: readVar('--grain-scope-spectrum', '#12151a'),
  };
}
