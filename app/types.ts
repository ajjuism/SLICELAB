export type DetectionMethod = 'transient' | 'rms' | 'beat' | 'equal' | 'manual';
export type NamingScheme = 'index' | 'hex';
export type BeatDivision = '1' | '2' | '4' | '8' | '16';

export interface DetectionSettings {
  method: DetectionMethod;
  // transient
  sensitivity: number;
  minGap: number;
  // rms
  rmsThresh: number;
  holdTime: number;
  // beat
  bpm: number;
  beatDiv: BeatDivision;
  // equal
  numSlices: number;
}

export interface FadeSettings {
  fadeIn: number; // ms
  fadeOut: number; // ms
}

export interface NamingSettings {
  scheme: NamingScheme;
  prefix: string;
}

export interface Slice {
  index: number;
  name: string;
  start: number;       // seconds
  end: number;         // seconds
  dur: number;         // seconds
  startSample: number;
  endSample: number;
  fadeIn: number;      // seconds
  fadeOut: number;     // seconds
}

export interface AudioInfo {
  duration: number;
  sampleRate: number;
  channels: number;
  fileName: string;
}

/** Step count for one bar in the loop sequencer (grid resolution). */
export type StepsPerBar = 8 | 16 | 32;

/** BPM is quarter-note based (common DAW convention). Bar length = f(numerator, denominator). */
export type TimeSignature =
  | '2/4'
  | '3/4'
  | '4/4'
  | '5/4'
  | '7/4'
  | '6/8'
  | '9/8'
  | '12/8';
