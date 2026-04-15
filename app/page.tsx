'use client';

import { useState, useEffect } from 'react';
import Image from 'next/image';
import type { DetectionSettings, FadeSettings, NamingSettings } from './types';
import { useAudioEngine } from './hooks/useAudioEngine';
import { ProjectProvider, useProject } from './context/ProjectContext';
import { Topbar, type MainTab } from './components/Topbar';
import { Sidebar } from './components/Sidebar';
import { Waveform } from './components/Waveform';
import { SliceGrid } from './components/SliceGrid';
import { LoopBuilder } from './components/LoopBuilder';
import { GrainMode } from './components/GrainMode';
import { OneshotsMode } from './components/OneshotsMode';
import { StatusBar } from './components/StatusBar';
import { HelpInstructions } from './components/HelpInstructions';
import { ProjectOnboarding } from './components/ProjectOnboarding';
import { ProjectSaveBanner } from './components/ProjectSaveBanner';

const DEFAULT_DETECTION: DetectionSettings = {
  method: 'transient',
  sensitivity: 65,
  minGap: 80,
  rmsThresh: -24,
  holdTime: 120,
  bpm: 120,
  beatDiv: '4',
  numSlices: 8,
};

const DEFAULT_FADE: FadeSettings = { fadeIn: 5, fadeOut: 20 };
const DEFAULT_NAMING: NamingSettings = { scheme: 'index', prefix: 'smpl' };

export default function Home() {
  return (
    <ProjectProvider>
      <HomeInner />
    </ProjectProvider>
  );
}

