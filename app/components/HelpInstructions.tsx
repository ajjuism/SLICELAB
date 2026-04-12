'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

function HelpIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="1.5" />
      <path
        d="M9.5 9.5a2.5 2.5 0 1 1 4.2 1.8c-.6.8-1.7 1.2-1.7 2.2V15"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      <circle cx="12" cy="17.5" r="0.9" fill="currentColor" />
    </svg>
  );
}

type HelpSectionId = 'overview' | 'slice' | 'loop' | 'grain' | 'files';

const NAV_ITEMS: { id: HelpSectionId; title: string; desc: string }[] = [
  { id: 'overview', title: 'Overview', desc: 'Layout & workflow' },
  { id: 'slice', title: 'Slice workspace', desc: 'Detect & export' },
  { id: 'loop', title: 'Loops', desc: 'Sequencer & layers' },
  { id: 'grain', title: 'Grains', desc: 'Cloud, space & EQ' },
  { id: 'files', title: 'Files & privacy', desc: 'Formats & safety' },
];

function PanelOverview() {
  return (
    <div id="help-panel-overview" role="tabpanel" aria-labelledby="help-nav-overview">
      <h3 className="help-pane-title">Overview</h3>
      <p className="help-lead">
        Use one workflow for cutting audio into files, and another for trying those cuts in a rhythm grid. Everything
        happens in this tab—your files are not uploaded anywhere. If something fails, check the message at the bottom of
        the window; the dot next to it flashes while the app is busy.
      </p>

      <div className="help-block">
        <h4>Where things live</h4>
        <ul className="help-checks">
          <li>
            <strong>Top row</strong> — See which file is loaded, switch between <strong>Slices</strong>,{' '}
            <strong>Loops</strong>, and <strong>Grains</strong> (texture player; all need slices first). When
            slices exist, use <strong>Download zip</strong> to save all WAVs in one go.
          </li>
          <li>
            <strong>Left column</strong> — Load and replace audio, set how slices are detected (or draw them in manual
            mode), adjust export fades and file naming, then run <strong>Analyze</strong> or <strong>Apply slices</strong>.
            Use <strong>Clear slices</strong> to remove slices but keep the same file; use <strong>Clear all</strong> to
            start over from scratch.
          </li>
          <li>
            <strong>Main area</strong> — The waveform shows boundaries; in manual mode before you apply, look for region
            markers <strong>S</strong> / <strong>E</strong> and any cuts you added. Underneath you either preview each
            slice as cards, build a loop on the <strong>Loops</strong> tab, or open <strong>Grains</strong> for
            granular playback and effects.
          </li>
        </ul>
      </div>

      <div className="help-block">
        <h4>Start here</h4>
        <ol>
          <li>
            Load audio → choose how slices are created → press <strong>Analyze</strong> (or <strong>Apply slices</strong>{' '}
            in manual mode) → listen in the grid → tweak detection or use <strong>Clear slices</strong> if you need a
            redo → <strong>Download zip</strong> when ready.
          </li>
          <li>
            To try patterns: open <strong>Loops</strong>, choose which slices are in the pool, fill steps, press{' '}
            <strong>Play</strong>, then <strong>Download WAV</strong> if you want that bar as a file.
          </li>
          <li>
            For sustained textures: open <strong>Grains</strong>, start the grain cloud, tweak Cloud and Space, use the
            parametric EQ if you like, then <strong>Record to WAV</strong> to capture what you hear.
          </li>
        </ol>
      </div>
    </div>
  );
}

