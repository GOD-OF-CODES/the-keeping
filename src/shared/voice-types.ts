// Schema of src/shared/voice-script.json — consumed by scripts/voices.mjs (ElevenLabs generation)
// and src/audio/voice.ts (playback, runtime processing, subtitles).
// Voices are DESIGNED from our own descriptions (never stock/library voices).

export type SpeakerId = 'driver' | 'harlan' | 'ada' | 'traveler2';

export type VoiceChain =
  | 'in_head' // the driver: non-spatial, close-mic EQ
  | 'whisper_in_head' // the driver hiding: quieter, breathier EQ
  | 'sack' // Harlan: band-pass "through burlap", positional
  | 'through_floor' // anything heard through a floor/wall: heavy low-pass + room reverb
  | 'revenant' // Ada: HRTF + wet wobble, grit, pitch-down, resonances
  | 'memory' // Ada 1976 reading her letter: clean, intimate, faint room tone
  | 'clean'; // traveler2 / UI

export interface SpeakerDef {
  id: SpeakerId;
  displayName: string;
  /** Voice Design prompt (our own description). */
  voiceDescription: string;
  /** 100–1000 characters of sample text for the design previews. */
  previewText: string;
  seed: number;
  /** ElevenLabs voice_settings for TTS. */
  settings: { stability: number; similarity_boost: number; style: number; speed: number; use_speaker_boost: boolean };
  defaultChain: VoiceChain;
}

export interface VoiceLine {
  id: string; // e.g. 'b01_needle', 'ada_look_harlan_1'
  speaker: SpeakerId;
  /** Text sent to TTS, may include audio tags like [whispers], [exhales], [crying]. */
  text: string;
  /** What the subtitle shows (no tags). Empty string = vocalisation with no subtitle (caption may still show). */
  subtitle: string;
  /** Caption for accessibility when subtitle is empty, e.g. "(ragged breathing)". */
  caption?: string;
  /** Story beat and trigger event that plays the line (see src/story). */
  beat: string;
  trigger: string;
  chain?: VoiceChain;
  kind: 'line' | 'vocal' | 'reading';
  /** Number of alternate takes to generate (for repeated barks like Ada's "…Harlan?"). */
  variants: number;
  previousText?: string;
  nextText?: string;
  /** Higher interrupts lower on the same speaker. */
  priority: number;
  milestone: 'M1' | 'M2';
}

export interface VoiceScript {
  version: 1;
  model: string; // e.g. 'eleven_v3'
  designModel: string; // e.g. 'eleven_ttv_v3'
  outputFormat: string; // e.g. 'mp3_44100_128'
  speakers: SpeakerDef[];
  lines: VoiceLine[];
}

/** Word timing sidecar written next to each generated clip (public/assets/voice/<id>.json). */
export interface VoiceTiming {
  id: string;
  durationSec: number;
  words: { text: string; start: number; end: number }[];
}
