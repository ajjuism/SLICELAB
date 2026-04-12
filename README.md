# SliceLab

A Next.js audio sample slicer. Drop in a long audio file, auto-detect slices, preview them, then download as a ZIP of named WAV files.

## Getting started

```bash
npm install
npm run dev
```

Open http://localhost:3000

## Build for production

```bash
npm run build
npm start
```

## How it works

1. **Drop an audio file** — WAV, MP3, OGG, FLAC, or M4A
2. **Choose a detection method:**
   - **Transient** — finds attack peaks (drums, one-shots)
   - **RMS energy** — slices on volume events (speech, phrases)
   - **Beat grid** — divides by BPM at any subdivision (1/1 through 1/16)
   - **Equal** — splits into N equal parts
3. **Choose a naming scheme** — numbered index, musical notes, drum names, or hex
4. **Adjust fade in/out** — avoids clicks and pops at slice boundaries
5. **Click Analyze** — markers appear on the waveform, slice cards populate
6. **Click any card** to preview the slice
7. **Download zip** — all slices exported as 16-bit WAV files

## Stack

- Next.js 16 (App Router)
- TypeScript
- Web Audio API (no server-side audio processing)
- JSZip (client-side ZIP generation)
- IBM Plex Mono / IBM Plex Sans
# SLICELAB