function PanelSlice() {
  return (
    <div id="help-panel-slice" role="tabpanel" aria-labelledby="help-nav-slice">
      <h3 className="help-pane-title">Slice workspace</h3>
      <p className="help-lead">
        The sidebar drives how slice boundaries are chosen. After processing, each slice appears as a card you can
        preview. Fades and naming apply to exported files.
      </p>

      <div className="help-block">
        <h4>Loading audio</h4>
        <p>
          Use <strong>Drop or click to browse</strong> in the sidebar. Decoding uses the browser’s built-in codecs—
          typically WAV, MP3, AAC/M4A, OGG; FLAC where supported. The file name appears in the top bar when loaded.
        </p>
      </div>

      <div className="help-block">
        <h4>Detection methods</h4>
        <ul>
          <li>
            <strong>Transient</strong> — Finds percussive onsets. Adjust <strong>Sensitivity</strong> (more slices vs
            fewer) and <strong>Min gap</strong> (minimum time between slice points in milliseconds) to reduce double
            triggers on noisy material.
          </li>
          <li>
            <strong>RMS energy</strong> — Slices when the signal crosses an energy gate. Lower{' '}
            <strong>dB threshold</strong> = more sensitive; <strong>Hold time</strong> keeps the gate from fluttering.
          </li>
          <li>
            <strong>Beat / BPM</strong> — Places slices on a musical grid. Set <strong>BPM</strong> and{' '}
            <strong>Beat division</strong> (e.g. quarter, eighth, sixteenth notes). Finer divisions yield more slices
            at the same tempo.
          </li>
          <li>
            <strong>Equal divisions</strong> — Splits the file into a fixed <strong>number of slices</strong> (2–64) of
            equal length—useful for experimental grids or even chops without transient hunting.
          </li>
          <li>
            <strong>Manual markers</strong> — You control the export window and cuts. Set <strong>Slice region</strong>{' '}
            Start and End (sliders span the full file duration; waveform shows <strong>S</strong> and <strong>E</strong>{' '}
            when the region isn’t the whole file with no cuts). <strong>Click</strong> the waveform to add interior cuts;{' '}
            <strong>Shift+click</strong> removes the nearest cut. The sidebar lists cuts with <strong>Remove</strong>;{' '}
            <strong>Clear all</strong> removes every cut. Press <strong>Apply slices</strong> to build slices from the
            region and cuts. If you apply with no cuts and the region spans the full file, you get a single slice—use{' '}
            <strong>Clear slices</strong> in the footer to undo without unloading the file.
          </li>
        </ul>
      </div>

      <div className="help-block">
        <h4>After Analyze / Apply</h4>
        <ul>
          <li>
            <strong>Waveform</strong> — Shows slice boundaries; during preview playback you’ll see a playhead and
            highlight for the active slice.
          </li>
          <li>
            <strong>Slice grid</strong> — Each slice can be played solo; use full-source playback where offered to hear
            the original file context.
          </li>
        </ul>
      </div>

      <div className="help-block">
        <h4>Export options</h4>
        <ul>
          <li>
            <strong>Fade in / Fade out</strong> — Millisecond fades applied at slice boundaries on export to reduce
            clicks.
          </li>
          <li>
            <strong>Naming</strong> — <strong>Index</strong> scheme: <code>prefix_001.wav</code> style names;{' '}
            <strong>Hex</strong> uses short hex-style identifiers. Set a custom <strong>prefix</strong> for indexed
            names.
          </li>
          <li>
            <strong>Download zip</strong> — Bundles mono 16-bit WAV slices plus metadata. Use when you’re happy with
            detection and fades.
          </li>
        </ul>
      </div>
    </div>
  );
}

function PanelLoop() {
  return (
    <div id="help-panel-loop" role="tabpanel" aria-labelledby="help-nav-loop">
      <h3 className="help-pane-title">Loops</h3>
      <p className="help-lead">
        Once slices exist, open the <strong>Loops</strong> tab to sequence them on a bar-long grid. Multiple layers
        stack hits on the same step; swing and meter shape the feel.
      </p>

      <div className="help-block">
        <h4>Transport & meter</h4>
        <ul>
          <li>
            <strong>BPM</strong> — Quarter-note tempo (about 60–180). Bar length follows the chosen{' '}
            <strong>time signature</strong> (e.g. 4/4 = four quarter-note beats per bar; 3/4 = three).
          </li>
          <li>
            <strong>Steps per bar</strong> — <strong>8</strong>, <strong>16</strong>, or <strong>32</strong> steps divide
            one bar into that many equal slices. More steps means a finer grid and faster step timing at the same BPM;
            the pattern is still one bar long. To slow the loop, lower BPM—not step count.
          </li>
          <li>
            <strong>Swing</strong> — Delays odd-numbered steps slightly for a shuffle feel (0 = straight).
          </li>
          <li>
            <strong>Trim to step</strong> — When on, each triggered slice only plays for roughly one step’s worth of
            audio; when off, samples can ring until they end or the bar ends—good for melodic or long one-shots.
          </li>
        </ul>
      </div>

      <div className="help-block">
        <h4>Sound pool & steps</h4>
        <ul>
          <li>
            <strong>Sound pool</strong> — Toggle which slice indices are available in step dropdowns. Only pooled slices
            appear in the per-step menus.
          </li>
          <li>
            Each <strong>step</strong> can reference one slice index or rest (—). Beat columns are visually emphasized on
            the grid.
          </li>
        </ul>
      </div>

      <div className="help-block">
        <h4>Layers (up to 6)</h4>
        <ul>
          <li>
            <strong>+ Add layer</strong> — Stack independent patterns. Each layer has <strong>Mute</strong>,{' '}
            <strong>Random</strong> (reseeds that layer’s pattern using the pool), <strong>Clear</strong>, and{' '}
            <strong>Remove</strong> (when more than one layer exists).
          </li>
          <li>
            <strong>Hit rate</strong> — For Random / <strong>Randomize all</strong>: probability (5–100%) that a step
            gets a hit vs rest—per layer.
          </li>
          <li>
            <strong>Pitch</strong> — Per-layer shift in semitones (−24…+24). Implemented sampler-style (pitch and
            playback speed change together within the step window).
          </li>
          <li>
            <strong>Randomize all</strong> — Reseeds every layer using each layer’s hit rate and the current pool.
          </li>
        </ul>
      </div>

      <div className="help-block">
        <h4>Playback & export</h4>
        <ul>
          <li>
            <strong>Play</strong> — Loops the built bar; the UI shows the current step. Stop returns to idle.
          </li>
          <li>
            <strong>Download WAV</strong> — Renders one mixed bar (all unmuted layers) to a WAV file for use outside the
            app.
          </li>
        </ul>
        <p className="help-muted" style={{ marginTop: 10, marginBottom: 0 }}>
          Tip: Preview individual slices from the Slices tab to pick pool members before sequencing.
        </p>
      </div>
    </div>
  );
}

