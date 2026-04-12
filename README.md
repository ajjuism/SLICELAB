<p align="center">
  <a href="https://slicelab.pxl8.studio" title="Open SliceLab">
    <img src="app/opengraph-image.png" alt="SliceLab — slice audio into samples in your browser" width="600" />
  </a>
</p>

# SliceLab

**Slice audio into samples in your browser.** Drop a long recording, auto-detect slice points (or slice to a grid), tweak fades and filenames, export a **ZIP of WAVs**, and sketch layered patterns in the **loop builder**. Processing runs in the browser—your files stay on your device.

**Live app:** [slicelab.pxl8.studio](https://slicelab.pxl8.studio)

---

## Features

| | |
| --- | --- |
| **Detection** | Transient peaks, RMS energy gates, tempo **beat grid** (BPM + subdivision), **equal** splits, or **manual** mode: optional **slice region** (where exports start/end) plus cuts on the waveform |
| **Waveform** | Master waveform with slice markers; preview playhead and slice highlight while you listen |
| **Fades** | Per-slice fade-in / fade-out to reduce clicks |
| **Naming** | Indexed names (`smpl_001`…) or **hex**-style names, with a custom **prefix** |
| **Export** | One-click **ZIP** of 16-bit mono WAV slices |
| **Loop builder** | Step sequencer (8 / 16 / 32 steps per bar), per-layer hit rate, layers, swing, time signature, optional loop WAV download |

---

## Quick start

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

### Production build

```bash
npm run build
npm start
```

---

## How to use

1. **Load audio** — Decode in-browser (common formats supported by the Web Audio API, e.g. WAV, MP3, OGG).
2. **Pick a detection mode** and tune sensitivity, gaps, BPM, or slice count as needed.
3. **Set fades and naming** (prefix + index or hex scheme).
4. **Analyze** — Slices appear on the waveform and in the slice grid.
5. **Preview** slices or the full file; use **Download zip** when you are happy with the cuts.
6. **Loop builder** (after slices exist) — Pick step resolution (8–32 per bar), assign slices, adjust tempo and feel, play or export a loop.

**Note:** The UI is aimed at **desktop/laptop** viewports; narrow screens show a short message to use a larger display.

---

## Stack

- [Next.js](https://nextjs.org/) 16 (App Router) · TypeScript · React 19  
- [Web Audio API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API) — decode, slice, preview, and pattern audio on the client  
- [JSZip](https://stuk.github.io/jszip/) — ZIP downloads in the browser  
- IBM Plex Mono / IBM Plex Sans  

---

## Repo layout (high level)

| Path | Role |
| --- | --- |
| `app/` | Routes, layout, metadata, global styles |
| `app/components/` | UI (waveform, slice grid, loop builder, sidebar, …) |
| `app/hooks/useAudioEngine.ts` | Audio context, playback, export |
| `app/lib/audio.ts` | Detection, buffers, waveform drawing, WAV encoding |
| `public/` | Static assets (logo, favicon, …) |

The social / Open Graph image used in metadata lives at **`app/opengraph-image.png`** (same asset as in the banner above).
