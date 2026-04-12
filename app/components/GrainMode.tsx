'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { Slice } from '../types';
import { bufferToWav } from '../lib/audio';
import { createGrainCloud, type GrainCloudHandle, type GrainCloudParams } from '../lib/grainCloud';
import {
  createGrainMasterChain,
  mergeStereoChunks,
  type GrainFxState,
} from '../lib/grainFxGraph';
import { Knob } from './Knob';
import { GrainGraphicEQ } from './GrainGraphicEQ';
import { getGrainEqInitialGainsDb } from '../lib/grainEqPresets';
import { drawGrainMonitor, GRAIN_MONITOR_THEME } from '../lib/grainScopeDraw';

interface GrainModeProps {
  slices: Slice[];
  audioBuffer: AudioBuffer | null;
  ensureAudioContext: () => Promise<AudioContext>;
  onStopOtherAudio: () => void;
}

const MAX_RECORD_SEC = 90;

export function GrainMode({
  slices,
  audioBuffer,
  ensureAudioContext,
  onStopOtherAudio,
}: GrainModeProps) {
  const [density, setDensity] = useState(11);
  const [grainMs, setGrainMs] = useState(165);
  const [positionPct, setPositionPct] = useState(50);
  const [jitterPct, setJitterPct] = useState(55);
  const [pitchSpread, setPitchSpread] = useState(0);
  const [mixPct, setMixPct] = useState(58);
  const [gainPct, setGainPct] = useState(50);

  const [delayTimeMs, setDelayTimeMs] = useState(380);
  const [delayFeedbackPct, setDelayFeedbackPct] = useState(52);
  const [delayMixPct, setDelayMixPct] = useState(48);
  const [reverbMixPct, setReverbMixPct] = useState(52);
  const [reverbSizeSec, setReverbSizeSec] = useState(2.8);

  const [playing, setPlaying] = useState(false);
  const [recording, setRecording] = useState(false);
  const [eqGainsDb, setEqGainsDb] = useState<number[]>(() => getGrainEqInitialGainsDb());
  const [eqBypass, setEqBypass] = useState(false);
  const [audioRate, setAudioRate] = useState(48000);

  const cloudRef = useRef<GrainCloudHandle | null>(null);
  const grainBusRef = useRef<GainNode | null>(null);
  const chainRef = useRef<ReturnType<typeof createGrainMasterChain> | null>(null);
  const scriptRef = useRef<ScriptProcessorNode | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);

  const paramsRef = useRef<GrainCloudParams>({
    density: 11,
    grainDurationMs: 165,
    position: 0.5,
    jitter: 0.55,
    pitchSpreadSemis: 0,
    mix: 0.58,
  });

  const recordingRef = useRef(false);
  const recLRef = useRef<Float32Array[]>([]);
  const recRRef = useRef<Float32Array[]>([]);
  const recSamplesRef = useRef(0);

  const scopeCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const spectrumSmoothedRef = useRef<Float32Array | null>(null);
  const rafRef = useRef(0);
  const fxState = (): GrainFxState => ({
    delayTimeMs,
    delayFeedbackPct,
    delayMixPct,
    reverbMixPct,
    reverbSizeSec,
  });

  useEffect(() => {
    if (!playing) return;
    paramsRef.current = {
      density,
      grainDurationMs: grainMs,
      position: positionPct / 100,
      jitter: jitterPct / 100,
      pitchSpreadSemis: pitchSpread,
      mix: mixPct / 100,
    };
    cloudRef.current?.setParams(paramsRef.current);
  }, [playing, density, grainMs, positionPct, jitterPct, pitchSpread, mixPct]);

  useEffect(() => {
    if (!playing || !chainRef.current || !ctxRef.current) return;
    chainRef.current.applyFx(fxState(), ctxRef.current);
  }, [
    playing,
    delayTimeMs,
    delayFeedbackPct,
    delayMixPct,
    reverbMixPct,
    reverbSizeSec,
  ]);

  useEffect(() => {
    if (!playing || !chainRef.current || !ctxRef.current) return;
    const id = window.setTimeout(() => {
      chainRef.current?.setReverbSize(ctxRef.current!, reverbSizeSec);
    }, 120);
    return () => clearTimeout(id);
  }, [playing, reverbSizeSec]);

  useEffect(() => {
    if (!playing || !chainRef.current || !ctxRef.current) return;
    const g = Math.min(0.95, gainPct / 100);
    const t = ctxRef.current.currentTime;
    try {
      chainRef.current.masterOutput.gain.cancelScheduledValues(t);
      chainRef.current.masterOutput.gain.setTargetAtTime(g, t, 0.04);
    } catch {
      chainRef.current.masterOutput.gain.value = g;
    }
  }, [playing, gainPct]);

  useEffect(() => {
    if (!playing || !chainRef.current || !ctxRef.current) return;
    const gains = eqBypass ? Array<number>(7).fill(0) : eqGainsDb;
    chainRef.current.applyEqGains(gains, ctxRef.current);
  }, [playing, eqGainsDb, eqBypass]);

  const stopGrain = useCallback(() => {
    cloudRef.current?.stop();
    cloudRef.current = null;

    if (scriptRef.current) {
      try {
        scriptRef.current.disconnect();
      } catch {
        /* ok */
      }
      scriptRef.current.onaudioprocess = null;
      scriptRef.current = null;
    }

    chainRef.current?.dispose();
    chainRef.current = null;

    const g = grainBusRef.current;
    if (g) {
      try {
        g.disconnect();
      } catch {
        /* ok */
      }
      grainBusRef.current = null;
    }

    recordingRef.current = false;
    setRecording(false);
    recLRef.current = [];
    recRRef.current = [];
    recSamplesRef.current = 0;

    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = 0;
    }
    const sc = scopeCanvasRef.current;
    if (sc) {
      const c2d = sc.getContext('2d');
      if (c2d) {
        c2d.setTransform(1, 0, 0, 1, 0, 0);
        c2d.fillStyle = GRAIN_MONITOR_THEME.plotBg;
        c2d.fillRect(0, 0, sc.width, sc.height);
      }
    }
    setPlaying(false);
    ctxRef.current = null;
  }, []);

  useEffect(() => () => stopGrain(), [stopGrain]);

  /** Scope redraw */
  useEffect(() => {
    if (!playing || !chainRef.current) return;

    const analyser = chainRef.current.analyser;
    const timeData = new Uint8Array(analyser.fftSize);
    const freqData = new Uint8Array(analyser.frequencyBinCount);
    const canvas = scopeCanvasRef.current;
    const draw = () => {
      rafRef.current = requestAnimationFrame(draw);
      analyser.getByteTimeDomainData(timeData);
      analyser.getByteFrequencyData(freqData);

      if (canvas && ctxRef.current) {
        const nBin = analyser.frequencyBinCount;
        if (!spectrumSmoothedRef.current || spectrumSmoothedRef.current.length !== nBin) {
          spectrumSmoothedRef.current = new Float32Array(nBin);
        }
        drawGrainMonitor(
          canvas,
          timeData,
          freqData,
          ctxRef.current.sampleRate,
          analyser.fftSize,
          analyser.minDecibels,
          analyser.maxDecibels,
          GRAIN_MONITOR_THEME,
          spectrumSmoothedRef.current,
        );
      }
    };

    rafRef.current = requestAnimationFrame(draw);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = 0;
    };
  }, [playing]);

  const startGrain = async () => {
    if (!audioBuffer || slices.length === 0) return;
    onStopOtherAudio();
    stopGrain();

    const ctx = await ensureAudioContext();
    ctxRef.current = ctx;
    setAudioRate(ctx.sampleRate);

    const grainBus = ctx.createGain();
    grainBusRef.current = grainBus;

    const chain = createGrainMasterChain(ctx, grainBus, ctx.destination, fxState());
    chainRef.current = chain;

    const sp = ctx.createScriptProcessor(4096, 2, 2);
    sp.onaudioprocess = e => {
      const inBuf = e.inputBuffer;
      const outBuf = e.outputBuffer;
      const in0 = inBuf.getChannelData(0);
      const in1 =
        inBuf.numberOfChannels > 1 ? inBuf.getChannelData(1) : inBuf.getChannelData(0);
      if (recordingRef.current) {
        recLRef.current.push(new Float32Array(in0));
        recRRef.current.push(new Float32Array(in1));
        recSamplesRef.current += in0.length;
        const sr = ctx.sampleRate;
        if (recSamplesRef.current / sr > MAX_RECORD_SEC) {
          recordingRef.current = false;
          setRecording(false);
        }
      }
      outBuf.getChannelData(0).set(in0);
      outBuf.getChannelData(1).set(in1);
    };

    const lastEq = chain.eqBands[chain.eqBands.length - 1]!;
    lastEq.disconnect(chain.masterOutput);
    lastEq.connect(sp);
    sp.connect(chain.masterOutput);
    scriptRef.current = sp;

    const outGain = Math.min(0.95, gainPct / 100);
    chain.masterOutput.gain.setValueAtTime(outGain, ctx.currentTime);
    chain.applyEqGains(eqBypass ? Array<number>(7).fill(0) : eqGainsDb, ctx);

    paramsRef.current = {
      density,
      grainDurationMs: grainMs,
      position: positionPct / 100,
      jitter: jitterPct / 100,
      pitchSpreadSemis: pitchSpread,
      mix: mixPct / 100,
    };

    const handle = createGrainCloud(ctx, audioBuffer, slices, grainBus, paramsRef.current);
    cloudRef.current = handle;
    handle.start();
    setPlaying(true);
  };

  const toggleRecording = () => {
    if (!playing) return;
    if (!recording) {
      recLRef.current = [];
      recRRef.current = [];
      recSamplesRef.current = 0;
      recordingRef.current = true;
      setRecording(true);
    } else {
      recordingRef.current = false;
      setRecording(false);
      const ctx = ctxRef.current;
      if (!ctx || recSamplesRef.current < ctx.sampleRate * 0.2) return;
      const buf = mergeStereoChunks(recLRef.current, recRRef.current, ctx.sampleRate);
      const wav = bufferToWav(buf);
      const blob = new Blob([wav], { type: 'audio/wav' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'slicelab_grain.wav';
      a.click();
      URL.revokeObjectURL(url);
      recLRef.current = [];
      recRRef.current = [];
      recSamplesRef.current = 0;
    }
  };

  const hasSlices = slices.length > 0 && audioBuffer;

  const totalDur = slices.reduce((a, s) => a + s.dur, 0);

  return (
    <div
      className="app-scroll"
      style={{
        flex: 1,
        overflowY: 'auto',
        padding: '12px 16px 16px',
        minHeight: 0,
        background: 'var(--bg)',
        width: '100%',
        alignSelf: 'stretch',
      }}
    >
      <div style={{ width: '100%', maxWidth: '100%' }}>
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: 16,
          alignItems: 'stretch',
          width: '100%',
          maxWidth: '100%',
        }}
      >
        <div
          style={{
            background: 'var(--surface)',
            border: '1px solid var(--border)',
            borderRadius: 2,
            padding: '14px 16px',
            minWidth: 0,
            flex: '2 1 380px',
          }}
        >
          <div style={{ marginBottom: 14 }}>
            <span
              style={{
                fontSize: 10,
                letterSpacing: 1.5,
                color: 'var(--faint)',
                textTransform: 'uppercase',
                fontFamily: "'IBM Plex Mono', monospace",
              }}
            >
              Grain mode
            </span>
            <p
              style={{
                margin: '8px 0 0',
                fontSize: 11,
                lineHeight: 1.5,
                color: 'var(--muted)',
                fontFamily: "'IBM Plex Sans', sans-serif",
              }}
            >
              Overlapping grains for drone and atmosphere: long grains,
              moderate density, wide jitter, and the Space section for smeared delay and hall. The scope shows the processed
              output. Record captures a WAV of what you hear. Stops when you leave this tab or press Stop.
            </p>
          </div>

          {!hasSlices ? (
            <p style={{ fontSize: 11, color: 'var(--faint)', fontFamily: "'IBM Plex Mono', monospace" }}>
              Analyze audio first—Grain needs slices to read from.
            </p>
          ) : (
            <>
              <p
                style={{
                  fontSize: 9,
                  letterSpacing: 1,
                  color: 'var(--faint)',
                  textTransform: 'uppercase',
                  margin: '0 0 10px',
                  fontFamily: "'IBM Plex Mono', monospace",
                }}
              >
                Cloud
              </p>
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fill, minmax(76px, 1fr))',
                  gap: '14px 12px',
                  marginBottom: 16,
                }}
              >
                <Knob
                  label="Density"
                  value={density}
                  min={2}
                  max={48}
                  display={`${density}/s`}
                  title="Average grains per second"
                  onChange={setDensity}
                />
                <Knob
                  label="Grain"
                  value={grainMs}
                  min={20}
                  max={520}
                  step={5}
                  display={`${grainMs} ms`}
                  title="Length of each grain (longer = smoother bed)"
                  onChange={setGrainMs}
                />
                <Knob
                  label="Focus"
                  value={positionPct}
                  min={0}
                  max={100}
                  display={`${positionPct}%`}
                  title="Focus along slice pool timeline"
                  onChange={setPositionPct}
                />
                <Knob
                  label="Jitter"
                  value={jitterPct}
                  min={0}
                  max={100}
                  display={`${jitterPct}%`}
                  title="Random drift around focus"
                  onChange={setJitterPct}
                />
                <Knob
                  label="Pitch"
                  value={pitchSpread}
                  min={0}
                  max={24}
                  display={pitchSpread === 0 ? '0 st' : `±${pitchSpread}`}
                  title="Random pitch spread (semitones)"
                  onChange={setPitchSpread}
                />
                <Knob
                  label="Mix"
                  value={mixPct}
                  min={5}
                  max={100}
                  display={`${mixPct}%`}
                  title="Grain level into the effects chain"
                  onChange={setMixPct}
                />
                <Knob
                  label="Gain"
                  value={gainPct}
                  min={5}
                  max={100}
                  display={`${gainPct}%`}
                  title="Master output level (after effects)"
                  onChange={setGainPct}
                />
              </div>

              <p
                style={{
                  fontSize: 9,
                  letterSpacing: 1,
                  color: 'var(--faint)',
                  textTransform: 'uppercase',
                  margin: '0 0 10px',
                  fontFamily: "'IBM Plex Mono', monospace",
                }}
              >
                Space
              </p>
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fill, minmax(76px, 1fr))',
                  gap: '14px 12px',
                  marginBottom: 16,
                }}
              >
                <Knob
                  label="Time"
                  value={delayTimeMs}
                  min={0}
                  max={900}
                  step={5}
                  display={`${delayTimeMs} ms`}
                  title="Delay time"
                  onChange={setDelayTimeMs}
                />
                <Knob
                  label="Fdbk"
                  value={delayFeedbackPct}
                  min={0}
                  max={85}
                  display={`${delayFeedbackPct}%`}
                  title="Delay feedback"
                  onChange={setDelayFeedbackPct}
                />
                <Knob
                  label="Delay"
                  value={delayMixPct}
                  min={0}
                  max={100}
                  display={`${delayMixPct}%`}
                  title="Delay wet level"
                  onChange={setDelayMixPct}
                />
                <Knob
                  label="Verb"
                  value={reverbMixPct}
                  min={0}
                  max={100}
                  display={`${reverbMixPct}%`}
                  title="Reverb wet level"
                  onChange={setReverbMixPct}
                />
                <Knob
                  label="Room"
                  value={Math.round(reverbSizeSec * 20)}
                  min={4}
                  max={100}
                  display={`${reverbSizeSec.toFixed(1)}s`}
                  title="Reverb tail length (longer = more diffuse)"
                  onChange={v => setReverbSizeSec(v / 20)}
                />
              </div>

              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                {!playing ? (
                  <button
                    type="button"
                    onClick={() => void startGrain()}
                    style={{
                      padding: '8px 16px',
                      borderRadius: 2,
                      border: '1px solid var(--text)',
                      background: 'var(--text)',
                      color: 'var(--surface)',
                      fontFamily: "'IBM Plex Mono', monospace",
                      fontSize: 11,
                      letterSpacing: 0.5,
                      cursor: 'pointer',
                    }}
                  >
                    Start grain cloud
                  </button>
                ) : (
                  <>
                    <button
                      type="button"
                      onClick={stopGrain}
                      style={{
                        padding: '8px 16px',
                        borderRadius: 2,
                        border: '1px solid var(--border)',
                        background: 'var(--panel)',
                        color: 'var(--text)',
                        fontFamily: "'IBM Plex Mono', monospace",
                        fontSize: 11,
                        cursor: 'pointer',
                      }}
                    >
                      Stop
                    </button>
                    <button
                      type="button"
                      onClick={toggleRecording}
                      style={{
                        padding: '8px 16px',
                        borderRadius: 2,
                        border: `1px solid ${recording ? 'var(--red)' : 'var(--border2)'}`,
                        background: recording ? 'rgba(192, 57, 43, 0.08)' : 'var(--surface)',
                        color: 'var(--text)',
                        fontFamily: "'IBM Plex Mono', monospace",
                        fontSize: 11,
                        cursor: 'pointer',
                      }}
                    >
                      {recording ? 'Recording… tap again to save WAV' : 'Record to WAV'}
                    </button>
                  </>
                )}
              </div>
            </>
          )}
        </div>

        <div
          style={{
            background: 'var(--surface)',
            border: '1px solid var(--border)',
            borderRadius: 2,
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
            minHeight: 400,
            flex: '1 1 320px',
            maxWidth: '100%',
          }}
        >
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              padding: '11px 14px',
              borderBottom: '1px solid var(--border)',
              fontFamily: "'IBM Plex Mono', monospace",
            }}
          >
            <span
              style={{
                fontSize: 9,
                letterSpacing: 1.2,
                color: 'var(--faint)',
                textTransform: 'uppercase',
              }}
            >
              Output
            </span>
            <div style={{ textAlign: 'right' }}>
              <span
                style={{
                  fontSize: 10,
                  letterSpacing: 0.4,
                  color: playing ? 'var(--text)' : 'var(--faint)',
                  display: 'block',
                }}
              >
                {playing ? 'LIVE' : 'IDLE'}
              </span>
              <span
                style={{
                  fontSize: 8,
                  letterSpacing: 0.6,
                  color: 'var(--faint)',
                  textTransform: 'uppercase',
                  marginTop: 2,
                  display: 'block',
                }}
              >
                OSC · log spectrum · dB
              </span>
            </div>
          </div>

          <div style={{ padding: '12px 14px', flex: '1 1 auto', minHeight: 200 }}>
            <div style={{ position: 'relative', width: '100%' }}>
              <canvas
                ref={scopeCanvasRef}
                style={{
                  width: '100%',
                  height: 236,
                  minHeight: 220,
                  display: 'block',
                  borderRadius: 2,
                  background: GRAIN_MONITOR_THEME.plotBg,
                }}
                aria-label="Output monitor: waveform and spectrum"
              />
              {!playing ? (
                <div
                  role="status"
                  aria-live="polite"
                  style={{
                    position: 'absolute',
                    inset: 0,
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 8,
                    padding: '20px 18px',
                    borderRadius: 2,
                    textAlign: 'center',
                    background: GRAIN_MONITOR_THEME.plotBg,
                    border: `1px dashed ${GRAIN_MONITOR_THEME.frameBorder}`,
                    pointerEvents: 'none',
                  }}
                >
                  <span
                    style={{
                      fontSize: 9,
                      letterSpacing: 1.1,
                      color: 'var(--faint)',
                      textTransform: 'uppercase',
                      fontFamily: "'IBM Plex Mono', monospace",
                    }}
                  >
                    {hasSlices ? 'Monitor idle' : 'Nothing to show yet'}
                  </span>
                  <span
                    style={{
                      fontSize: 11,
                      lineHeight: 1.5,
                      color: 'var(--muted)',
                      maxWidth: 300,
                      fontFamily: "'IBM Plex Sans', sans-serif",
                    }}
                  >
                    {hasSlices
                      ? 'Start grain cloud to see the live waveform and spectrum in this panel.'
                      : 'Analyze audio and create slices first. Then start grain cloud to hear output and see the scope.'}
                  </span>
                </div>
              ) : null}
            </div>
          </div>

          <div
            style={{
              padding: '0 14px 14px',
              borderTop: '1px solid var(--border)',
              background: 'var(--bg)',
            }}
          >
            {hasSlices && totalDur > 0 ? (
              <div style={{ paddingTop: 12 }}>
                <span
                  style={{
                    fontSize: 9,
                    letterSpacing: 0.8,
                    color: 'var(--faint)',
                    fontFamily: "'IBM Plex Mono', monospace",
                    display: 'block',
                    marginBottom: 6,
                  }}
                >
                  Focus
                </span>
                <div
                  style={{
                    position: 'relative',
                    height: 8,
                    background: 'var(--surface)',
                    border: '1px solid var(--border)',
                    borderRadius: 1,
                  }}
                >
                  <div
                    style={{
                      position: 'absolute',
                      top: 1,
                      bottom: 1,
                      width: 2,
                      marginLeft: -1,
                      left: `${positionPct}%`,
                      background: 'var(--text)',
                      borderRadius: 1,
                    }}
                    title="Focus position"
                  />
                </div>
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    marginTop: 4,
                    fontSize: 8,
                    color: 'var(--faint)',
                    fontFamily: "'IBM Plex Mono', monospace",
                  }}
                >
                  <span>0</span>
                  <span>{totalDur.toFixed(2)}s</span>
                </div>
              </div>
            ) : null}
          </div>

          <p
            style={{
              margin: 0,
              padding: '10px 14px 14px',
              fontSize: 10,
              color: 'var(--muted)',
              lineHeight: 1.5,
              fontFamily: "'IBM Plex Sans', sans-serif",
              borderTop: '1px solid var(--border)',
            }}
          >
            Drag knobs vertically. Record saves processed audio (WAV, up to {MAX_RECORD_SEC}s).
          </p>
        </div>
      </div>

      <GrainGraphicEQ
        gainsDb={eqGainsDb}
        onGainsChange={setEqGainsDb}
        disabled={!hasSlices}
        responseSampleRate={audioRate}
        eqBypass={eqBypass}
        onEqBypassChange={setEqBypass}
      />
      </div>
    </div>
  );
}