function PanelGrain() {
  return (
    <div id="help-panel-grain" role="tabpanel" aria-labelledby="help-nav-grain">
      <h3 className="help-pane-title">Grains</h3>
      <p className="help-lead">
        Granular playback across your slice pool: overlapping grains with jitter, optional pitch spread, then delay and
        reverb. Needs analyzed slices. Audio runs in the browser; use <strong>Stop</strong> or leave the tab to silence.
      </p>

      <div className="help-block">
        <h4>Cloud</h4>
        <ul>
          <li>
            <strong>Density</strong> — Average grains per second.
          </li>
          <li>
            <strong>Grain</strong> — Grain length in milliseconds (longer tends toward smoother beds).
          </li>
          <li>
            <strong>Focus</strong> — Bias along the slice-pool timeline (paired with the Output focus scrubber).
          </li>
          <li>
            <strong>Jitter</strong> — Random drift around the focus position.
          </li>
          <li>
            <strong>Pitch</strong> — Random pitch spread in semitones.
          </li>
          <li>
            <strong>Mix</strong> — Grain bus level into the effects chain.
          </li>
          <li>
            <strong>Gain</strong> — Master output after effects.
          </li>
        </ul>
        <p className="help-muted" style={{ marginTop: 10, marginBottom: 0 }}>
          Drag knobs vertically to change values.
        </p>
      </div>

      <div className="help-block">
        <h4>Space</h4>
        <ul>
          <li>
            <strong>Time</strong> — Delay time.
          </li>
          <li>
            <strong>Fdbk</strong> — Delay feedback.
          </li>
          <li>
            <strong>Delay</strong> — Delay wet amount.
          </li>
          <li>
            <strong>Verb</strong> — Reverb wet amount.
          </li>
          <li>
            <strong>Room</strong> — Reverb tail length (room size).
          </li>
        </ul>
      </div>

      <div className="help-block">
        <h4>Output</h4>
        <ul>
          <li>
            <strong>Scope</strong> — Waveform and log spectrum of the processed signal while the cloud is playing. Before
            play, a short message explains that you need to start the grain cloud.
          </li>
          <li>
            <strong>Focus</strong> — Scrub where in the pool grains are drawn from (mirrors Cloud Focus).
          </li>
          <li>
            <strong>Start grain cloud</strong> / <strong>Stop</strong> — Runs or stops engine playback.
          </li>
          <li>
            <strong>Record to WAV</strong> — Captures processed stereo audio (up to about 90 seconds); tap again to save a
            WAV download.
          </li>
        </ul>
      </div>

      <div className="help-block">
        <h4>Parametric EQ</h4>
        <p>
          Seven peaking bands (±12 dB) shape the signal after delay and reverb. The curve shows the combined cascade in
          processing order. <strong>Presets</strong> are one-click starting shapes; use <strong>Bypass</strong> to hear the
          chain with EQ flat while keeping your edits, and <strong>Copy</strong> / <strong>Paste</strong> to move gain
          values as text.
        </p>
        <p className="help-muted" style={{ marginTop: 10, marginBottom: 0 }}>
          Note: EQ bands are peaking filters only; preset names like “Tight lows” approximate shelves.
        </p>
      </div>
    </div>
  );
}

