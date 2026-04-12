/**
 * One-click EQ shapes for the grain 7-band peaking chain.
 * “HPF/LPF-style” presets only approximate shelf/tilt using the fixed peaking bands — not separate HPF/LPF nodes.
 */

export interface GrainEqPreset {
  id: string;
  /** Short button label */
  label: string;
  /** Tooltip / aria */
  description: string;
  /** dB per band: 80, 240, 500, 1k, 2.4k, 5.6k, 12k */
  gainsDb: readonly [number, number, number, number, number, number, number];
}

export const GRAIN_EQ_PRESETS: readonly GrainEqPreset[] = [
  {
    id: 'mud',
    label: 'Cut mud',
    description: 'Reduce buildup ~200–500 Hz',
    gainsDb: [0, -7, -6, -1, 0, 0, 0],
  },
  {
    id: 'flat',
    label: 'Flat',
    description: 'All bands at 0 dB',
    gainsDb: [0, 0, 0, 0, 0, 0, 0],
  },
  {
    id: 'hpf-ish',
    label: 'Tight lows',
    description: 'Less sub / mud (approx. high-pass tilt; peaking bands only)',
    gainsDb: [-9, -6, -3, 0, 0, 0, 0],
  },
  {
    id: 'lpf-ish',
    label: 'Soft top',
    description: 'Gentler treble (approx. low-pass tilt)',
    gainsDb: [0, 0, 0, 0, -2, -6, -9],
  },
  {
    id: 'air',
    label: 'Air',
    description: 'Lift highs for shimmer',
    gainsDb: [0, 0, 0, 0, 2, 4, 7],
  },
  {
    id: 'warm',
    label: 'Warm',
    description: 'Fuller lows, softer highs',
    gainsDb: [3, 4, 2, 0, -1, -4, -6],
  },
  {
    id: 'presence',
    label: 'Presence',
    description: 'Upper-mid forward',
    gainsDb: [0, 0, 2, 5, 4, 1, 0],
  },
] as const;

/** Default Grain EQ on load — Cut mud. */
export function getGrainEqInitialGainsDb(): number[] {
  const mud = GRAIN_EQ_PRESETS.find(p => p.id === 'mud');
  return mud ? [...mud.gainsDb] : Array(7).fill(0);
}