function HomeInner() {
  const [detection, setDetection] = useState<DetectionSettings>(DEFAULT_DETECTION);
  const [fade, setFade] = useState<FadeSettings>(DEFAULT_FADE);
  const [naming, setNaming] = useState<NamingSettings>(DEFAULT_NAMING);
  const [tab, setTab] = useState<MainTab>('slices');
  const project = useProject();
  const engine = useAudioEngine();

  useEffect(() => {
    if (engine.slices.length === 0) setTab('slices');
  }, [engine.slices.length]);

  useEffect(() => {
    if (tab === 'grain' || tab === 'oneshots') engine.stopPlayback();
  }, [tab, engine.stopPlayback]); // stop slice/loop preview when opening Grain / Oneshots

  return (
    <>
    <div
      className="slicelab-desktop-only"
      style={{ display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden' }}
    >
      <Topbar
        fileName={engine.audioInfo?.fileName ?? 'no file loaded'}
        hasSlices={engine.slices.length > 0}
        onDownload={engine.downloadZip}
        tab={tab}
        onTabChange={setTab}
        projectSupported={project.supported}
        projectLabel={project.mode === 'loading' ? '…' : project.label}
        onProjectSettings={project.promptProjectSetup}
      />
      <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
        <Sidebar
          detection={detection}
          fade={fade}
          naming={naming}
          canAnalyze={!!engine.audioInfo && !engine.isLoading}
          canClear={!!engine.audioInfo}
          onDetectionChange={d => setDetection(p => ({ ...p, ...d }))}
          onFadeChange={f => setFade(p => ({ ...p, ...f }))}
          onNamingChange={n => setNaming(p => ({ ...p, ...n }))}
          onFileLoad={engine.loadFile}
          onAnalyze={() => engine.analyze(detection, fade, naming)}
          onClear={engine.clear}
          hasAppliedSlices={engine.slices.length > 0}
          onClearAppliedSlices={engine.clearAppliedSlices}
          manualCutTimes={engine.manualCutTimes}
          onRemoveManualCut={engine.removeManualCutAtIndex}
          onClearManualCuts={engine.clearManualCuts}
          audioDurationSec={engine.audioInfo?.duration ?? null}
          manualRegionStartSec={engine.manualRegionStartSec}
          manualRegionEndSec={engine.manualRegionEndSec}
          onManualRegionStartChange={engine.setManualRegionStart}
          onManualRegionEndChange={engine.setManualRegionEnd}
        />
        <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0, overflow: 'hidden' }}>
          <Waveform
            audioBuffer={engine.audioBuffer}
            audioInfo={engine.audioInfo}
            markers={
              detection.method === 'manual' && engine.audioInfo
                ? engine.slices.length > 0
                  ? engine.slices.map(s => s.start)
                  : (() => {
                      const dur = engine.audioInfo.duration;
                      const rs = engine.manualRegionStartSec;
                      const re = engine.manualRegionEndSec;
                      const cuts = engine.manualCutTimes;
                      const fullFile =
                        rs <= 1e-4 && re >= dur - 1e-4;
                      if (fullFile && cuts.length === 0) return [];
                      return cuts;
                    })()
                : engine.slices.length > 0
                  ? engine.slices.map(s => s.start)
                  : []
            }
            manualRegionSec={
              detection.method === 'manual' &&
              engine.audioInfo &&
              engine.slices.length === 0
                ? (() => {
                    const dur = engine.audioInfo.duration;
                    const rs = engine.manualRegionStartSec;
                    const re = engine.manualRegionEndSec;
                    const cuts = engine.manualCutTimes;
                    const fullFile =
                      rs <= 1e-4 && re >= dur - 1e-4;
                    if (fullFile && cuts.length === 0) return null;
                    return { start: rs, end: re };
                  })()
                : null
            }
            method={detection.method}
            sliceCount={
              detection.method === 'manual' && engine.slices.length === 0
                ? engine.manualCutTimes.length + 1
                : engine.slices.length
            }
            playback={{
              playheadSec: engine.waveformPlayheadSec,
              highlightBetweenSec: engine.waveformHighlightSec,
            }}
            manualMode={detection.method === 'manual' && !!engine.audioInfo}
            onManualWaveformPointer={(timeSec, shiftKey) => {
              if (shiftKey) engine.removeManualCutNear(timeSec);
              else engine.addManualCut(timeSec);
            }}
          />
          {tab === 'slices' ? (
            <SliceGrid
              slices={engine.slices}
              audioBuffer={engine.audioBuffer.current}
              playingIndex={engine.playingIndex}
              onPlay={engine.playSlice}
              onPlayFullSource={engine.playFullSource}
              hasAudio={!!engine.audioInfo}
            />
          ) : tab === 'loops' ? (
            <LoopBuilder
              slices={engine.slices}
              loopPlaying={engine.loopPlaying}
              loopPlayheadStep={engine.loopPlayheadStep}
              playingIndex={engine.playingIndex}
              onPlayLoop={engine.playLoop}
              onDownloadLoopWav={engine.downloadLoopWav}
              onStopLoop={engine.stopLoop}
              onPlaySlice={engine.playSlice}
              hasAudio={!!engine.audioInfo}
            />
          ) : tab === 'grain' ? (
            <GrainMode
              slices={engine.slices}
              audioBuffer={engine.audioBuffer.current}
              ensureAudioContext={engine.ensureAudioContext}
              onStopOtherAudio={engine.stopPlayback}
            />
          ) : (
            <OneshotsMode
              slices={engine.slices}
              audioBuffer={engine.audioBuffer.current}
              ensureAudioContext={engine.ensureAudioContext}
              onStopOtherAudio={engine.stopPlayback}
              playOneshotPreview={engine.playOneshotPreview}
              playSlice={engine.playSlice}
            />
          )}
        </div>
      </div>
      <StatusBar message={engine.status} active={engine.statusActive} />
    </div>
    <HelpInstructions />
    <ProjectOnboarding />
    <ProjectSaveBanner />
    <div
      className="slicelab-mobile-only"
      role="status"
      aria-live="polite"
      style={{
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '100vh',
        padding: '28px 22px',
        textAlign: 'center',
        background: 'var(--bg)',
        color: 'var(--text)',
      }}
    >
      <div style={{ maxWidth: 360 }}>
        <span className="topbar-logo-wrap" style={{ display: 'block', margin: '0 auto 14px', width: 48 }}>
          <Image
            src="/logo.svg"
            width={48}
            height={48}
            alt=""
            aria-hidden
            priority
            style={{ display: 'block' }}
          />
        </span>
        <p
          style={{
            fontSize: 11,
            letterSpacing: 2,
            textTransform: 'uppercase',
            color: 'var(--faint)',
            fontFamily: "'IBM Plex Mono', monospace",
            margin: '0 0 12px',
          }}
        >
          SliceLab
        </p>
        <p style={{ fontSize: 17, fontWeight: 500, margin: '0 0 14px', lineHeight: 1.35 }}>
          This app is optimized for desktop.
        </p>
        <p style={{ fontSize: 14, color: 'var(--muted)', margin: 0, lineHeight: 1.5 }}>
          Open SliceLab on a computer or a larger display for the full slicing and loop workflow.
        </p>
      </div>
    </div>
    </>
  );
}