function PanelFiles() {
  return (
    <div id="help-panel-files" role="tabpanel" aria-labelledby="help-nav-files">
      <h3 className="help-pane-title">Files & privacy</h3>
      <p className="help-lead">
        SliceLab does not upload your audio. Decoding, analysis, and export run in the browser tab using the Web Audio
        API and JavaScript—your files stay on your device unless you save or share them yourself.
      </p>

      <div className="help-block">
        <h4>Import</h4>
        <p>
          Supported formats depend on the browser. The UI lists common types (WAV, MP3, OGG, FLAC, M4A). If a file
          fails to decode, try another format or another browser.
        </p>
      </div>

      <div className="help-block">
        <h4>Export</h4>
        <ul>
          <li>
            <strong>Slice zip</strong> — WAV slices (mono, 16-bit) plus sidecar metadata for DAWs or samplers.
          </li>
          <li>
            <strong>Loop WAV</strong> — One bar of the mixed loop as a WAV file (same channel layout as your source buffer).
          </li>
          <li>
            <strong>Grain recording</strong> — From the Grains tab, <strong>Record to WAV</strong> saves processed output
            (cloud + space + EQ) as a stereo WAV, up to the app’s recording limit.
          </li>
        </ul>
      </div>

      <div className="help-block">
        <h4>Sessions</h4>
        <p>
          Closing or refreshing the page clears in-memory audio unless your browser restores the tab. Download exports
          you need before leaving.
        </p>
      </div>
    </div>
  );
}

export function HelpInstructions() {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [section, setSection] = useState<HelpSectionId>('overview');
  const mainScrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    mainScrollRef.current?.scrollTo(0, 0);
  }, [section]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  useEffect(() => {
    if (open) setSection('overview');
  }, [open]);

  useEffect(() => {
    if (open) document.body.style.overflow = 'hidden';
    else document.body.style.overflow = '';
    return () => {
      document.body.style.overflow = '';
    };
  }, [open]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title="How to use SliceLab"
        aria-label="Open instructions"
        style={{
          position: 'fixed',
          right: 18,
          bottom: 52,
          zIndex: 50,
          width: 44,
          height: 44,
          borderRadius: 2,
          border: '1px solid var(--border)',
          background: 'var(--surface)',
          color: 'var(--text)',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          transition: 'border-color 0.12s ease, background 0.12s ease',
        }}
        onMouseEnter={e => {
          e.currentTarget.style.borderColor = 'var(--border2)';
          e.currentTarget.style.background = 'var(--panel)';
        }}
        onMouseLeave={e => {
          e.currentTarget.style.borderColor = 'var(--border)';
          e.currentTarget.style.background = 'var(--surface)';
        }}
      >
        <HelpIcon />
      </button>

      {open && mounted
        ? createPortal(
            <div
              role="dialog"
              aria-modal="true"
              aria-labelledby="help-instructions-title"
              aria-describedby="help-instructions-desc"
              style={{
                position: 'fixed',
                inset: 0,
                zIndex: 10000,
                background: 'rgba(18, 21, 26, 0.42)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                padding: 16,
              }}
              onClick={() => setOpen(false)}
            >
              <div
                className="help-instructions-modal"
                onClick={e => e.stopPropagation()}
              >
                <header className="help-instructions-head">
                  <div className="help-instructions-head-row">
                    <div style={{ minWidth: 0 }}>
                      <h2 id="help-instructions-title">How to use SliceLab</h2>
                      <p id="help-instructions-desc" className="help-instructions-subtitle">
                        Pick a topic for slicing, the loop sequencer, granular grains (texture + EQ), and exports.
                        Sections are listed next to this text.
                      </p>
                    </div>
                    <button
                      type="button"
                      className="help-instructions-close"
                      onClick={() => setOpen(false)}
                      aria-label="Close"
                    >
                      ×
                    </button>
                  </div>
                </header>

                <div className="help-instructions-shell">
                  <nav className="help-instructions-sidebar" aria-label="Help sections">
                    <p className="help-instructions-nav-label">Sections</p>
                    <div role="tablist" aria-orientation="vertical">
                      {NAV_ITEMS.map(item => (
                        <button
                          key={item.id}
                          type="button"
                          role="tab"
                          id={`help-nav-${item.id}`}
                          aria-selected={section === item.id}
                          aria-controls={`help-panel-${item.id}`}
                          data-active={section === item.id ? 'true' : 'false'}
                          className="help-instructions-nav-btn"
                          onClick={() => setSection(item.id)}
                        >
                          <span className="help-instructions-nav-title">{item.title}</span>
                          <span className="help-instructions-nav-desc">{item.desc}</span>
                        </button>
                      ))}
                    </div>
                  </nav>

                  <div className="help-instructions-main" ref={mainScrollRef}>
                    {section === 'overview' && <PanelOverview />}
                    {section === 'slice' && <PanelSlice />}
                    {section === 'loop' && <PanelLoop />}
                    {section === 'grain' && <PanelGrain />}
                    {section === 'files' && <PanelFiles />}
                  </div>
                </div>

                <footer className="help-instructions-footer">
                  <span>Close with Esc, ×, or click outside. Keyboard: Tab moves focus; Enter activates.</span>
                  <span>Your audio stays on this device.</span>
                </footer>
              </div>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
